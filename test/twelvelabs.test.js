// TwelveLabs 集成测试
// 运行：node test/twelvelabs.test.js
//
// - 无网络单测：余弦相似度、未配置 Key 时的行为，始终执行。
// - 在线契约测试：仅当设置了 TWELVELABS_API_KEY 环境变量时执行，
//   验证 Marengo 文本向量为 512 维、素材排序可用；否则自动跳过。

const assert = require('assert');
const tl = require('../twelvelabs');

async function main() {
    // ---- 无网络单测 ----
    assert.strictEqual(tl.isEnabled({}), false, '空配置应为未启用');
    assert.strictEqual(tl.isEnabled({ 'TwelveLabs-API-KEY': 'x' }), true, '填了 Key 应为已启用');

    // 余弦相似度：相同向量为 1，正交向量为 0
    assert.ok(Math.abs(tl.cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9, '相同向量应为 1');
    assert.strictEqual(tl.cosineSimilarity([1, 0], [0, 1]), 0, '正交向量应为 0');

    // 未配置 Key 时应抛错而不是静默调用 API
    await assert.rejects(
        () => tl.analyzeVideo({}, { video: { type: 'url', url: 'http://x' }, prompt: 'hi' }),
        /未配置 TwelveLabs-API-KEY/
    );
    await assert.rejects(() => tl.embedText({}, 'hi'), /未配置 TwelveLabs-API-KEY/);

    console.log('✅ 无网络单测通过');

    // ---- 在线契约测试（需要 TWELVELABS_API_KEY）----
    const apiKey = process.env.TWELVELABS_API_KEY;
    if (!apiKey) {
        console.log('⏭️  未设置 TWELVELABS_API_KEY，跳过在线契约测试');
        return;
    }
    const config = { 'TwelveLabs-API-KEY': apiKey };

    const vec = await tl.embedText(config, '海边日落，温暖的色调');
    assert.strictEqual(vec.length, 512, 'Marengo 文本向量应为 512 维');
    console.log(`✅ Marengo 文本向量维度: ${vec.length}`);

    const ranked = await tl.rankMaterials(config, {
        query: '一只猫在草地上奔跑',
        candidates: ['草地上奔跑的猫', '城市夜景霓虹灯', '一只奔跑的小猫'],
        topK: 2
    });
    assert.strictEqual(ranked.length, 2, 'topK=2 应返回 2 条');
    assert.ok(ranked[0].score >= ranked[1].score, '结果应按相似度降序');
    // 与「猫」相关的候选应排在「城市夜景」之前
    assert.notStrictEqual(ranked[0].label, '城市夜景霓虹灯', '最相关项不应是无关素材');
    console.log('✅ Marengo 素材排序通过:', ranked.map(r => `${r.label}(${r.score.toFixed(3)})`).join(', '));

    console.log('✅ 全部测试通过');
}

main().catch(err => {
    console.error('❌ 测试失败:', err);
    process.exit(1);
});
