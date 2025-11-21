package com.example.subtitle;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.TimeoutError;
import com.microsoft.playwright.options.WaitUntilState;

import java.io.IOException;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 基于 Playwright 的B站字幕提取工具（Java版）。
 * 参考 get_bilibili_subtitle.py 的逆向接口调用流程，支持输入 BV 号或完整链接。
 */
public class BilibiliSubtitleFetcher {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * 将 SRT 格式字幕转换为纯文本（去除序号和时间戳）。
     */
    public static String parseSrtToText(String srtContent) {
        if (srtContent == null || srtContent.isBlank()) {
            return "";
        }

        StringBuilder builder = new StringBuilder();
        for (String line : srtContent.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.matches("\\d+") || trimmed.contains("-->") || trimmed.startsWith("WEBVTT")) {
                continue;
            }
            builder.append(trimmed).append('\n');
        }
        return builder.toString().stripTrailing();
    }

    /**
     * 获取 B 站视频字幕数据。
     *
     * @param videoUrl  B 站视频链接或 BV 号。
     * @param textOnly  是否只返回纯文本字幕（会在返回结构中同时保留原始时间戳版本）。
     * @return          成功时返回字幕 JSON，失败时包含错误信息。
     */
    public static SubtitleResponse fetchSubtitle(String videoUrl, boolean textOnly) {
        String normalizedUrl = normalizeUrl(videoUrl);
        AtomicReference<JsonNode> apiResponse = new AtomicReference<>();

        try (Playwright playwright = Playwright.create()) {
            Browser browser = playwright.chromium().launch(new BrowserType.LaunchOptions().setHeadless(true));
            BrowserContext context = browser.newContext();
            Page page = context.newPage();

            page.onResponse(response -> {
                if (response.url().contains("subtitleExtract")) {
                    try {
                        String body = response.text();
                        apiResponse.compareAndSet(null, MAPPER.readTree(body));
                    } catch (IOException ignored) {
                    }
                }
            });

            page.navigate("https://www.feiyudo.com/caption/subtitle/bilibili", new Page.NavigateOptions()
                .setWaitUntil(WaitUntilState.NETWORKIDLE)
                .setTimeout(30_000));

            page.waitForSelector(
                "input[placeholder*=\\u8BF7\\u5C06\\u94FE\\u63A5\\u7C98\\u8D34\\u5230\\u8FD9\\u91CC]",
                new Page.WaitForSelectorOptions().setTimeout(10_000)
            );
            page.fill(
                "input[placeholder*=\\u8BF7\\u5C06\\u94FE\\u63A5\\u7C98\\u8D34\\u5230\\u8FD9\\u91CC]",
                normalizedUrl
            );
            page.click("button.el-button--primary:has-text(\\u63D0\\u53D6)");

            waitForApiResponse(apiResponse, Duration.ofSeconds(30));

            JsonNode responseData = apiResponse.get();
            if (responseData == null) {
                return SubtitleResponse.failure("等待超时，未收到API响应");
            }

            if (responseData.path("code").asInt() != 200) {
                String message = Optional.ofNullable(responseData.path("message").asText(null)).orElse("未知错误");
                return SubtitleResponse.failure(message);
            }

            if (textOnly) {
                JsonNode subtitleList = responseData.path("data").path("subtitleItemVoList");
                if (subtitleList.isArray()) {
                    subtitleList.forEach(item -> {
                        if (item.has("content")) {
                            String original = item.get("content").asText("");
                            ((com.fasterxml.jackson.databind.node.ObjectNode) item).put("content_with_timestamp", original);
                            ((com.fasterxml.jackson.databind.node.ObjectNode) item).put("content", parseSrtToText(original));
                        }
                    });
                }
            }

            return SubtitleResponse.success(responseData);
        } catch (TimeoutError e) {
            return SubtitleResponse.failure("操作超时");
        } catch (Exception e) {
            return SubtitleResponse.failure(e.getMessage());
        }
    }

    private static void waitForApiResponse(AtomicReference<JsonNode> apiResponse, Duration timeout) {
        long waited = 0;
        long maxMillis = timeout.toMillis();
        long step = 500;
        while (apiResponse.get() == null && waited < maxMillis) {
            try {
                Thread.sleep(step);
            } catch (InterruptedException ignored) {
            }
            waited += step;
        }
    }

    private static String normalizeUrl(String videoUrl) {
        if (videoUrl == null) {
            return "";
        }
        String trimmed = videoUrl.trim();
        if (trimmed.startsWith("BV")) {
            return "https://www.bilibili.com/video/" + trimmed;
        }
        return trimmed;
    }

    public static class SubtitleResponse {
        private final boolean success;
        private final String error;
        private final JsonNode data;

        private SubtitleResponse(boolean success, String error, JsonNode data) {
            this.success = success;
            this.error = error;
            this.data = data;
        }

        public static SubtitleResponse success(JsonNode data) {
            return new SubtitleResponse(true, null, data);
        }

        public static SubtitleResponse failure(String error) {
            return new SubtitleResponse(false, error, null);
        }

        public boolean isSuccess() {
            return success;
        }

        public Optional<String> getError() {
            return Optional.ofNullable(error);
        }

        public Optional<JsonNode> getData() {
            return Optional.ofNullable(data);
        }
    }

    /**
     * 简单示例用法。
     */
    public static void main(String[] args) {
        String target = args.length > 0 ? args[0] : "BV1xx411c7mD";
        boolean textOnly = args.length < 2 || Boolean.parseBoolean(args[1]);

        SubtitleResponse response = fetchSubtitle(target, textOnly);
        if (response.isSuccess()) {
            System.out.println("字幕获取成功: " + response.getData().orElse(null));
        } else {
            System.err.println("获取失败: " + response.getError().orElse("未知错误"));
        }
    }
}
