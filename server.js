const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');
const yaml = require('js-yaml');
const twelvelabs = require('./twelvelabs');

const PORT = 8765;

// 读取配置文件
function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'env.yaml');
        const fileContents = fs.readFileSync(configPath, 'utf8');
        const config = yaml.load(fileContents);
        return config;
    } catch (error) {
        console.error('❌ 读取配置文件失败:', error);
        return {};
    }
}

const config = loadConfig();

// 检测当前是否处于无桌面环境（如 Docker 容器）
function isHeadlessEnvironment() {
    if (process.env.HEADLESS === '1' || process.env.DISABLE_FOLDER_OPEN === '1') {
        return true;
    }

    try {
        // 常见容器标识文件
        if (fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')) {
            return true;
        }
    } catch (error) {
        return true;
    }

    // Linux 无显示变量时大概率没有桌面
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        return true;
    }

    return false;
}

// 下载文件辅助函数
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {}); // 删除失败的文件
            reject(err);
        });
    });
}

// MIME类型映射
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // 处理CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    console.log(`${req.method} ${req.url}`);

    // 处理API请求 - 保存文案文件
    if (req.url === '/api/save-copywriting' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { projectPath, ttsData, imageData } = data;
                
                // 创建文案文件夹
                const copywritingFolder = path.join(projectPath, '文案');
                
                if (!fs.existsSync(copywritingFolder)) {
                    fs.mkdirSync(copywritingFolder, { recursive: true });
                }
                
                // 保存TTS文案
                const ttsFilePath = path.join(copywritingFolder, 'TTS文案.json');
                fs.writeFileSync(ttsFilePath, JSON.stringify(ttsData, null, 2), 'utf-8');
                
                // 保存图像文案
                const imageFilePath = path.join(copywritingFolder, '图像文案.json');
                fs.writeFileSync(imageFilePath, JSON.stringify(imageData, null, 2), 'utf-8');
                
                // 保存完整数据
                const fullDataPath = path.join(copywritingFolder, '完整数据.json');
                fs.writeFileSync(fullDataPath, JSON.stringify({ TTS文案: ttsData, 图像文案: imageData }, null, 2), 'utf-8');
                
                console.log(`✅ 文案已保存到: ${copywritingFolder}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: '文案保存成功',
                    path: copywritingFolder 
                }));
                
            } catch (error) {
                console.error('❌ 保存文案失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: `保存失败: ${error.message}` 
                }));
            }
        });
        
        return;
    }

    // 处理API请求 - 生成TTS（同步）
    if (req.url === '/api/generate-tts' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { projectPath, apiKey, promptAudioUrl, promptText, inputs, emoText, useEmoText } = data;
                
                // 构建请求体
                const requestBody = {
                    input: inputs,
                    model: 'IndexTTS-2',
                    prompt_audio_url: promptAudioUrl,
                    prompt_text: promptText,
                    voice: 'alloy',
                    use_emo_text: useEmoText
                };
                
                // 只有在useEmoText为true时才添加emo_text字段
                if (useEmoText && emoText) {
                    requestBody.emo_text = emoText;
                }
                
                console.log('🎙️ 开始生成TTS...');
                
                // 调用同步TTS API
                const response = await fetch('https://ai.gitee.com/v1/audio/speech', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                // 创建TTS文件夹
                const ttsFolder = path.join(projectPath, 'tts');
                if (!fs.existsSync(ttsFolder)) {
                    fs.mkdirSync(ttsFolder, { recursive: true });
                }
                
                // 创建文本文件夹
                const textFolder = path.join(ttsFolder, 'text');
                if (!fs.existsSync(textFolder)) {
                    fs.mkdirSync(textFolder, { recursive: true });
                }
                
                // 获取下一个编号
                const files = fs.readdirSync(ttsFolder).filter(f => f.match(/^\d+\.wav$/));
                const nextNumber = files.length > 0 
                    ? Math.max(...files.map(f => parseInt(f.split('.')[0]))) + 1 
                    : 1;
                
                const audioPath = path.join(ttsFolder, `${nextNumber}.wav`);
                
                // 保存音频流
                const buffer = await response.arrayBuffer();
                fs.writeFileSync(audioPath, Buffer.from(buffer));
                
                
                console.log(`✅ 音频已保存: ${audioPath}`);
                
                
                // 保存文本到 text/{nextNumber}.txt
                const textPath = path.join(textFolder, `${nextNumber}.txt`);
                fs.writeFileSync(textPath, inputs, 'utf-8');
                
                console.log(`✅ 文本已保存: ${textPath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: true,
                    filename: `${nextNumber}.wav`,
                    message: '语音生成成功'
                }));
                
            } catch (error) {
                console.error('❌ TTS生成失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: `生成失败: ${error.message}` 
                }));
            }
        });
        
        return;
    }

    // 处理API请求 - 打开TTS文件夹
    if (req.url === '/api/open-tts-folder' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { projectPath } = data;
                
                const ttsFolder = path.join(projectPath, 'tts');
                
                if (!fs.existsSync(ttsFolder)) {
                    fs.mkdirSync(ttsFolder, { recursive: true });
                }

                // 无桌面环境（如 Docker）直接返回路径，避免 xdg-open 等命令失败
                if (isHeadlessEnvironment()) {
                    console.log(`🗂️ 运行在无桌面环境，已返回路径: ${ttsFolder}`);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: true,
                        message: '容器/无桌面环境，请在宿主机手动打开此路径',
                        path: ttsFolder
                    }));
                    return;
                }

                // 使用系统命令打开文件夹
                const command = process.platform === 'win32' 
                    ? `explorer "${ttsFolder}"` 
                    : process.platform === 'darwin'
                    ? `open "${ttsFolder}"`
                    : `xdg-open "${ttsFolder}"`;
                
                exec(command, (error) => {
                    if (error) {
                        console.error('打开文件夹失败:', error);
                    }
                });
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
                
            } catch (error) {
                console.error('❌ 打开文件夹失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: `打开失败: ${error.message}` 
                }));
            }
        });
        
        return;
    }

    // 处理API请求 - 打开项目目录
    if (req.url === '/api/open-project-folder' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = body ? JSON.parse(body) : {};
                const { projectPath } = data;

                if (!projectPath || typeof projectPath !== 'string') {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: false,
                        message: '无效的项目路径'
                    }));
                    return;
                }

                const resolvedPath = path.resolve(projectPath);

                if (!fs.existsSync(resolvedPath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: false,
                        message: '项目路径不存在'
                    }));
                    return;
                }

                if (isHeadlessEnvironment()) {
                    console.log(`🗂️ 运行在无桌面环境，已返回路径: ${resolvedPath}`);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: true,
                        message: '容器/无桌面环境，请在宿主机手动打开此路径',
                        path: resolvedPath
                    }));
                    return;
                }

                const command = process.platform === 'win32'
                    ? `explorer "${resolvedPath}"`
                    : process.platform === 'darwin'
                    ? `open "${resolvedPath}"`
                    : `xdg-open "${resolvedPath}"`;

                exec(command, (error) => {
                    if (error) {
                        console.error('打开项目目录失败:', error);
                    }
                });

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('打开项目目录失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: false,
                    message: `打开失败: ${error.message}`
                }));
            }
        });

        return;
    }

    if (req.url === '/api/default-tts-config' && req.method === 'GET') {
        const defaultConfig = {
            apiKey: config ? config['TTS-API-KEY'] || '' : '',
            promptAudioUrl: config ? config['TTS-Prompt-Audio-URL'] || '' : '',
            promptText: config ? config['TTS-Prompt-Text'] || '' : '',
            defaultProjectRoot: config ? config['Default-Project-Root'] || '' : ''
        };

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            success: true,
            data: defaultConfig
        }));
        return;
    }

    if (req.url === '/api/open-asr-tool' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const asrToolPath = path.join(__dirname, 'asr', 'AsrTools.exe');

                if (!fs.existsSync(asrToolPath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: false,
                        message: '未找到字幕生成工具'
                    }));
                    return;
                }

                if (process.platform !== 'win32') {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: false,
                        message: '当前系统不支持启动字幕生成工具'
                    }));
                    return;
                }

                const child = execFile(asrToolPath, {
                    cwd: path.dirname(asrToolPath)
                }, (error) => {
                    if (error) {
                        console.error('打开字幕生成工具失败:', error);
                    }
                });

                if (child && typeof child.unref === 'function') {
                    child.unref();
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    message: '字幕生成工具已打开'
                }));
            } catch (error) {
                console.error('启动字幕生成工具失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: false,
                    message: `打开失败: ${error.message}`
                }));
            }
        });

        return;
    }

    // 处理API请求 - 生成图片（文本模式）
    if (req.url === '/api/generate-image-text' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { projectPath, imageType, prompt, aspectRatio, characterName, backgroundName } = data;
                
                // 确定保存目录
                let saveDir;
                let filename;
                let name = characterName || backgroundName; // 支持两种参数名
                
                if (imageType === 'character') {
                    saveDir = path.join(projectPath, 'image', 'character');
                    filename = `${name}.png`;
                } else if (imageType === 'background') {
                    saveDir = path.join(projectPath, 'image', 'background');
                    // 如果提供了背景名称，直接使用；否则自动编号
                    if (name && name.trim()) {
                        filename = `${name}.png`;
                    } else {
                        // 获取下一个编号
                        if (!fs.existsSync(saveDir)) {
                            fs.mkdirSync(saveDir, { recursive: true });
                        }
                        const files = fs.readdirSync(saveDir).filter(f => f.match(/^\d+\.png$/));
                        const nextNumber = files.length > 0 
                            ? Math.max(...files.map(f => parseInt(f.split('.')[0]))) + 1 
                            : 1;
                        filename = `${nextNumber}.png`;
                    }
                } else {
                    throw new Error('无效的imageType');
                }
                
                // 确保目录存在
                if (!fs.existsSync(saveDir)) {
                    fs.mkdirSync(saveDir, { recursive: true });
                }
                
                const savePath = path.join(saveDir, filename);
                
                // 调用Gemini API生成图片
                const apiKey = config['Gemini-API-KEY'];
                const baseUrl = config['Gemini-BASE-URL'];
                const model = config['Gemini-MODEL'];
                const endpoint = `${baseUrl}/v1beta/models/${model}:generateContent`;
                
                const requestBody = {
                    contents: [{
                        parts: [
                            { text: prompt }
                        ]
                    }]
                };
                
                if (aspectRatio) {
                    requestBody.generationConfig = {
                        imageConfig: {
                            aspectRatio: aspectRatio
                        }
                    };
                }
                console.log(endpoint);
                
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'x-goog-api-key': apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody),
                    timeout: 120000
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }
                
                const responseData = await response.json();
                
                // 提取图像数据
                if (!responseData.candidates || responseData.candidates.length === 0) {
                    throw new Error('API响应中没有找到生成的图像');
                }
                
                const candidate = responseData.candidates[0];
                if (!candidate.content || !candidate.content.parts) {
                    throw new Error('API响应格式不正确');
                }
                
                let imageData = null;
                for (const part of candidate.content.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        imageData = part.inlineData.data;
                        break;
                    }
                }
                
                if (!imageData) {
                    throw new Error('未找到图像数据');
                }
                
                // 解码并保存图像
                const imageBytes = Buffer.from(imageData, 'base64');
                fs.writeFileSync(savePath, imageBytes);
                
                console.log(`✅ 图片生成成功: ${savePath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    file_path: savePath,
                    file_size: imageBytes.length,
                    message: `图片生成成功: ${savePath}`
                }));
                
            } catch (error) {
                console.error('❌ 图片生成失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: `生成失败: ${error.message}` 
                }));
            }
        });
        
        return;
    }

    // 处理API请求 - 生成图片（参考图模式）
    if (req.url === '/api/generate-image-reference' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { projectPath, imageType, imagePaths, prompt, aspectRatio, characterName, backgroundName } = data;
                
                // 验证参考图片路径
                const validImagePaths = imagePaths.filter(p => {
                    const trimmed = p.trim();
                    return trimmed && fs.existsSync(trimmed);
                });
                
                if (validImagePaths.length === 0) {
                    throw new Error('没有找到有效的参考图片文件');
                }
                
                // 确定保存目录和文件名
                let saveDir;
                let filename;
                let name = characterName || backgroundName; // 支持两种参数名
                
                if (imageType === 'character') {
                    saveDir = path.join(projectPath, 'image', 'character');
                    filename = `${name}.png`;
                } else if (imageType === 'background') {
                    saveDir = path.join(projectPath, 'image', 'background');
                    // 如果提供了背景名称，直接使用；否则自动编号
                    if (name && name.trim()) {
                        filename = `${name}.png`;
                    } else {
                        // 获取下一个编号
                        if (!fs.existsSync(saveDir)) {
                            fs.mkdirSync(saveDir, { recursive: true });
                        }
                        const files = fs.readdirSync(saveDir).filter(f => f.match(/^\d+\.png$/));
                        const nextNumber = files.length > 0 
                            ? Math.max(...files.map(f => parseInt(f.split('.')[0]))) + 1 
                            : 1;
                        filename = `${nextNumber}.png`;
                    }
                } else {
                    throw new Error('无效的imageType');
                }
                
                if (!fs.existsSync(saveDir)) {
                    fs.mkdirSync(saveDir, { recursive: true });
                }
                
                const savePath = path.join(saveDir, filename);
                
                // 读取参考图片并转换为base64
                const parts = [];
                
                for (const imagePath of validImagePaths) {
                    const trimmedPath = imagePath.trim();
                    if (fs.existsSync(trimmedPath)) {
                        const imageBuffer = fs.readFileSync(trimmedPath);
                        const base64Image = imageBuffer.toString('base64');
                        
                        // 获取文件扩展名以确定MIME类型
                        const ext = path.extname(trimmedPath).toLowerCase();
                        let mimeType = 'image/jpeg';
                        if (ext === '.png') mimeType = 'image/png';
                        else if (ext === '.gif') mimeType = 'image/gif';
                        else if (ext === '.webp') mimeType = 'image/webp';
                        
                        parts.push({
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Image
                            }
                        });
                    }
                }
                
                parts.push({ text: prompt });
                
                // 调用Gemini API
                const apiKey = config['Gemini-API-KEY'];
                const baseUrl = config['Gemini-BASE-URL'];
                const model = config['Gemini-MODEL'];
                const endpoint = `${baseUrl}/v1beta/models/${model}:generateContent`;
                
                const requestBody = {
                    contents: [{
                        parts: parts
                    }]
                };
                
                if (aspectRatio) {
                    requestBody.generationConfig = {
                        imageConfig: {
                            aspectRatio: aspectRatio
                        }
                    };
                }
                
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'x-goog-api-key': apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody),
                    timeout: 120000
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }
                
                const responseData = await response.json();
                
                // 提取图像数据
                if (!responseData.candidates || responseData.candidates.length === 0) {
                    throw new Error('API响应中没有找到生成的图像');
                }
                
                const candidate = responseData.candidates[0];
                if (!candidate.content || !candidate.content.parts) {
                    throw new Error('API响应格式不正确');
                }
                
                let imageData = null;
                for (const part of candidate.content.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        imageData = part.inlineData.data;
                        break;
                    }
                }
                
                if (!imageData) {
                    throw new Error('未找到图像数据');
                }
                
                // 解码并保存图像
                const imageBytes = Buffer.from(imageData, 'base64');
                fs.writeFileSync(savePath, imageBytes);
                
                console.log(`✅ 图片生成成功: ${savePath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    file_path: savePath,
                    file_size: imageBytes.length,
                    message: `图片生成成功: ${savePath}`
                }));
                
            } catch (error) {
                console.error('❌ 图片生成失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: `生成失败: ${error.message}` 
                }));
            }
        });
        
        return;
    }

    // 处理API请求 - 保存草稿
    if (req.url === '/api/save-draft' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { projectPath, draftData } = data;
                
                // 创建draft文件夹
                const draftFolder = path.join(projectPath, '.draft');
                if (!fs.existsSync(draftFolder)) {
                    fs.mkdirSync(draftFolder, { recursive: true });
                }
                
                // 保存草稿文件
                const draftPath = path.join(draftFolder, 'workspace-draft.json');
                fs.writeFileSync(draftPath, JSON.stringify(draftData, null, 2), 'utf-8');
                
                console.log(`✅ 草稿已保存: ${draftPath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: '草稿已保存' 
                }));
                
            } catch (error) {
                console.error('❌ 保存草稿失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: `保存失败: ${error.message}` 
                }));
            }
        });
        
        return;
    }

    // 处理API请求 - 加载草稿
    if (req.url === '/api/load-draft' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { projectPath } = data;
                
                // 读取草稿文件
                const draftPath = path.join(projectPath, '.draft', 'workspace-draft.json');
                
                if (!fs.existsSync(draftPath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        message: '没有找到保存的草稿' 
                    }));
                    return;
                }
                
                const draftContent = fs.readFileSync(draftPath, 'utf-8');
                const draftData = JSON.parse(draftContent);
                
                console.log(`✅ 草稿已加载: ${draftPath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: true, 
                    data: draftData 
                }));
                
            } catch (error) {
                console.error('❌ 加载草稿失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: `加载失败: ${error.message}` 
                }));
            }
        });
        
        return;
    }

    // 处理API请求 - 清空草稿
    if (req.url === '/api/clear-draft' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { projectPath } = data;
                
                // 删除草稿文件
                const draftPath = path.join(projectPath, '.draft', 'workspace-draft.json');
                
                if (fs.existsSync(draftPath)) {
                    fs.unlinkSync(draftPath);
                    console.log(`✅ 草稿已清空: ${draftPath}`);
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: '草稿已清空' 
                }));
                
            } catch (error) {
                console.error('❌ 清空草稿失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: `清空失败: ${error.message}` 
                }));
            }
        });
        
        return;
    }

    // 处理API请求 - 打开图片所在文件夹
    if (req.url === '/api/open-image-folder' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { filePath } = data;
                
                if (!filePath) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        message: '未提供文件路径' 
                    }));
                    return;
                }

                // 提取文件所在的目录
                const folderPath = path.dirname(filePath);
                
                if (!fs.existsSync(folderPath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ 
                        success: false, 
                    message: '目录不存在' 
                }));
                return;
            }
                
                if (isHeadlessEnvironment()) {
                    console.log(`🗂️ 运行在无桌面环境，已返回路径: ${folderPath}`);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ 
                        success: true,
                        message: '容器/无桌面环境，请在宿主机手动打开此路径',
                        path: folderPath
                    }));
                    return;
                }

                // 使用系统命令打开文件夹
                const command = process.platform === 'win32' 
                    ? `explorer "${folderPath}"` 
                    : process.platform === 'darwin'
                    ? `open "${folderPath}"`
                    : `xdg-open "${folderPath}"`;
                
                exec(command, (error) => {
                    if (error) {
                        console.error('❌ 打开文件夹失败:', error);
                    }
                });
                
                console.log(`✅ 已打开文件夹: ${folderPath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: true,
                    message: '文件夹已打开'
                }));
                
            } catch (error) {
                console.error('❌ 打开文件夹失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: `打开失败: ${error.message}` 
                }));
            }
        });
        
        return;
    }

    // 处理API请求 - 自由创作图片
    if (req.url === '/api/free-create-image' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { projectPath, prompt, aspectRatio, saveFolder, referenceImages } = data;
                
                if (!prompt) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        message: '请提供提示词' 
                    }));
                    return;
                }
                
                // 确定保存目录
                const saveDir = saveFolder || path.join(projectPath, 'free-create');
                
                // 确保目录存在
                if (!fs.existsSync(saveDir)) {
                    fs.mkdirSync(saveDir, { recursive: true });
                }
                
                // 生成文件名（使用时间戳）
                const timestamp = Date.now();
                const filename = `free-create-${timestamp}.png`;
                const savePath = path.join(saveDir, filename);
                
                // 调用Gemini API生成图片
                const apiKey = config['Gemini-API-KEY'];
                const baseUrl = config['Gemini-BASE-URL'];
                const model = config['Gemini-MODEL'];
                const endpoint = `${baseUrl}/v1beta/models/${model}:generateContent`;
                
                // 构建请求体
                const requestBody = {
                    contents: [{
                        parts: []
                    }]
                };
                
                // 如果有参考图片，添加到请求中
                if (referenceImages && referenceImages.length > 0) {
                    referenceImages.forEach(img => {
                        requestBody.contents[0].parts.push({
                            inlineData: {
                                mimeType: 'image/png',
                                data: img.data
                            }
                        });
                    });
                }
                
                // 添加提示词
                requestBody.contents[0].parts.push({
                    text: prompt
                });
                
                // 如果有比例设置，添加到配置中
                if (aspectRatio) {
                    requestBody.generationConfig = {
                        imageConfig: {
                            aspectRatio: aspectRatio
                        }
                    };
                }
                
                console.log('开始自由创作图片...');
                console.log('提示词:', prompt);
                console.log('比例:', aspectRatio || '自动');
                console.log('参考图数量:', referenceImages ? referenceImages.length : 0);
                
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'x-goog-api-key': apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody),
                    timeout: 120000
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }
                
                const responseData = await response.json();
                
                // 提取图像数据
                if (!responseData.candidates || responseData.candidates.length === 0) {
                    throw new Error('API响应中没有找到生成的图像');
                }
                
                const candidate = responseData.candidates[0];
                if (!candidate.content || !candidate.content.parts) {
                    throw new Error('API响应格式不正确');
                }
                
                let imageData = null;
                for (const part of candidate.content.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        imageData = part.inlineData.data;
                        break;
                    }
                }
                
                if (!imageData) {
                    throw new Error('未找到图像数据');
                }
                
                // 解码并保存图像
                const imageBytes = Buffer.from(imageData, 'base64');
                fs.writeFileSync(savePath, imageBytes);
                
                console.log(`✅ 图片已保存: ${savePath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: true,
                    imagePath: savePath,
                    imageData: imageData,
                    message: '图片生成成功'
                }));
                
            } catch (error) {
                console.error('❌ 自由创作图片失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: `生成失败: ${error.message}` 
                }));
            }
        });
        
        return;
    }

    // 处理API请求 - 保存自由创作图片到指定文件夹
    if (req.url === '/api/save-free-create-image' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { imagePath, targetFolder } = data;
                
                if (!imagePath || !targetFolder) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        message: '参数不完整' 
                    }));
                    return;
                }
                
                // 检查源文件是否存在
                if (!fs.existsSync(imagePath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        message: '源文件不存在' 
                    }));
                    return;
                }
                
                // 确保目标目录存在
                if (!fs.existsSync(targetFolder)) {
                    fs.mkdirSync(targetFolder, { recursive: true });
                }
                
                // 复制文件
                const filename = path.basename(imagePath);
                const targetPath = path.join(targetFolder, filename);
                fs.copyFileSync(imagePath, targetPath);
                
                console.log(`✅ 图片已复制到: ${targetPath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: true,
                    targetPath: targetPath,
                    message: '图片已保存'
                }));
                
            } catch (error) {
                console.error('❌ 保存图片失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: `保存失败: ${error.message}` 
                }));
            }
        });
        
        return;
    }

    // 处理API请求 - 获取图片（base64格式，用于预览）
    if (req.url.startsWith('/api/get-image?') && req.method === 'GET') {
        try {
            const urlParams = new URLSearchParams(req.url.split('?')[1]);
            const filePath = urlParams.get('path');
            
            if (!filePath || !fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: '文件不存在' 
                }));
                return;
            }
            
            const imageBuffer = fs.readFileSync(filePath);
            const base64Image = imageBuffer.toString('base64');
            
            // 获取文件扩展名以确定MIME类型
            const ext = path.extname(filePath).toLowerCase();
            let mimeType = 'image/jpeg';
            if (ext === '.png') mimeType = 'image/png';
            else if (ext === '.gif') mimeType = 'image/gif';
            else if (ext === '.webp') mimeType = 'image/webp';
            
            const dataUrl = `data:${mimeType};base64,${base64Image}`;
            
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                success: true,
                data_url: dataUrl
            }));
            
        } catch (error) {
            console.error('❌ 获取图片失败:', error);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ 
                success: false, 
                message: `获取失败: ${error.message}` 
            }));
        }
        
        return;
    }

    // ============ TwelveLabs 集成（可选，未配置 Key 时不影响任何功能） ============

    // 查询 TwelveLabs 是否已启用（前端可据此决定是否展示相关入口）
    if (req.url === '/api/twelvelabs/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            success: true,
            enabled: twelvelabs.isEnabled(config),
            pegasusModel: twelvelabs.PEGASUS_MODEL,
            marengoModel: twelvelabs.MARENGO_MODEL
        }));
        return;
    }

    // Pegasus：理解参考视频/源视频，辅助文案与分镜策划
    if (req.url === '/api/twelvelabs/analyze-video' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const data = JSON.parse(body || '{}');
                const { video, prompt, maxTokens } = data;

                console.log('🎬 调用 Pegasus 分析视频...');
                const text = await twelvelabs.analyzeVideo(config, { video, prompt, maxTokens });

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, data: text }));
            } catch (error) {
                console.error('❌ Pegasus 分析失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, message: `分析失败: ${error.message}` }));
            }
        });

        return;
    }

    // Marengo：按查询对候选素材做相似度排序，辅助素材选择
    if (req.url === '/api/twelvelabs/rank-materials' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const data = JSON.parse(body || '{}');
                const { query, candidates, topK } = data;

                console.log('🔎 调用 Marengo 进行素材排序...');
                const ranked = await twelvelabs.rankMaterials(config, { query, candidates, topK });

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, data: ranked }));
            } catch (error) {
                console.error('❌ Marengo 素材排序失败:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, message: `排序失败: ${error.message}` }));
            }
        });

        return;
    }

    // ====================== TwelveLabs 集成结束 ======================

    // 处理路径
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);

    // 获取文件扩展名
    const extname = path.extname(filePath);
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    // 读取并返回文件
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // 文件不存在，返回404
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`
                    <html>
                        <head>
                            <meta charset="utf-8">
                            <title>404 - 未找到</title>
                            <style>
                                body {
                                    font-family: Arial, sans-serif;
                                    display: flex;
                                    justify-content: center;
                                    align-items: center;
                                    height: 100vh;
                                    margin: 0;
                                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                    color: white;
                                }
                                .error-container {
                                    text-align: center;
                                }
                                h1 {
                                    font-size: 6rem;
                                    margin: 0;
                                }
                                p {
                                    font-size: 1.5rem;
                                }
                            </style>
                        </head>
                        <body>
                            <div class="error-container">
                                <h1>404</h1>
                                <p>页面未找到</p>
                                <p><a href="/" style="color: white;">返回首页</a></p>
                            </div>
                        </body>
                    </html>
                `);
            } else {
                // 服务器错误
                res.writeHead(500);
                res.end(`服务器错误: ${err.code}`);
            }
        } else {
            // 成功返回文件
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log('========================================');
    console.log('🎬 视频生成工作站服务器已启动！');
    console.log(`📡 服务运行在: http://localhost:${PORT}`);
    console.log('========================================');
    console.log('\n按 Ctrl+C 停止服务器\n');
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n\n👋 服务器正在关闭...');
    server.close(() => {
        console.log('✅ 服务器已关闭');
        process.exit(0);
    });
});

