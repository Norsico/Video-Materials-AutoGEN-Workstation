// TwelveLabs 集成（可选）
// ------------------------------------------------------------------
// 为工作站提供两项视频理解能力，均为「按需启用」：
//   1. Pegasus —— 理解参考视频/源视频的内容，辅助文案与分镜策划。
//   2. Marengo —— 把文本统一编码成 512 维向量，用余弦相似度为
//      「素材选择」环节做检索 / 排序（例如挑出最贴合脚本的图片素材）。
//
// 仅在 env.yaml 中填写了 TwelveLabs-API-KEY 时才会生效；
// 未配置时整个模块返回「未启用」，不影响任何既有功能。
//
// 直接调用官方 REST API（https://api.twelvelabs.io/v1.3），与项目里
// 其它 AI 接口一样使用全局 fetch，不引入额外依赖。需要 Node 18+
// （README 推荐的 node:20 已自带 fetch）。
//
// 注意：Pegasus 1.5 不接受裸 video_id，必须用公网 URL 或已上传的
// asset_id；本地直传素材上限 200MB，公网 URL 上限 4GB；被分析的视频
// 时长需 >= 4 秒。Marengo 的 /embed 接口对每个请求（含纯文本）都要求
// multipart/form-data，原始向量字段名为 float。

const TL_BASE_URL = 'https://api.twelvelabs.io/v1.3';
const PEGASUS_MODEL = 'pegasus1.5';
const MARENGO_MODEL = 'marengo3.0';

// 从配置中读取 API Key（绝不硬编码）。
function getApiKey(config) {
    return (config && config['TwelveLabs-API-KEY']) || '';
}

function isEnabled(config) {
    return Boolean(getApiKey(config));
}

// 用 Pegasus 理解一段视频，返回模型生成的文本。
// video: { type: 'url', url } 或 { type: 'asset_id', asset_id }
async function analyzeVideo(config, { video, prompt, maxTokens = 1024 } = {}) {
    const apiKey = getApiKey(config);
    if (!apiKey) {
        throw new Error('未配置 TwelveLabs-API-KEY，请在 env.yaml 中填写后重试');
    }
    if (!video || !video.type) {
        throw new Error('video 参数无效：需要 { type: "url", url } 或 { type: "asset_id", asset_id }');
    }
    if (!prompt) {
        throw new Error('prompt 不能为空');
    }
    // Pegasus 1.5 的 max_tokens 下限为 512。
    const max_tokens = Math.max(512, Number(maxTokens) || 0);

    const response = await fetch(`${TL_BASE_URL}/analyze`, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model_name: PEGASUS_MODEL,
            prompt,
            video,
            max_tokens
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Pegasus 分析失败 HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    return result.data || '';
}

// 用 Marengo 把一段文本编码成 512 维向量。
async function embedText(config, text) {
    const apiKey = getApiKey(config);
    if (!apiKey) {
        throw new Error('未配置 TwelveLabs-API-KEY，请在 env.yaml 中填写后重试');
    }
    if (!text) {
        throw new Error('text 不能为空');
    }

    // /embed 接口要求 multipart/form-data（纯文本请求也是如此）。
    const form = new FormData();
    form.append('model_name', MARENGO_MODEL);
    form.append('text', text);

    const response = await fetch(`${TL_BASE_URL}/embed`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: form
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Marengo 编码失败 HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const segments = (result.text_embedding && result.text_embedding.segments) || [];
    if (!segments.length || !segments[0].float) {
        throw new Error('Marengo 响应中没有找到向量');
    }
    return segments[0].float; // 512 维
}

// 余弦相似度。
function cosineSimilarity(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
}

// 「素材选择」核心：给定一句查询（如某条分镜脚本）和一组候选素材的
// 文字描述，用 Marengo 向量的余弦相似度排序，返回按相关度降序的列表。
async function rankMaterials(config, { query, candidates = [], topK } = {}) {
    if (!query) {
        throw new Error('query 不能为空');
    }
    if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error('candidates 需要是非空数组');
    }

    const queryVec = await embedText(config, query);
    const scored = [];
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const label = typeof c === 'string' ? c : (c.label || c.text || c.description || '');
        const text = typeof c === 'string' ? c : (c.text || c.description || c.label || '');
        const vec = await embedText(config, text);
        scored.push({ index: i, label, score: cosineSimilarity(queryVec, vec) });
    }
    scored.sort((x, y) => y.score - x.score);
    return topK && topK > 0 ? scored.slice(0, topK) : scored;
}

module.exports = {
    TL_BASE_URL,
    PEGASUS_MODEL,
    MARENGO_MODEL,
    getApiKey,
    isEnabled,
    analyzeVideo,
    embedText,
    cosineSimilarity,
    rankMaterials
};
