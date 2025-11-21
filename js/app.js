// 应用状态管理
const APP_STATE = {
    projects: [],
    currentProject: null,
    currentCopywriting: null,
    checkboxStates: {}, // 存储checkbox状态
    generatingTasks: {}, // 存储正在生成的任务状态 {taskId: {type, imageType, mode, startTime}}
    ttsDefaults: null,
    defaultProjectRoot: ''
};

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    loadProjects();
    renderProjects();
    setupTabNavigation();
    loadGlobalPrompts();
    initFreeCreate();
    initSubtitleHelper();
    setupProjectPathAutoFill();
    fetchDefaultTTSConfig();
});

async function fetchDefaultTTSConfig(force = false) {
    if (!force && APP_STATE.ttsDefaults) {
        return APP_STATE.ttsDefaults;
    }

    try {
        const response = await fetch('http://localhost:8765/api/default-tts-config');
        const result = await response.json();

        if (response.ok && result.success) {
            APP_STATE.ttsDefaults = result.data || null;
            APP_STATE.defaultProjectRoot = result.data && result.data.defaultProjectRoot ? result.data.defaultProjectRoot : '';
            if (projectPathAutoFillInitialized) {
                autoFillProjectPath(true);
            }
            return APP_STATE.ttsDefaults;
        }
    } catch (error) {
        console.error('加载默认TTS配置失败:', error);
    }

    return null;
}

let projectPathAutoFillInitialized = false;

// ==================== 项目管理 ====================

// 从localStorage加载项目
function loadProjects() {
    const saved = localStorage.getItem('videoWorkstationProjects');
    if (saved) {
        APP_STATE.projects = JSON.parse(saved);
    }
}

// 保存项目到localStorage
function saveProjects() {
    localStorage.setItem('videoWorkstationProjects', JSON.stringify(APP_STATE.projects));
}

function setupProjectPathAutoFill() {
    if (projectPathAutoFillInitialized) {
        return;
    }

    const nameInput = document.getElementById('projectName');
    const pathInput = document.getElementById('projectPath');
    const autoCheckbox = document.getElementById('useDefaultProjectPath');

    if (!nameInput || !pathInput || !autoCheckbox) {
        return;
    }

    projectPathAutoFillInitialized = true;

    pathInput.dataset.autoFilled = pathInput.dataset.autoFilled || 'false';
    pathInput.dataset.manual = pathInput.dataset.manual || 'false';

    nameInput.addEventListener('input', () => {
        autoFillProjectPath();
    });

    autoCheckbox.addEventListener('change', () => {
        if (autoCheckbox.checked) {
            pathInput.dataset.manual = 'false';
            autoFillProjectPath(true);
        } else {
            pathInput.dataset.autoFilled = 'false';
            pathInput.dataset.manual = pathInput.value ? 'true' : 'false';
        }
    });

    pathInput.addEventListener('input', () => {
        if (pathInput.dataset.autoFilled === 'true') {
            pathInput.dataset.autoFilled = 'false';
        }
        pathInput.dataset.manual = 'true';
    });
}

function autoFillProjectPath(force = false) {
    const nameInput = document.getElementById('projectName');
    const pathInput = document.getElementById('projectPath');
    const autoCheckbox = document.getElementById('useDefaultProjectPath');

    if (!nameInput || !pathInput || !autoCheckbox) {
        return;
    }

    if (!autoCheckbox.checked || !APP_STATE.defaultProjectRoot) {
        return;
    }

    const projectName = nameInput.value.trim();
    const wasAutoFilled = pathInput.dataset.autoFilled === 'true';
    const isManual = pathInput.dataset.manual === 'true';

    if (!force && isManual && !wasAutoFilled) {
        return;
    }

    if (!projectName) {
        if (wasAutoFilled || force) {
            pathInput.value = '';
            pathInput.dataset.autoFilled = 'true';
            pathInput.dataset.manual = 'false';
        }
        return;
    }

    const autoPath = buildProjectPath(APP_STATE.defaultProjectRoot, projectName);
    pathInput.value = autoPath;
    pathInput.dataset.autoFilled = 'true';
    pathInput.dataset.manual = 'false';
}

function buildProjectPath(root, projectName) {
    if (!root) {
        return '';
    }

    const sanitizedName = projectName.replace(/[\\/:*?"<>|]/g, '_');
    const trimmedRoot = root.replace(/[\\\/]+$/, '').trim();
    if (!sanitizedName) {
        return trimmedRoot;
    }

    const useBackslash = /\\/.test(trimmedRoot) || /^[A-Za-z]:/.test(trimmedRoot);
    const separator = useBackslash ? '\\' : '/';
    return `${trimmedRoot}${separator}${sanitizedName}`;
}


// 渲染项目列表
function renderProjects() {
    const projectList = document.getElementById('projectList');
    const emptyState = document.getElementById('emptyState');
    
    if (APP_STATE.projects.length === 0) {
        projectList.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    projectList.style.display = 'grid';
    emptyState.style.display = 'none';
    
    projectList.innerHTML = APP_STATE.projects.map((project, index) => `
        <div class="project-card" onclick="openProject(${index})">
            <h3>${escapeHtml(project.name)}</h3>
            <p>${escapeHtml(project.path)}</p>
            <p class="project-date">创建于: ${new Date(project.createdAt).toLocaleString('zh-CN')}</p>
            <div class="project-actions" onclick="event.stopPropagation()">
                <button class="btn-delete" onclick="deleteProject(${index})">删除</button>
            </div>
        </div>
    `).join('');
}

// 显示创建项目模态框
function showCreateProjectModal() {
    const modal = document.getElementById('createProjectModal');
    modal.classList.add('active');

    const nameInput = document.getElementById('projectName');
    const pathInput = document.getElementById('projectPath');
    if (nameInput) {
        nameInput.value = '';
    }
    if (pathInput) {
        pathInput.value = '';
        pathInput.dataset.autoFilled = 'false';
        pathInput.dataset.manual = 'false';
    }

    const defaultTTSCheckbox = document.getElementById('useDefaultTTSConfig');
    if (defaultTTSCheckbox) {
        defaultTTSCheckbox.checked = true;
    }

    const defaultPathCheckbox = document.getElementById('useDefaultProjectPath');
    if (defaultPathCheckbox) {
        const hasDefaultRoot = !!APP_STATE.defaultProjectRoot;
        defaultPathCheckbox.checked = hasDefaultRoot;
        defaultPathCheckbox.disabled = !hasDefaultRoot;
    }

    autoFillProjectPath();
}

// 关闭创建项目模态框
function closeCreateProjectModal() {
    const modal = document.getElementById('createProjectModal');
    modal.classList.remove('active');
}

// 创建项目
async function createProject() {
    const nameInput = document.getElementById('projectName');
    const pathInput = document.getElementById('projectPath');
    const defaultTTSCheckbox = document.getElementById('useDefaultTTSConfig');
    const defaultPathCheckbox = document.getElementById('useDefaultProjectPath');

    if (defaultPathCheckbox && defaultPathCheckbox.checked) {
        autoFillProjectPath(true);
    }

    const name = nameInput ? nameInput.value.trim() : '';
    const path = pathInput ? pathInput.value.trim() : '';
    const useDefaultTTS = defaultTTSCheckbox ? defaultTTSCheckbox.checked : false;
    
    if (!name) {
        showNotification('请输入项目名称', 'error');
        return;
    }
    
    if (!path) {
        showNotification('请输入保存路径', 'error');
        return;
    }
    
    // 检查项目名称是否已存在
    if (APP_STATE.projects.some(p => p.name === name)) {
        showNotification('项目名称已存在', 'error');
        return;
    }

    let defaultTTSConfig = null;
    if (useDefaultTTS) {
        defaultTTSConfig = await fetchDefaultTTSConfig();

        if (
            !defaultTTSConfig ||
            !defaultTTSConfig.apiKey ||
            !defaultTTSConfig.promptAudioUrl ||
            !defaultTTSConfig.promptText
        ) {
            showNotification('默认TTS配置未正确设置，请检查 env.yaml 或取消使用默认配置', 'error');
            return;
        }
    }
    
    const project = {
        id: Date.now(),
        name: name,
        path: path,
        createdAt: new Date().toISOString(),
        copywriting: null // 存储文案数据
    };

    if (defaultTTSConfig) {
        project.ttsConfig = {
            apiKey: defaultTTSConfig.apiKey,
            promptAudioUrl: defaultTTSConfig.promptAudioUrl,
            promptText: defaultTTSConfig.promptText
        };
    }
    
    APP_STATE.projects.push(project);
    saveProjects();
    renderProjects();
    closeCreateProjectModal();
    showNotification('项目创建成功！', 'success');
}

// 删除项目
function deleteProject(index) {
    if (confirm('确定要删除这个项目吗？此操作不可恢复。')) {
        const project = APP_STATE.projects[index];
        APP_STATE.projects.splice(index, 1);
        saveProjects();
        renderProjects();
        showNotification(`项目 "${project.name}" 已删除`, 'success');
    }
}

// 打开项目
function openProject(index) {
    APP_STATE.currentProject = APP_STATE.projects[index];
    
    // 更新工作区界面
    document.getElementById('currentProjectName').textContent = APP_STATE.currentProject.name;
    document.getElementById('currentProjectPath').textContent = APP_STATE.currentProject.path;
    
    // 切换到工作区页面
    document.getElementById('homePage').classList.remove('active');
    document.getElementById('workspacePage').classList.add('active');
    
    // 加载已有的文案数据（如果有）
    loadExistingCopywriting();
    
    // 加载TTS配置
    loadTTSConfig();
    
    // 自动加载草稿
    loadDraft(true);
    
    // 恢复生成中的按钮状态
    restoreGeneratingButtonStates();
}

// 返回主页
function backToHome() {
    document.getElementById('workspacePage').classList.remove('active');
    document.getElementById('homePage').classList.add('active');
    APP_STATE.currentProject = null;
    APP_STATE.currentCopywriting = null;
    
    // 重置文案生成界面
    resetCopywritingTab();
    
    // 注意：不清除sessionStorage中的任务，这样用户可以在返回后继续监视生成状态
}

// ==================== Tab导航 ====================

function setupTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            
            // 移除所有active状态
            tabButtons.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
            
            // 添加active状态
            btn.classList.add('active');
            const tabId = btn.dataset.tab;
            document.getElementById(tabId + 'Tab').classList.add('active');
            
            // 如果是图片生成Tab，也需要初始化小Tab和恢复生成状态
            if (tabId === 'imageGeneration') {
                setupImageGenerationTabs();
                restoreGeneratingButtonStates();
            }
            
            // 如果是提示词Tab，加载提示词
            if (tabId === 'prompts') {
                loadGlobalPrompts();
            }

            if (tabId === 'subtitle') {
                initSubtitleHelper();
            }
        });
    });
}

// 设置图片生成的小Tab导航
function setupImageGenerationTabs() {
    const subTabButtons = document.querySelectorAll('.sub-tab-btn');
    subTabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // 移除所有active状态
            subTabButtons.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.sub-tab-pane').forEach(pane => pane.classList.remove('active'));
            
            // 添加active状态
            btn.classList.add('active');
            const subTabId = btn.dataset.subtab;
            document.getElementById(subTabId + 'SubTab').classList.add('active');
        });
    });
}

// ==================== 字幕提取 ====================
function initSubtitleHelper() {
    const input = document.getElementById('subtitleVideoUrl');
    if (input && input.dataset.bound !== 'true') {
        input.addEventListener('input', updateSubtitleCommandPreview);
        input.dataset.bound = 'true';
    }

    updateSubtitleCommandPreview();
    loadSubtitleJavaCode();
}

function normalizeSubtitleUrl(raw) {
    if (!raw) return 'BV1xx411c7mD';
    const trimmed = raw.trim();
    if (trimmed.startsWith('BV')) {
        return `https://www.bilibili.com/video/${trimmed}`;
    }
    return trimmed;
}

function updateSubtitleCommandPreview() {
    const commandBlock = document.getElementById('subtitleCommandPreview');
    if (!commandBlock) return;

    const input = document.getElementById('subtitleVideoUrl');
    const normalized = normalizeSubtitleUrl(input ? input.value : '');
    const command = `mvn -Dexec.mainClass="com.example.subtitle.BilibiliSubtitleFetcher" -Dexec.args=\"${normalized} true\" exec:java`;
    commandBlock.textContent = command;
}

async function copySubtitleCommand() {
    const commandBlock = document.getElementById('subtitleCommandPreview');
    if (!commandBlock) return;

    try {
        await navigator.clipboard.writeText(commandBlock.textContent);
        showToast('运行命令已复制');
    } catch (error) {
        console.error('复制命令失败:', error);
        showToast('复制命令失败');
    }
}

async function loadSubtitleJavaCode(force = false) {
    const codeBlock = document.getElementById('subtitleJavaCode');
    if (!codeBlock) return;

    if (!force && codeBlock.dataset.loaded === 'true') {
        return;
    }

    try {
        const response = await fetch('/java/BilibiliSubtitleFetcher.java');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        codeBlock.textContent = text;
        codeBlock.dataset.loaded = 'true';
    } catch (error) {
        console.error('加载Java代码失败:', error);
        codeBlock.textContent = '加载Java代码失败，请检查服务器是否可访问 /java/BilibiliSubtitleFetcher.java';
    }
}

async function copySubtitleJavaCode() {
    const codeBlock = document.getElementById('subtitleJavaCode');
    if (!codeBlock) return;

    try {
        await navigator.clipboard.writeText(codeBlock.textContent);
        showToast('Java代码已复制');
    } catch (error) {
        console.error('复制Java代码失败:', error);
        showToast('复制失败');
    }
}

// ==================== 文案生成功能 ====================

// 加载已有的文案数据
function loadExistingCopywriting() {
    if (APP_STATE.currentProject.copywriting) {
        APP_STATE.currentCopywriting = APP_STATE.currentProject.copywriting;
        displayCopywritingResult(APP_STATE.currentCopywriting);
    } else {
        resetCopywritingTab();
    }
}

// 重置文案生成Tab
function resetCopywritingTab() {
    document.getElementById('copywritingInput').style.display = 'block';
    document.getElementById('copywritingResult').style.display = 'none';
    document.getElementById('videoUrl').value = '';
}

// 生成文案
async function generateCopywriting() {
    const videoUrl = document.getElementById('videoUrl').value.trim();
    
    if (!videoUrl) {
        showNotification('请输入视频链接', 'error');
        return;
    }
    
    // 显示加载动画
    document.getElementById('loadingOverlay').style.display = 'flex';
    
    try {
        const response = await fetch('http://localhost:5678/webhook/bilibili-summary', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                videoUrl: videoUrl
            })
        });
        
        if (response.status === 400) {
            try {
                const errorData = await response.json();
                if (errorData && errorData.res === '无法提取视频字幕') {
                    showNotification('找不到字幕，无法提取视频字幕，换个视频吧', 'error');
                    return;
                }
            } catch (parseError) {
                console.error('解析400响应失败:', parseError);
            }
            throw new Error('HTTP error! status: 400');
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // 验证响应数据格式
        if (!data.TTS文案 || !data.图像文案) {
            throw new Error('响应数据格式不正确');
        }
        
        // 保存文案数据
        APP_STATE.currentCopywriting = data;
        APP_STATE.currentProject.copywriting = data;
        
        // 更新localStorage
        const projectIndex = APP_STATE.projects.findIndex(p => p.id === APP_STATE.currentProject.id);
        APP_STATE.projects[projectIndex] = APP_STATE.currentProject;
        saveProjects();
        
        // 显示结果
        displayCopywritingResult(data);
        
        // 保存文件到本地文件系统
        await saveCopywritingFiles(data);
        
        showNotification('文案生成成功！', 'success');
        
    } catch (error) {
        console.error('生成文案失败:', error);
        showNotification(`生成失败: ${error.message}`, 'error');
    } finally {
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

// 显示文案结果
function displayCopywritingResult(data) {
    document.getElementById('copywritingInput').style.display = 'none';
    document.getElementById('copywritingResult').style.display = 'block';
    
    // 渲染TTS文案
    const ttsContent = document.getElementById('ttsContent');
    ttsContent.innerHTML = renderTTSContent(data.TTS文案);
    
    // 渲染图像提示词
    const imageContent = document.getElementById('imageContent');
    imageContent.innerHTML = renderImageContent(data.图像文案);
    
    // 恢复checkbox状态
    restoreCheckboxStates();
    
    // 添加checkbox事件监听
    setupCheckboxListeners();
}

// 渲染TTS文案内容
function renderTTSContent(ttsData) {
    let html = '';
    
    if (ttsData && typeof ttsData === 'object') {
        let itemId = 0;
        // 遍历所有场景
        for (const [scene, texts] of Object.entries(ttsData)) {
            if (Array.isArray(texts)) {
                html += `
                    <div class="expandable-card">
                        <div class="expandable-header" onclick="toggleExpand(this)">
                            <div class="expandable-left">
                                <input type="checkbox" class="mark-checkbox" onclick="event.stopPropagation()" data-type="tts" data-scene="${escapeHtml(scene)}">
                                <span class="expand-icon">▸</span>
                                <span class="expandable-title">${escapeHtml(scene)}</span>
                            </div>
                        </div>
                        <div class="expandable-content">
                `;
                
                texts.forEach((text, index) => {
                    html += `
                        <div class="text-item">
                            <div class="text-item-header">
                                <span class="text-index">${index + 1}</span>
                                <button class="copy-btn-small" onclick="copyTextContent('tts-text-${itemId}')" title="复制">复制</button>
                            </div>
                            <div class="text-content" id="tts-text-${itemId}">${escapeHtml(text)}</div>
                        </div>
                    `;
                    itemId++;
                });
                
                html += `
                        </div>
                    </div>
                `;
            }
        }
    }
    
    return html || '<p style="color: var(--text-secondary);">暂无数据</p>';
}

// 渲染图像提示词内容
function renderImageContent(imageData) {
    let html = '';
    let itemId = 0;
    
    // 渲染角色
    if (imageData.角色 && Object.keys(imageData.角色).length > 0) {
        html += `
            <div class="expandable-card">
                <div class="expandable-header" onclick="toggleExpand(this)">
                    <div class="expandable-left">
                        <input type="checkbox" class="mark-checkbox" onclick="event.stopPropagation()" data-type="image-role">
                        <span class="expand-icon">▸</span>
                        <span class="expandable-title">角色描述</span>
                    </div>
                </div>
                <div class="expandable-content">
        `;
        
        for (const [name, description] of Object.entries(imageData.角色)) {
            html += `
                <div class="text-item">
                    <div class="text-item-header">
                        <span class="text-label">${escapeHtml(name)}</span>
                        <button class="copy-btn-small" onclick="copyTextContent('image-text-${itemId}')" title="复制">复制</button>
                    </div>
                    <div class="text-content" id="image-text-${itemId}">${escapeHtml(description)}</div>
                </div>
            `;
            itemId++;
        }
        
        html += `
                </div>
            </div>
        `;
    }
    
    // 渲染场景
    if (imageData.场景 && Object.keys(imageData.场景).length > 0) {
        html += `
            <div class="expandable-card">
                <div class="expandable-header" onclick="toggleExpand(this)">
                    <div class="expandable-left">
                        <input type="checkbox" class="mark-checkbox" onclick="event.stopPropagation()" data-type="image-scene">
                        <span class="expand-icon">▸</span>
                        <span class="expandable-title">场景描述</span>
                    </div>
                </div>
                <div class="expandable-content">
        `;
        
        for (const [sceneName, sceneData] of Object.entries(imageData.场景)) {
            html += `
                <div class="expandable-card nested">
                    <div class="expandable-header" onclick="toggleExpand(this)">
                        <div class="expandable-left">
                            <input type="checkbox" class="mark-checkbox" onclick="event.stopPropagation()" data-type="image-scene-detail" data-scene="${escapeHtml(sceneName)}">
                            <span class="expand-icon">▸</span>
                            <span class="expandable-title">${escapeHtml(sceneName)}</span>
                        </div>
                    </div>
                    <div class="expandable-content">
            `;
            
            if (sceneData.prompt) {
                html += `
                    <div class="text-item">
                        <div class="text-item-header">
                            <span class="text-label">Prompt</span>
                            <button class="copy-btn-small" onclick="copyTextContent('image-text-${itemId}')" title="复制">复制</button>
                        </div>
                        <div class="text-content" id="image-text-${itemId}">${escapeHtml(sceneData.prompt)}</div>
                    </div>
                `;
                itemId++;
            }
            
            if (sceneData.added_prompt) {
                html += `
                    <div class="text-item">
                        <div class="text-item-header">
                            <span class="text-label">Added Prompt</span>
                            <button class="copy-btn-small" onclick="copyTextContent('image-text-${itemId}')" title="复制">复制</button>
                        </div>
                        <div class="text-content" id="image-text-${itemId}">${escapeHtml(sceneData.added_prompt)}</div>
                    </div>
                `;
                itemId++;
            }
            
            html += `
                    </div>
                </div>
            `;
        }
        
        html += `
                </div>
            </div>
        `;
    }
    
    return html || '<p style="color: var(--text-secondary);">暂无数据</p>';
}

// 保存文案文件到本地文件系统
async function saveCopywritingFiles(data) {
    try {
        const response = await fetch('http://localhost:8765/api/save-copywriting', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                projectPath: APP_STATE.currentProject.path,
                ttsData: data.TTS文案,
                imageData: data.图像文案
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ 文案已保存到:', result.path);
        } else {
            console.error('❌ 保存文案失败:', result.message);
            showNotification(`保存失败: ${result.message}`, 'warning');
        }
        
    } catch (error) {
        console.error('❌ 保存文案失败:', error);
        showNotification('文案保存到本地失败，但数据已保留在应用中', 'warning');
    }
}

// 重新生成文案
function regenerateCopywriting() {
    if (confirm('确定要重新生成文案吗？当前文案将被覆盖。')) {
        resetCopywritingTab();
    }
}

// ==================== 工具函数 ====================

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 切换展开/收起
function toggleExpand(header) {
    const card = header.parentElement;
    const content = header.nextElementSibling;
    const icon = header.querySelector('.expand-icon');
    
    card.classList.toggle('expanded');
    
    if (card.classList.contains('expanded')) {
        icon.textContent = '▾';
        // 展开时，使用一个非常大的值确保所有嵌套内容都能显示
        content.style.maxHeight = '5000px';
        
        // 立即更新父级
        updateParentMaxHeights(card, true);
        
        // 等待动画完成后，精确设置高度
        setTimeout(() => {
            if (card.classList.contains('expanded')) {
                content.style.maxHeight = content.scrollHeight + 'px';
                updateParentMaxHeights(card, false);
            }
        }, 350);
    } else {
        icon.textContent = '▸';
        content.style.maxHeight = '0';
        
        // 收起时也需要更新父级高度
        setTimeout(() => {
            updateParentMaxHeights(card, false);
        }, 350);
    }
}

// 更新父级可展开卡片的maxHeight
function updateParentMaxHeights(element, expanding) {
    let parent = element.parentElement;
    
    while (parent) {
        // 查找父级可展开内容区域
        if (parent.classList && parent.classList.contains('expandable-content')) {
            const parentCard = parent.parentElement;
            if (parentCard && parentCard.classList.contains('expanded')) {
                if (expanding) {
                    // 展开时使用大值，确保内容不被截断
                    parent.style.maxHeight = '5000px';
                } else {
                    // 动画完成后设置精确值
                    parent.style.maxHeight = parent.scrollHeight + 'px';
                }
            }
        }
        parent = parent.parentElement;
    }
}

// 复制单个文本内容到剪贴板
async function copyTextContent(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const textToCopy = element.textContent.trim();
    
    try {
        await navigator.clipboard.writeText(textToCopy);
        showNotification('已复制', 'success');
        
    } catch (error) {
        console.error('复制失败:', error);
        showNotification('复制失败', 'error');
    }
}

// 设置checkbox事件监听
function setupCheckboxListeners() {
    if (!APP_STATE.currentProject) return;
    
    const checkboxes = document.querySelectorAll('.mark-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            saveCheckboxState(this);
        });
    });
}

// 保存checkbox状态
function saveCheckboxState(checkbox) {
    if (!APP_STATE.currentProject) return;
    
    const projectId = APP_STATE.currentProject.id;
    const type = checkbox.dataset.type;
    const scene = checkbox.dataset.scene || '';
    const key = `${projectId}_${type}_${scene}`;
    
    if (!APP_STATE.checkboxStates[projectId]) {
        APP_STATE.checkboxStates[projectId] = {};
    }
    
    APP_STATE.checkboxStates[projectId][key] = checkbox.checked;
    
    // 保存到localStorage
    localStorage.setItem('checkboxStates', JSON.stringify(APP_STATE.checkboxStates));
}

// 恢复checkbox状态
function restoreCheckboxStates() {
    if (!APP_STATE.currentProject) return;
    
    // 从localStorage加载状态
    const saved = localStorage.getItem('checkboxStates');
    if (saved) {
        APP_STATE.checkboxStates = JSON.parse(saved);
    }
    
    const projectId = APP_STATE.currentProject.id;
    const projectStates = APP_STATE.checkboxStates[projectId];
    
    if (!projectStates) return;
    
    const checkboxes = document.querySelectorAll('.mark-checkbox');
    checkboxes.forEach(checkbox => {
        const type = checkbox.dataset.type;
        const scene = checkbox.dataset.scene || '';
        const key = `${projectId}_${type}_${scene}`;
        
        if (projectStates[key] === true) {
            checkbox.checked = true;
        }
    });
}

// 显示通知
function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type} show`;
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// ==================== TTS合成功能 ====================

// 复制所有TTS文案
function copyAllTTSContent() {
    if (!APP_STATE.currentCopywriting || !APP_STATE.currentCopywriting.TTS文案) {
        showNotification('没有可复制的文案', 'error');
        return;
    }
    
    const ttsData = APP_STATE.currentCopywriting.TTS文案;
    let allText = '';
    
    for (const [scene, texts] of Object.entries(ttsData)) {
        if (Array.isArray(texts) && texts.length > 0) {
            // 将同一场景下的所有文案连接在一起，不用换行符
            allText += texts.join('') + '\n';
        }
    }
    
    if (allText) {
        navigator.clipboard.writeText(allText.trim()).then(() => {
            showNotification('所有文案已复制', 'success');
        }).catch(error => {
            console.error('复制失败:', error);
            showNotification('复制失败', 'error');
        });
    }
}

// 切换TTS生成模式
function switchTTSMode(mode) {
    const singleMode = document.getElementById('singleTTSMode');
    const batchMode = document.getElementById('batchTTSMode');
    const modeButtons = document.querySelectorAll('.mode-btn');
    
    modeButtons.forEach(btn => btn.classList.remove('active'));
    
    if (mode === 'single') {
        singleMode.style.display = 'block';
        batchMode.style.display = 'none';
        modeButtons[0].classList.add('active');
    } else {
        singleMode.style.display = 'none';
        batchMode.style.display = 'block';
        modeButtons[1].classList.add('active');
    }
}

// 批量TTS任务状态
const BATCH_TTS_STATE = {
    tasks: [],
    isProcessing: false
};

// 开始批量生成TTS
function startBatchTTS() {
    if (!APP_STATE.currentProject) return;
    
    const config = APP_STATE.currentProject.ttsConfig;
    if (!config || !config.apiKey || !config.promptAudioUrl || !config.promptText) {
        showNotification('请先保存TTS配置', 'error');
        return;
    }
    
    const batchInput = document.getElementById('batchTTSInput').value.trim();
    if (!batchInput) {
        showNotification('请输入批量文本', 'error');
        return;
    }
    
    // 按换行符切割文本
    const texts = batchInput.split('\n').filter(t => t.trim() !== '');
    
    if (texts.length === 0) {
        showNotification('没有有效的文本内容', 'error');
        return;
    }
    
    const emoText = document.getElementById('batchEmoText').value.trim();
    
    // 初始化任务列表
    BATCH_TTS_STATE.tasks = texts.map((text, index) => ({
        id: index + 1,
        text: text.trim(),
        status: 'pending', // pending, processing, completed, failed
        emoText: emoText
    }));
    
    // 显示任务列表
    renderBatchTasks();
    document.getElementById('batchTaskList').style.display = 'block';
    
    // 开始处理任务
    processBatchTTS();
}

// 渲染批量任务列表
function renderBatchTasks() {
    const tasksContainer = document.getElementById('batchTasks');
    
    tasksContainer.innerHTML = BATCH_TTS_STATE.tasks.map(task => {
        let statusHtml = '';
        
        if (task.status === 'pending') {
            statusHtml = '<div class="batch-task-status"></div>';
        } else if (task.status === 'processing') {
            statusHtml = '<div class="batch-task-status"><div class="loading-spinner-small"></div></div>';
        } else if (task.status === 'completed') {
            statusHtml = '<div class="batch-task-status"><span class="check-icon">✓</span></div>';
        } else if (task.status === 'failed') {
            statusHtml = '<div class="batch-task-status"><span style="color: var(--text-secondary);">✗</span></div>';
        }
        
        return `
            <div class="batch-task-item ${task.status}" id="batch-task-${task.id}">
                ${statusHtml}
                <div class="batch-task-number">#${task.id}</div>
                <div class="batch-task-text" title="${escapeHtml(task.text)}">${escapeHtml(task.text)}</div>
            </div>
        `;
    }).join('');
}

// 处理批量TTS任务
async function processBatchTTS() {
    if (BATCH_TTS_STATE.isProcessing) return;
    
    BATCH_TTS_STATE.isProcessing = true;
    
    const config = APP_STATE.currentProject.ttsConfig;
    
    for (let i = 0; i < BATCH_TTS_STATE.tasks.length; i++) {
        const task = BATCH_TTS_STATE.tasks[i];
        
        if (task.status !== 'pending') continue;
        
        // 更新状态为processing
        task.status = 'processing';
        renderBatchTasks();
        
        try {
            const response = await fetch('http://localhost:8765/api/generate-tts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    projectPath: APP_STATE.currentProject.path,
                    apiKey: config.apiKey,
                    promptAudioUrl: config.promptAudioUrl,
                    promptText: config.promptText,
                    inputs: task.text,
                    emoText: task.emoText,
                    useEmoText: task.emoText !== ''
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                task.status = 'completed';
            } else {
                task.status = 'failed';
                console.error(`任务 #${task.id} 失败:`, result.message);
            }
            
        } catch (error) {
            task.status = 'failed';
            console.error(`任务 #${task.id} 失败:`, error);
        }
        
        renderBatchTasks();
        
        // 短暂延迟，避免请求过快
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    BATCH_TTS_STATE.isProcessing = false;
    
    const completedCount = BATCH_TTS_STATE.tasks.filter(t => t.status === 'completed').length;
    showNotification(`批量生成完成！成功 ${completedCount}/${BATCH_TTS_STATE.tasks.length} 个`, 'success');
}

// 加载TTS配置
async function loadTTSConfig() {
    if (!APP_STATE.currentProject) return;
    
    if (!APP_STATE.currentProject.ttsConfig && !APP_STATE.ttsDefaults) {
        await fetchDefaultTTSConfig();
    }

    const config = APP_STATE.currentProject.ttsConfig || APP_STATE.ttsDefaults || {};
    
    document.getElementById('apiKey').value = config.apiKey || '';
    document.getElementById('promptAudioUrl').value = config.promptAudioUrl || '';
    document.getElementById('promptText').value = config.promptText || '';
}

// 保存TTS配置
function saveTTSConfig() {
    if (!APP_STATE.currentProject) return;
    
    const apiKey = document.getElementById('apiKey').value.trim();
    const promptAudioUrl = document.getElementById('promptAudioUrl').value.trim();
    const promptText = document.getElementById('promptText').value.trim();
    
    if (!apiKey || !promptAudioUrl || !promptText) {
        showNotification('请填写所有必填项', 'error');
        return;
    }
    
    // 保存到项目
    APP_STATE.currentProject.ttsConfig = {
        apiKey,
        promptAudioUrl,
        promptText
    };
    
    // 更新localStorage
    const projectIndex = APP_STATE.projects.findIndex(p => p.id === APP_STATE.currentProject.id);
    APP_STATE.projects[projectIndex] = APP_STATE.currentProject;
    saveProjects();
    
    showNotification('配置已保存', 'success');
}

// 生成TTS
async function generateTTS() {
    if (!APP_STATE.currentProject) return;
    
    const config = APP_STATE.currentProject.ttsConfig;
    if (!config || !config.apiKey || !config.promptAudioUrl || !config.promptText) {
        showNotification('请先保存TTS配置', 'error');
        return;
    }
    
    const ttsInput = document.getElementById('ttsInput').value.trim();
    if (!ttsInput) {
        showNotification('请输入要合成的文本', 'error');
        return;
    }
    
    const emoText = document.getElementById('emoText').value.trim();
    
    // 显示加载动画
    const loadingOverlay = document.getElementById('ttsLoadingOverlay');
    const loadingText = document.getElementById('ttsLoadingText');
    loadingOverlay.style.display = 'flex';
    loadingText.textContent = '正在生成语音，请稍候...';
    
    try {
        const response = await fetch('http://localhost:8765/api/generate-tts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                projectPath: APP_STATE.currentProject.path,
                apiKey: config.apiKey,
                promptAudioUrl: config.promptAudioUrl,
                promptText: config.promptText,
                inputs: ttsInput,
                emoText: emoText,
                useEmoText: emoText !== '' // 根据是否有情感文本来决定
            })
        });
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || '生成失败');
        }
        
        // 生成成功
        loadingOverlay.style.display = 'none';
        showNotification('语音生成成功！', 'success');
        
        // 清空输入
        document.getElementById('ttsInput').value = '';
        
    } catch (error) {
        console.error('TTS生成失败:', error);
        showNotification(`生成失败: ${error.message}`, 'error');
        loadingOverlay.style.display = 'none';
    }
}

// 打开TTS文件夹
async function openTTSFolder() {
    if (!APP_STATE.currentProject) return;
    
    try {
        await fetch('http://localhost:8765/api/open-tts-folder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                projectPath: APP_STATE.currentProject.path
            })
        });
    } catch (error) {
        console.error('打开文件夹失败:', error);
    }
}

// 打开字幕生成工具
async function openAsrTool() {
    try {
        const response = await fetch('http://localhost:8765/api/open-asr-tool', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result?.message || '打开字幕生成工具失败');
        }

        showNotification('字幕生成工具正在打开，请稍候...', 'success');
    } catch (error) {
        console.error('打开字幕生成工具失败:', error);
        showNotification(`打开失败: ${error.message}`, 'error');
    }
}

// ==================== 图片生成功能 ====================

// 获取生成按钮的ID
function getGenerateButtonId(imageType, mode) {
    if (imageType === 'character' && mode === 'text') {
        return 'btn-character-text-generate';
    } else if (imageType === 'character' && mode === 'reference') {
        return 'btn-character-ref-generate';
    } else if (imageType === 'background' && mode === 'text') {
        return 'btn-background-text-generate';
    } else if (imageType === 'background' && mode === 'reference') {
        return 'btn-background-ref-generate';
    }
    return null;
}

// 生成唯一的任务ID
function generateTaskId(imageType, mode) {
    return `${imageType}-${mode}-${Date.now()}`;
}

// 设置按钮为生成中状态
function setButtonGenerating(buttonId, taskId, isGenerating) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    
    if (isGenerating) {
        button.classList.add('generating');
        button.disabled = true;
        button.dataset.taskId = taskId;
    } else {
        button.classList.remove('generating');
        button.disabled = false;
        delete button.dataset.taskId;
    }
}

// 保存生成任务到sessionStorage
function saveGeneratingTask(taskId, imageType, mode) {
    const tasks = JSON.parse(sessionStorage.getItem('generatingTasks') || '{}');
    tasks[taskId] = {
        imageType: imageType,
        mode: mode,
        startTime: Date.now()
    };
    sessionStorage.setItem('generatingTasks', JSON.stringify(tasks));
}

// 移除生成任务
function removeGeneratingTask(taskId) {
    const tasks = JSON.parse(sessionStorage.getItem('generatingTasks') || '{}');
    delete tasks[taskId];
    sessionStorage.setItem('generatingTasks', JSON.stringify(tasks));
}

// 获取所有进行中的任务
function getGeneratingTasks() {
    return JSON.parse(sessionStorage.getItem('generatingTasks') || '{}');
}

// 恢复生成中的按钮状态
function restoreGeneratingButtonStates() {
    const tasks = getGeneratingTasks();
    for (const taskId in tasks) {
        const task = tasks[taskId];
        const buttonId = getGenerateButtonId(task.imageType, task.mode);
        if (buttonId) {
            setButtonGenerating(buttonId, taskId, true);
        }
    }
}

// 生成角色立绘
async function generateCharacterImage(mode) {
    if (!APP_STATE.currentProject) {
        showNotification('请先选择项目', 'error');
        return;
    }
    
    let characterName, prompt, aspectRatio, imagePaths;
    
    if (mode === 'text') {
        characterName = document.getElementById('characterName').value.trim();
        prompt = document.getElementById('characterPrompt').value.trim();
        aspectRatio = document.getElementById('characterAspectRatio').value.trim();
        
        if (!characterName) {
            showNotification('请输入角色名称', 'error');
            return;
        }
        if (!prompt) {
            showNotification('请输入生成提示词', 'error');
            return;
        }
    } else if (mode === 'reference') {
        characterName = document.getElementById('characterRefName').value.trim();
        const refPath = document.getElementById('characterRefImagePath').value.trim();
        prompt = document.getElementById('characterAddedPrompt').value.trim();
        aspectRatio = document.getElementById('characterRefAspectRatio').value.trim();
        
        if (!characterName) {
            showNotification('请输入角色名称', 'error');
            return;
        }
        if (!refPath) {
            showNotification('请输入参考图片路径', 'error');
            return;
        }
        if (!prompt) {
            showNotification('请输入修改提示词', 'error');
            return;
        }
        imagePaths = [refPath];
    }
    
    await generateImage('character', mode, characterName, prompt, aspectRatio, imagePaths);
}

// 生成视频背景
async function generateBackgroundImage(mode) {
    if (!APP_STATE.currentProject) {
        showNotification('请先选择项目', 'error');
        return;
    }
    
    let backgroundName, prompt, aspectRatio, imagePaths;
    
    if (mode === 'text') {
        backgroundName = document.getElementById('backgroundName').value.trim();
        prompt = document.getElementById('backgroundPrompt').value.trim();
        aspectRatio = document.getElementById('backgroundAspectRatio').value.trim();
        
        if (!backgroundName) {
            showNotification('请输入背景名称（将作为保存的文件名）', 'error');
            return;
        }
        if (!prompt) {
            showNotification('请输入生成提示词', 'error');
            return;
        }
    } else if (mode === 'reference') {
        backgroundName = document.getElementById('backgroundRefName').value.trim();
        const refPaths = document.getElementById('backgroundRefImagePaths').value.trim();
        prompt = document.getElementById('backgroundAddedPrompt').value.trim();
        aspectRatio = document.getElementById('backgroundRefAspectRatio').value.trim();
        
        if (!backgroundName) {
            showNotification('请输入背景名称（将作为保存的文件名）', 'error');
            return;
        }
        if (!refPaths) {
            showNotification('请输入参考图片路径', 'error');
            return;
        }
        if (!prompt) {
            showNotification('请输入修改提示词', 'error');
            return;
        }
        imagePaths = refPaths.split('\n').map(p => p.trim()).filter(p => p);
        
        if (imagePaths.length === 0) {
            showNotification('请输入至少一个参考图片路径', 'error');
            return;
        }
    }
    
    await generateImage('background', mode, backgroundName, prompt, aspectRatio, imagePaths);
}

// 核心生成函数
async function generateImage(imageType, mode, characterName, prompt, aspectRatio, imagePaths) {
    const loadingOverlay = document.getElementById('imageGenerationLoadingOverlay');
    const loadingText = document.getElementById('imageGenerationLoadingText');
    
    // 生成任务ID和按钮ID
    const taskId = generateTaskId(imageType, mode);
    const buttonId = getGenerateButtonId(imageType, mode);
    
    // 设置按钮为生成中状态
    setButtonGenerating(buttonId, taskId, true);
    saveGeneratingTask(taskId, imageType, mode);
    
    // 不显示加载提示，后台处理
    // loadingOverlay.style.display = 'flex';
    // loadingText.textContent = '正在生成图像，请稍候...';
    
    try {
        let requestBody = {
            projectPath: APP_STATE.currentProject.path,
            imageType: imageType,
            prompt: prompt,
            aspectRatio: aspectRatio
        };
        
        let endpoint = '';
        
        if (mode === 'text') {
            if (imageType === 'character') {
                requestBody.characterName = characterName;
            } else if (imageType === 'background') {
                requestBody.backgroundName = characterName;
            }
            endpoint = '/api/generate-image-text';
        } else if (mode === 'reference') {
            requestBody.imagePaths = imagePaths;
            if (imageType === 'character') {
                requestBody.characterName = characterName;
            } else if (imageType === 'background') {
                requestBody.backgroundName = characterName;
            }
            endpoint = '/api/generate-image-reference';
        }
        
        const response = await fetch(`http://localhost:8765${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || '生成失败');
        }
        
        // 获取图片并显示
        const filePath = result.file_path;
        const imageResponse = await fetch(`http://localhost:8765/api/get-image?path=${encodeURIComponent(filePath)}`);
        const imageData = await imageResponse.json();
        
        if (!imageData.success) {
            throw new Error('获取生成的图片失败');
        }
        
        const dataUrl = imageData.data_url;
        
        // 根据模式更新对应的显示框
        if (imageType === 'character') {
            if (mode === 'text') {
                document.getElementById('characterResultDisplayText').style.display = 'flex';
                document.getElementById('characterResultPlaceholderText').style.display = 'none';
                document.getElementById('characterResultImageText').src = dataUrl;
                document.getElementById('characterResultPathText').value = filePath;
            } else if (mode === 'reference') {
                document.getElementById('characterResultDisplayRef').style.display = 'flex';
                document.getElementById('characterResultPlaceholderRef').style.display = 'none';
                document.getElementById('characterResultImageRef').src = dataUrl;
                document.getElementById('characterResultPathRef').value = filePath;
            }
            document.getElementById('characterImagePath').value = filePath;
            document.getElementById('characterResultContainer').style.display = 'block';
        } else if (imageType === 'background') {
            if (mode === 'text') {
                document.getElementById('backgroundResultDisplayText').style.display = 'flex';
                document.getElementById('backgroundResultPlaceholderText').style.display = 'none';
                document.getElementById('backgroundResultImageText').src = dataUrl;
                document.getElementById('backgroundResultPathText').value = filePath;
            } else if (mode === 'reference') {
                document.getElementById('backgroundResultDisplayRef').style.display = 'flex';
                document.getElementById('backgroundResultPlaceholderRef').style.display = 'none';
                document.getElementById('backgroundResultImageRef').src = dataUrl;
                document.getElementById('backgroundResultPathRef').value = filePath;
            }
            document.getElementById('backgroundImagePath').value = filePath;
            document.getElementById('backgroundResultContainer').style.display = 'block';
        }
        
        // 隐藏加载提示
        loadingOverlay.style.display = 'none';
        showNotification('图像生成成功！', 'success');
        
        // 生成完成，恢复按钮状态
        setButtonGenerating(buttonId, taskId, false);
        removeGeneratingTask(taskId);
        
    } catch (error) {
        console.error('图片生成失败:', error);
        loadingOverlay.style.display = 'none';
        showNotification(`生成失败: ${error.message}`, 'error');
        
        // 生成失败，恢复按钮状态
        setButtonGenerating(buttonId, taskId, false);
        removeGeneratingTask(taskId);
    }
}

// 打开角色立绘所在文件夹
async function openCharacterImageFolder() {
    const pathInput = document.getElementById('characterImagePath');
    const filePath = pathInput.value.trim();
    
    if (!filePath) {
        showNotification('没有有效的文件路径', 'error');
        return;
    }
    
    try {
        const response = await fetch('http://localhost:8765/api/open-image-folder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                filePath: filePath
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('已打开文件夹', 'success');
        } else {
            showNotification(`打开失败: ${result.message}`, 'error');
        }
    } catch (error) {
        console.error('打开文件夹失败:', error);
        showNotification('打开文件夹失败', 'error');
    }
}

// 打开背景图片所在文件夹
async function openBackgroundImageFolder() {
    const pathInput = document.getElementById('backgroundImagePath');
    const filePath = pathInput.value.trim();
    
    if (!filePath) {
        showNotification('没有有效的文件路径', 'error');
        return;
    }
    
    try {
        const response = await fetch('http://localhost:8765/api/open-image-folder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                filePath: filePath
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('已打开文件夹', 'success');
        } else {
            showNotification(`打开失败: ${result.message}`, 'error');
        }
    } catch (error) {
        console.error('打开文件夹失败:', error);
        showNotification('打开文件夹失败', 'error');
    }
}

// 复制图片路径（从预览框中直接复制）
async function copyImagePath(displayId) {
    let pathInputId = '';
    
    if (displayId === 'characterResultDisplayText') {
        pathInputId = 'characterResultPathText';
    } else if (displayId === 'characterResultDisplayRef') {
        pathInputId = 'characterResultPathRef';
    } else if (displayId === 'backgroundResultDisplayText') {
        pathInputId = 'backgroundResultPathText';
    } else if (displayId === 'backgroundResultDisplayRef') {
        pathInputId = 'backgroundResultPathRef';
    }
    
    const pathInput = document.getElementById(pathInputId);
    const path = pathInput?.value.trim() || '';
    
    if (!path) {
        showNotification('没有可复制的路径', 'error');
        return;
    }
    
    try {
        await navigator.clipboard.writeText(path);
        showNotification('已复制路径到剪贴板', 'success');
    } catch (error) {
        console.error('复制失败:', error);
        showNotification('复制失败', 'error');
    }
}

// ==================== 键盘快捷键 ====================

// ==================== 全局提示词管理 ====================

// 显示提示词管理器
function showPromptsManager() {
    const modal = document.getElementById('promptsManagerModal');
    modal.classList.add('active');
    document.getElementById('promptTitle').value = '';
    document.getElementById('promptContent').value = '';
}

// 关闭提示词管理器
function closePromptsManager() {
    const modal = document.getElementById('promptsManagerModal');
    modal.classList.remove('active');
}

// 保存全局提示词
function saveGlobalPrompt() {
    const title = document.getElementById('promptTitle').value.trim();
    const content = document.getElementById('promptContent').value.trim();
    
    if (!title) {
        showNotification('请输入提示词名称', 'error');
        return;
    }
    
    if (!content) {
        showNotification('请输入提示词内容', 'error');
        return;
    }
    
    // 加载现有提示词
    let prompts = JSON.parse(localStorage.getItem('globalPrompts') || '[]');
    
    // 检查是否重复
    if (prompts.some(p => p.title === title)) {
        showNotification('此提示词已存在，请修改名称', 'error');
        return;
    }
    
    // 添加新提示词
    prompts.push({
        id: Date.now(),
        title: title,
        content: content,
        createdAt: new Date().toISOString()
    });
    
    // 保存到localStorage
    localStorage.setItem('globalPrompts', JSON.stringify(prompts));
    
    showNotification('提示词保存成功！', 'success');
    closePromptsManager();
    
    // 刷新显示
    loadGlobalPrompts();
}

// 加载全局提示词
function loadGlobalPrompts() {
    const prompts = JSON.parse(localStorage.getItem('globalPrompts') || '[]');
    
    // 在工作区标签页中显示
    const promptsList = document.getElementById('promptsList');
    const emptyPrompts = document.getElementById('emptyPrompts');
    
    if (promptsList) {
        if (prompts.length === 0) {
            promptsList.innerHTML = '';
            emptyPrompts.style.display = 'block';
        } else {
            emptyPrompts.style.display = 'none';
            promptsList.innerHTML = prompts.map(prompt => `
                <li>
                    <span class="prompt-name" title="${escapeHtml(prompt.content)}">${escapeHtml(prompt.title)}</span>
                    <div class="prompt-actions">
                        <button onclick="copyPromptContent('${escapeHtml(prompt.content)}')" title="复制内容">复制</button>
                        <button onclick="deleteGlobalPrompt(${prompt.id})" title="删除">删除</button>
                    </div>
                </li>
            `).join('');
        }
    }
    
    // 在主页的模态框中显示
    const globalPromptsList = document.getElementById('globalPromptsList');
    const emptyGlobalPrompts = document.getElementById('emptyGlobalPrompts');
    
    if (globalPromptsList) {
        if (prompts.length === 0) {
            globalPromptsList.innerHTML = '';
            emptyGlobalPrompts.style.display = 'block';
        } else {
            emptyGlobalPrompts.style.display = 'none';
            globalPromptsList.innerHTML = prompts.map(prompt => `
                <li>
                    <span class="prompt-name" title="${escapeHtml(prompt.content)}">${escapeHtml(prompt.title)}</span>
                    <div class="prompt-actions">
                        <button onclick="copyPromptContent('${escapeHtml(prompt.content)}')" title="复制内容">复制</button>
                        <button onclick="deleteGlobalPrompt(${prompt.id})" title="删除">删除</button>
                    </div>
                </li>
            `).join('');
        }
    }
}

// 复制提示词内容
async function copyPromptContent(content) {
    try {
        await navigator.clipboard.writeText(content);
        showNotification('已复制到剪贴板', 'success');
    } catch (error) {
        console.error('复制失败:', error);
        showNotification('复制失败', 'error');
    }
}

// 删除全局提示词
function deleteGlobalPrompt(id) {
    if (!confirm('确定要删除这个提示词吗？')) {
        return;
    }
    
    let prompts = JSON.parse(localStorage.getItem('globalPrompts') || '[]');
    prompts = prompts.filter(p => p.id !== id);
    localStorage.setItem('globalPrompts', JSON.stringify(prompts));
    
    showNotification('提示词已删除', 'success');
    loadGlobalPrompts();
}

// 关闭全局提示词模态框
function closeGlobalPromptsModal() {
    const modal = document.getElementById('globalPromptsModal');
    modal.classList.remove('active');
}

// ==================== 键盘快捷键 ====================

document.addEventListener('keydown', (e) => {
    // ESC关闭模态框
    if (e.key === 'Escape') {
        const modal = document.getElementById('createProjectModal');
        if (modal.classList.contains('active')) {
            closeCreateProjectModal();
        }
    }
    
    // Enter提交表单
    if (e.key === 'Enter') {
        const modal = document.getElementById('createProjectModal');
        if (modal.classList.contains('active')) {
            createProject();
        }
    }
});

// 点击模态框外部关闭
document.getElementById('createProjectModal').addEventListener('click', (e) => {
    if (e.target.id === 'createProjectModal') {
        closeCreateProjectModal();
    }
});

// ==================== 草稿保存和加载功能 ====================

// 切换草稿菜单
function toggleDraftMenu() {
    const menu = document.getElementById('draftMenu');
    if (menu.style.display === 'none') {
        menu.style.display = 'flex';
    } else {
        menu.style.display = 'none';
    }
}

// 保存当前草稿
async function saveDraft() {
    if (!APP_STATE.currentProject) {
        showNotification('请先选择项目', 'error');
        return;
    }
    
    const draftData = {
        projectId: APP_STATE.currentProject.id,
        timestamp: new Date().toISOString(),
        // 文案生成部分
        videoUrl: document.getElementById('videoUrl')?.value || '',
        // TTS部分
        apiKey: document.getElementById('apiKey')?.value || '',
        promptAudioUrl: document.getElementById('promptAudioUrl')?.value || '',
        promptText: document.getElementById('promptText')?.value || '',
        ttsInput: document.getElementById('ttsInput')?.value || '',
        emoText: document.getElementById('emoText')?.value || '',
        batchTTSInput: document.getElementById('batchTTSInput')?.value || '',
        batchEmoText: document.getElementById('batchEmoText')?.value || '',
        // 图片生成 - 角色立绘
        characterName: document.getElementById('characterName')?.value || '',
        characterPrompt: document.getElementById('characterPrompt')?.value || '',
        characterAspectRatio: document.getElementById('characterAspectRatio')?.value || '',
        characterRefName: document.getElementById('characterRefName')?.value || '',
        characterRefImagePath: document.getElementById('characterRefImagePath')?.value || '',
        characterAddedPrompt: document.getElementById('characterAddedPrompt')?.value || '',
        characterRefAspectRatio: document.getElementById('characterRefAspectRatio')?.value || '',
        characterImagePath: document.getElementById('characterImagePath')?.value || '',
        characterResultPathText: document.getElementById('characterResultPathText')?.value || '',
        characterResultPathRef: document.getElementById('characterResultPathRef')?.value || '',
        // 图片生成 - 背景
        backgroundName: document.getElementById('backgroundName')?.value || '',
        backgroundPrompt: document.getElementById('backgroundPrompt')?.value || '',
        backgroundAspectRatio: document.getElementById('backgroundAspectRatio')?.value || '',
        backgroundRefName: document.getElementById('backgroundRefName')?.value || '',
        backgroundRefImagePaths: document.getElementById('backgroundRefImagePaths')?.value || '',
        backgroundAddedPrompt: document.getElementById('backgroundAddedPrompt')?.value || '',
        backgroundRefAspectRatio: document.getElementById('backgroundRefAspectRatio')?.value || '',
        backgroundImagePath: document.getElementById('backgroundImagePath')?.value || '',
        backgroundResultPathText: document.getElementById('backgroundResultPathText')?.value || '',
        backgroundResultPathRef: document.getElementById('backgroundResultPathRef')?.value || '',
        // 保存预览状态
        characterResultDisplayTextVisible: document.getElementById('characterResultDisplayText')?.style.display !== 'none',
        characterResultDisplayRefVisible: document.getElementById('characterResultDisplayRef')?.style.display !== 'none',
        backgroundResultDisplayTextVisible: document.getElementById('backgroundResultDisplayText')?.style.display !== 'none',
        backgroundResultDisplayRefVisible: document.getElementById('backgroundResultDisplayRef')?.style.display !== 'none',
        characterResultContainerVisible: document.getElementById('characterResultContainer')?.style.display !== 'none',
        backgroundResultContainerVisible: document.getElementById('backgroundResultContainer')?.style.display !== 'none'
    };
    
    // 保存图片预览的base64（如果有）
    const characterImageText = document.getElementById('characterResultImageText');
    const characterImageRef = document.getElementById('characterResultImageRef');
    const backgroundImageText = document.getElementById('backgroundResultImageText');
    const backgroundImageRef = document.getElementById('backgroundResultImageRef');
    
    if (characterImageText?.src) draftData.characterImageTextSrc = characterImageText.src;
    if (characterImageRef?.src) draftData.characterImageRefSrc = characterImageRef.src;
    if (backgroundImageText?.src) draftData.backgroundImageTextSrc = backgroundImageText.src;
    if (backgroundImageRef?.src) draftData.backgroundImageRefSrc = backgroundImageRef.src;
    
    try {
        const response = await fetch('http://localhost:8765/api/save-draft', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                projectPath: APP_STATE.currentProject.path,
                draftData: draftData
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('草稿已保存！', 'success');
        } else {
            showNotification(`保存失败: ${result.message}`, 'error');
        }
    } catch (error) {
        console.error('保存草稿失败:', error);
        showNotification('保存草稿失败', 'error');
    }
}

// 加载草稿
async function loadDraft(autoLoad = false) {
    if (!APP_STATE.currentProject) {
        if (!autoLoad) {
            showNotification('请先选择项目', 'error');
        }
        return;
    }
    
    try {
        const response = await fetch('http://localhost:8765/api/load-draft', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                projectPath: APP_STATE.currentProject.path
            })
        });
        
        const result = await response.json();
        
        if (!result.success) {
            if (!autoLoad) {
                showNotification(result.message || '加载草稿失败', 'error');
            }
            return;
        }
        
        const draftData = result.data;
        
        // 恢复所有输入框内容
        if (document.getElementById('videoUrl')) document.getElementById('videoUrl').value = draftData.videoUrl || '';
        if (document.getElementById('apiKey')) document.getElementById('apiKey').value = draftData.apiKey || '';
        if (document.getElementById('promptAudioUrl')) document.getElementById('promptAudioUrl').value = draftData.promptAudioUrl || '';
        if (document.getElementById('promptText')) document.getElementById('promptText').value = draftData.promptText || '';
        if (document.getElementById('ttsInput')) document.getElementById('ttsInput').value = draftData.ttsInput || '';
        if (document.getElementById('emoText')) document.getElementById('emoText').value = draftData.emoText || '';
        if (document.getElementById('batchTTSInput')) document.getElementById('batchTTSInput').value = draftData.batchTTSInput || '';
        if (document.getElementById('batchEmoText')) document.getElementById('batchEmoText').value = draftData.batchEmoText || '';
        
        // 恢复角色立绘输入
        if (document.getElementById('characterName')) document.getElementById('characterName').value = draftData.characterName || '';
        if (document.getElementById('characterPrompt')) document.getElementById('characterPrompt').value = draftData.characterPrompt || '';
        if (document.getElementById('characterAspectRatio')) document.getElementById('characterAspectRatio').value = draftData.characterAspectRatio || '';
        if (document.getElementById('characterRefName')) document.getElementById('characterRefName').value = draftData.characterRefName || '';
        if (document.getElementById('characterRefImagePath')) document.getElementById('characterRefImagePath').value = draftData.characterRefImagePath || '';
        if (document.getElementById('characterAddedPrompt')) document.getElementById('characterAddedPrompt').value = draftData.characterAddedPrompt || '';
        if (document.getElementById('characterRefAspectRatio')) document.getElementById('characterRefAspectRatio').value = draftData.characterRefAspectRatio || '';
        
        // 恢复背景输入
        if (document.getElementById('backgroundName')) document.getElementById('backgroundName').value = draftData.backgroundName || '';
        if (document.getElementById('backgroundPrompt')) document.getElementById('backgroundPrompt').value = draftData.backgroundPrompt || '';
        if (document.getElementById('backgroundAspectRatio')) document.getElementById('backgroundAspectRatio').value = draftData.backgroundAspectRatio || '';
        if (document.getElementById('backgroundRefName')) document.getElementById('backgroundRefName').value = draftData.backgroundRefName || '';
        if (document.getElementById('backgroundRefImagePaths')) document.getElementById('backgroundRefImagePaths').value = draftData.backgroundRefImagePaths || '';
        if (document.getElementById('backgroundAddedPrompt')) document.getElementById('backgroundAddedPrompt').value = draftData.backgroundAddedPrompt || '';
        if (document.getElementById('backgroundRefAspectRatio')) document.getElementById('backgroundRefAspectRatio').value = draftData.backgroundRefAspectRatio || '';
        
        // 恢复图片预览和隐藏路径
        if (draftData.characterResultDisplayTextVisible && draftData.characterImageTextSrc) {
            document.getElementById('characterResultDisplayText').style.display = 'flex';
            document.getElementById('characterResultPlaceholderText').style.display = 'none';
            document.getElementById('characterResultImageText').src = draftData.characterImageTextSrc;
            if (document.getElementById('characterResultPathText')) document.getElementById('characterResultPathText').value = draftData.characterResultPathText || '';
        }
        
        if (draftData.characterResultDisplayRefVisible && draftData.characterImageRefSrc) {
            document.getElementById('characterResultDisplayRef').style.display = 'flex';
            document.getElementById('characterResultPlaceholderRef').style.display = 'none';
            document.getElementById('characterResultImageRef').src = draftData.characterImageRefSrc;
            if (document.getElementById('characterResultPathRef')) document.getElementById('characterResultPathRef').value = draftData.characterResultPathRef || '';
        }
        
        if (draftData.backgroundResultDisplayTextVisible && draftData.backgroundImageTextSrc) {
            document.getElementById('backgroundResultDisplayText').style.display = 'flex';
            document.getElementById('backgroundResultPlaceholderText').style.display = 'none';
            document.getElementById('backgroundResultImageText').src = draftData.backgroundImageTextSrc;
            if (document.getElementById('backgroundResultPathText')) document.getElementById('backgroundResultPathText').value = draftData.backgroundResultPathText || '';
        }
        
        if (draftData.backgroundResultDisplayRefVisible && draftData.backgroundImageRefSrc) {
            document.getElementById('backgroundResultDisplayRef').style.display = 'flex';
            document.getElementById('backgroundResultPlaceholderRef').style.display = 'none';
            document.getElementById('backgroundResultImageRef').src = draftData.backgroundImageRefSrc;
            if (document.getElementById('backgroundResultPathRef')) document.getElementById('backgroundResultPathRef').value = draftData.backgroundResultPathRef || '';
        }
        
        // 恢复路径显示框
        if (document.getElementById('characterImagePath')) document.getElementById('characterImagePath').value = draftData.characterImagePath || '';
        if (document.getElementById('backgroundImagePath')) document.getElementById('backgroundImagePath').value = draftData.backgroundImagePath || '';
        
        // 恢复结果容器显示状态
        if (document.getElementById('characterResultContainer')) document.getElementById('characterResultContainer').style.display = draftData.characterResultContainerVisible ? 'block' : 'none';
        if (document.getElementById('backgroundResultContainer')) document.getElementById('backgroundResultContainer').style.display = draftData.backgroundResultContainerVisible ? 'block' : 'none';
        
        // 只有在非自动加载或有新加载的数据时才显示成功消息
        if (!autoLoad) {
            showNotification('草稿已加载！', 'success');
        }
        
    } catch (error) {
        console.error('加载草稿失败:', error);
        if (!autoLoad) {
            showNotification('加载草稿失败', 'error');
        }
    }
}

// 清空草稿
async function clearDraft() {
    if (!APP_STATE.currentProject) {
        showNotification('请先选择项目', 'error');
        return;
    }
    
    if (!confirm('确定要清空草稿吗？此操作不可恢复。')) {
        return;
    }
    
    try {
        const response = await fetch('http://localhost:8765/api/clear-draft', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                projectPath: APP_STATE.currentProject.path
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('草稿已清空', 'success');
        } else {
            showNotification(`清空失败: ${result.message}`, 'error');
        }
    } catch (error) {
        console.error('清空草稿失败:', error);
        showNotification('清空草稿失败', 'error');
    }
}

async function openProjectDirectory() {
    if (!APP_STATE.currentProject) {
        showNotification('请先选择项目', 'error');
        return;
    }

    try {
        const response = await fetch('http://localhost:8765/api/open-project-folder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                projectPath: APP_STATE.currentProject.path
            })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || result.success === false) {
            throw new Error(result?.message || '打开项目目录失败');
        }
    } catch (error) {
        console.error('打开项目目录失败:', error);
        showNotification(`打开失败: ${error.message}`, 'error');
    }
}

// ==================== 自由创作功能 ====================

// 自由创作状态管理
const FREE_CREATE_STATE = {
    referenceImages: [], // 存储参考图片的base64数据
    history: [] // 生成历史
};

// 打开图片上传对话框
function freeCreateUploadImages() {
    document.getElementById('freeCreateImageInput').click();
}

// 处理图片选择
function handleFreeCreateImageSelect(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    Array.from(files).forEach(file => {
        if (file.type.startsWith('image/')) {
            readImageFile(file);
        }
    });
    
    // 清空input，允许重复选择同一文件
    event.target.value = '';
}

// 读取图片文件为base64
function readImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const imageData = {
            data: e.target.result,
            name: file.name,
            size: file.size
        };
        FREE_CREATE_STATE.referenceImages.push(imageData);
        updateReferencePreview();
    };
    reader.readAsDataURL(file);
}

// 从剪切板粘贴图片
async function freeCreatePasteFromClipboard() {
    try {
        const items = await navigator.clipboard.read();
        let hasImage = false;
        
        for (const item of items) {
            for (const type of item.types) {
                if (type.startsWith('image/')) {
                    const blob = await item.getType(type);
                    const file = new File([blob], 'clipboard-image.png', { type: blob.type });
                    readImageFile(file);
                    hasImage = true;
                }
            }
        }
        
        if (!hasImage) {
            showNotification('剪切板中没有图片', 'warning');
        } else {
            showNotification('已从剪切板添加图片', 'success');
        }
    } catch (error) {
        console.error('读取剪切板失败:', error);
        showNotification('读取剪切板失败，请确保已授权剪切板访问权限', 'error');
    }
}

// 更新参考图片预览
function updateReferencePreview() {
    const preview = document.getElementById('freeCreateReferencePreview');
    
    if (FREE_CREATE_STATE.referenceImages.length === 0) {
        preview.innerHTML = '';
        return;
    }
    
    preview.innerHTML = FREE_CREATE_STATE.referenceImages.map((img, index) => `
        <div class="reference-image-item">
            <img src="${img.data}" alt="${img.name}">
            <button class="reference-image-remove" onclick="removeReferenceImage(${index})" title="移除">
                ×
            </button>
        </div>
    `).join('');
}

// 移除参考图片
function removeReferenceImage(index) {
    FREE_CREATE_STATE.referenceImages.splice(index, 1);
    updateReferencePreview();
}

// 浏览文件夹（保存位置）
function browseFolderForFreeCreate() {
    // 这个功能需要使用Electron或者类似的桌面框架
    // 在纯web环境中，可以让用户手动输入路径
    showNotification('请手动输入文件夹路径', 'info');
}

// 生成图片


async function generateFreeCreateImage() {
    if (!APP_STATE.currentProject) {
        showNotification('请先选择项目', 'error');
        return;
    }
    
    const prompt = document.getElementById('freeCreatePrompt').value.trim();
    if (!prompt) {
        showNotification('请输入提示词', 'error');
        return;
    }
    
    const aspectRatio = document.getElementById('freeCreateAspectRatio').value;
    const saveFolder = document.getElementById('freeCreateSaveFolder').value.trim();
    
    // 只在按钮上显示加载状态，不阻塞界面
    const generateBtn = document.getElementById('btnFreeCreateGenerate');
    generateBtn.classList.add('generating');
    generateBtn.disabled = true;
    
    // 显示生成提示
    showNotification('开始生成图片，请稍候...', 'info');
    
    try {
        const requestData = {
            projectPath: APP_STATE.currentProject.path,
            prompt: prompt,
            aspectRatio: aspectRatio,
            saveFolder: saveFolder,
            referenceImages: FREE_CREATE_STATE.referenceImages.map(img => ({
                data: img.data.split(',')[1], // 移除data:image/...;base64,前缀
                name: img.name
            }))
        };
        
        const response = await fetch('http://localhost:8765/api/free-create-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('图片生成成功！', 'success');
            
            // 显示生成结果
            displayFreeCreateResult(result);
            
            // 添加到历史记录
            addToFreeCreateHistory({
                prompt: prompt,
                aspectRatio: aspectRatio,
                imagePath: result.imagePath,
                imageData: result.imageData,
                timestamp: new Date().toISOString()
            });
            
            // 清空输入（可选）
            // document.getElementById('freeCreatePrompt').value = '';
            // FREE_CREATE_STATE.referenceImages = [];
            // updateReferencePreview();
        } else {
            showNotification(`生成失败: ${result.message}`, 'error');
        }
    } catch (error) {
        console.error('生成图片失败:', error);
        showNotification('生成图片失败', 'error');
    } finally {
        // 恢复按钮状态
        generateBtn.classList.remove('generating');
        generateBtn.disabled = false;
    }
}

// 显示生成结果
function displayFreeCreateResult(result) {
    const resultDisplay = document.getElementById('freeCreateResultDisplay');
    
    resultDisplay.innerHTML = `
        <div class="result-image-container">
            <img src="data:image/png;base64,${result.imageData}" alt="生成的图片">
            <div class="result-actions-overlay">
                <button class="btn-secondary" onclick="saveFreeCreateImage('${result.imagePath}')">
                    保存到文件夹
                </button>
                <button class="btn-secondary" onclick="copyFreeCreateImagePath('${result.imagePath}')">
                    复制路径
                </button>
                <button class="btn-secondary" onclick="openFreeCreateImageFolder('${result.imagePath}')">
                    打开文件夹
                </button>
            </div>
        </div>
    `;
}

// 添加到历史记录
function addToFreeCreateHistory(item) {
    FREE_CREATE_STATE.history.unshift(item);
    
    // 限制历史记录数量
    if (FREE_CREATE_STATE.history.length > 20) {
        FREE_CREATE_STATE.history = FREE_CREATE_STATE.history.slice(0, 20);
    }
    
    // 保存到localStorage
    localStorage.setItem('freeCreateHistory', JSON.stringify(FREE_CREATE_STATE.history));
    
    updateFreeCreateHistory();
}

// 更新历史记录显示
function updateFreeCreateHistory() {
    const historyContainer = document.getElementById('freeCreateHistory');
    
    if (FREE_CREATE_STATE.history.length === 0) {
        historyContainer.innerHTML = `
            <div class="empty-state">
                <p>还没有生成记录</p>
            </div>
        `;
        return;
    }
    
    historyContainer.innerHTML = FREE_CREATE_STATE.history.map((item, index) => `
        <div class="history-item" onclick="loadFreeCreateHistory(${index})">
            <div class="history-thumbnail">
                <img src="data:image/png;base64,${item.imageData}" alt="历史图片">
            </div>
            <div class="history-info">
                <div class="history-prompt">${escapeHtml(item.prompt)}</div>
                <div class="history-meta">
                    <span>${item.aspectRatio || '自动'}</span>
                    <span>${new Date(item.timestamp).toLocaleString('zh-CN')}</span>
                </div>
            </div>
            <div class="history-actions" onclick="event.stopPropagation()">
                <button onclick="deleteFreeCreateHistory(${index})" title="删除">删除</button>
            </div>
        </div>
    `).join('');
}

// 加载历史记录
function loadFreeCreateHistory(index) {
    const item = FREE_CREATE_STATE.history[index];
    
    // 显示在结果区域
    displayFreeCreateResult({
        imageData: item.imageData,
        imagePath: item.imagePath
    });
    
    // 可选：填充到输入框
    document.getElementById('freeCreatePrompt').value = item.prompt;
    if (item.aspectRatio) {
        document.getElementById('freeCreateAspectRatio').value = item.aspectRatio;
    }
}

// 删除历史记录
function deleteFreeCreateHistory(index) {
    if (confirm('确定要删除这条记录吗？')) {
        FREE_CREATE_STATE.history.splice(index, 1);
        localStorage.setItem('freeCreateHistory', JSON.stringify(FREE_CREATE_STATE.history));
        updateFreeCreateHistory();
        showNotification('已删除', 'success');
    }
}

// 清空历史记录
function clearFreeCreateHistory() {
    if (confirm('确定要清空所有历史记录吗？')) {
        FREE_CREATE_STATE.history = [];
        localStorage.removeItem('freeCreateHistory');
        updateFreeCreateHistory();
        showNotification('历史记录已清空', 'success');
    }
}

// 保存图片到指定文件夹
async function saveFreeCreateImage(imagePath) {
    if (!APP_STATE.currentProject) {
        showNotification('请先选择项目', 'error');
        return;
    }
    
    const targetFolder = prompt('请输入目标文件夹路径:', APP_STATE.currentProject.path);
    if (!targetFolder) return;
    
    try {
        const response = await fetch('http://localhost:8765/api/save-free-create-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                imagePath: imagePath,
                targetFolder: targetFolder
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('图片已保存', 'success');
        } else {
            showNotification(`保存失败: ${result.message}`, 'error');
        }
    } catch (error) {
        console.error('保存图片失败:', error);
        showNotification('保存图片失败', 'error');
    }
}

// 复制图片路径
function copyFreeCreateImagePath(imagePath) {
    navigator.clipboard.writeText(imagePath).then(() => {
        showNotification('路径已复制到剪切板', 'success');
    }).catch(err => {
        console.error('复制失败:', err);
        showNotification('复制失败', 'error');
    });
}

// 打开图片所在文件夹
async function openFreeCreateImageFolder(imagePath) {
    try {
        const response = await fetch('http://localhost:8765/api/open-image-folder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                imagePath: imagePath
            })
        });
        
        const result = await response.json();
        
        if (!result.success) {
            showNotification(`打开文件夹失败: ${result.message}`, 'error');
        }
    } catch (error) {
        console.error('打开文件夹失败:', error);
        showNotification('打开文件夹失败', 'error');
    }
}

// 初始化自由创作（加载历史记录）
function initFreeCreate() {
    const savedHistory = localStorage.getItem('freeCreateHistory');
    if (savedHistory) {
        try {
            FREE_CREATE_STATE.history = JSON.parse(savedHistory);
            updateFreeCreateHistory();
        } catch (error) {
            console.error('加载历史记录失败:', error);
        }
    }
}

// 重置自由创作（清空所有输入，开始新的创作）
function resetFreeCreate() {
    if (!confirm('确定要清空所有输入吗？生成历史会保留。')) {
        return;
    }
    
    // 清空提示词
    document.getElementById('freeCreatePrompt').value = '';
    
    // 清空参考图片
    FREE_CREATE_STATE.referenceImages = [];
    updateReferencePreview();
    
    // 重置比例选择
    document.getElementById('freeCreateAspectRatio').value = '';
    
    // 清空保存文件夹路径
    document.getElementById('freeCreateSaveFolder').value = '';
    
    // 重置预览区域
    const resultDisplay = document.getElementById('freeCreateResultDisplay');
    resultDisplay.innerHTML = `
        <div class="result-placeholder">
            <p>生成的图片将在这里显示</p>
        </div>
    `;
    
    showNotification('已清空，可以开始新的创作', 'success');
}
