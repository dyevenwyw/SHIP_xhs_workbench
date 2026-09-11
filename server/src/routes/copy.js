import { Router } from 'express';
import { askTextFull } from '../llm.js';
import { saveDraft, getNote } from '../library.js';
import { buildPromptWithSkill, listSkills } from '../skills.js';

const router = Router();

// 文案写稿策略 —— 固定白名单（对应 server/skills-core/ 下的 core 文件名，不随原版 skill 目录变化）
const COPY_SKILLS = [
  'title',            // 8模板爆款标题
  'humanizer',        // 去AI腔自然化改写
  'baokuan',          // 全赛道完整爆款文案
  'viral-copywriter', // 个人IP人设文案
  'viral-note',       // 种草笔记快速文案
  'buzz-copy'         // 原生种草埋词文案
];

// 前端优势文案（label）直接取自各 core 文件的 frontmatter，不在此硬编码。
// 缺失时回退到 core 的 name。
const labelOf = (name) => {
  const s = listSkills().find((x) => x.name === name);
  return s?.label || name;
};

// 列出可选文案 skill（固定 6 个白名单，绝不自动补新装 skill）
router.get('/copy/skills', (req, res) => {
  const all = listSkills();                                   // 只扫一次
  const installed = new Set(all.map(s => s.name));
  const pool = COPY_SKILLS.map(name => {
    const s = all.find(x => x.name === name);
    return {
      name,
      label: labelOf(name),
      installed: installed.has(name),
      summary: s?.summary || ''
    };
  });
  res.json({ pool, extras: [] });   // extras 恒为空：新增 skill 不会出现在文案策略里
});

/**
 * 固定生成 3 个版本。
 * - 未勾选策略：从白名单（已安装的）随机抽 3 个不同的策略。
 * - 勾选了 k 个（1~3）：第 1..k 版用对应策略；第 k+1..3 版随机取自「已勾选策略」之一，或不用策略(default)。
 */
function planSkills(userSkills, installedPool) {
  const picked = [...new Set((userSkills || []).filter(s => s && installedPool.includes(s)))].slice(0, 3);
  if (!picked.length) {
    return [...installedPool].sort(() => Math.random() - 0.5).slice(0, 3);   // auto 3 个不同
  }
  const plan = picked.slice();
  while (plan.length < 3) {
    plan.push(Math.random() < 0.6
      ? picked[Math.floor(Math.random() * picked.length)]   // 复用已勾选策略
      : null);                                              // 不用策略（default）
  }
  return plan;
}

// 生成文案：顺序 3 版（一版一版来），每版先校验「完整无截断」才推送展示，SSE 逐条返回
router.post('/copy', async (req, res) => {
  try {
    const { topic, instruction, skills, noteIds } = req.body || {};
    if (!topic) return res.status(400).json({ error: '缺少选题 topic' });

    const allSkills = listSkills();   // 只扫一次，避免 filter 内重复调用
    const installedPool = COPY_SKILLS.filter(name => allSkills.some(s => s.name === name));
    const chosenSkills = planSkills(skills, installedPool);

    // 对标笔记注入：支持多选（noteIds 数组，最多 3 篇）；向后兼容旧的单个 noteId
    const ids = [...new Set((Array.isArray(noteIds) ? noteIds : [noteIds]).filter(Boolean))].slice(0, 3);
    const refs = ids
      .map(id => getNote(id))
      .filter(Boolean)
      .map(ref => `标题：${ref.title}\n正文：${(ref.content || '').slice(0, 1200)}`);
    const refText = refs.length
      ? `参考对标笔记（${refs.length} 篇，模仿其选题与表达但不要照抄）:\n${refs.map((r, i) => `[对标${i + 1}] ${r}`).join('\n\n')}`
      : '';

    const base = [
      '你是小红书爆款文案作者。请基于给定的选题创作一篇可直接发布的小红书笔记完整文案。',
      '写作要求：口语化、有钩子、有情绪共鸣，避免 AI 腔；有 3 秒抓人开头；用户画像代入。',
      '',
      '【输出格式规范——严格遵循】',
      '- 整篇输出不要使用任何 Markdown 符号（不要出现 #、*、**、- 列表符、> 等）；纯文本、口语化呈现。',
      '- 第一行写标题：先用【包裹住标题再写标题文字，例如「【测测你前世是哪种妖怪】」，标题文字必须是【】内部的实际标题内容，不得出现「标题写在这里面」这类占位字样。',
      '- 【标题】后直接接正文，一段或多段自然换行即可，不要有多余的空行分隔符。',
      '- 正文结束后空一行，直接列出话题标签：每个标签以 # 开头（如 #标题话题 #内容话题），同行空格分隔或各占一行均可。',
      '- 最后空一行，跟一条发布建议，格式为：📌 发布建议：<一句可执行的发布时机/配图/互动引导建议>。',
      refText,
      `用户补充指令：${instruction || '（无）'}`
    ].join('\n');

    // SSE 响应头：逐条推送，先完成先到前端
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // 通用创作：不挂任何 skill，纯口语文案（返回 { content, finishReason }）
    async function authorAttempt(sk) {
      const ctx = sk ? buildPromptWithSkill(sk) : '';
      const messages = [
        { role: 'system', content: ctx || '你是小红书爆款文案作者，请用自然、口语、有传播力的中文创作。' },
        { role: 'user', content: `${base}\n\n选题：${topic}` }
      ];
      return askTextFull(messages, { temperature: 0.85, max_tokens: 6000 });
    }

    // humanizer 润色：把一篇已写好的文案做去 AI 腔改写，只回最终笔记（返回 { content, finishReason }）
    async function humanizeText(raw) {
      const ctx = buildPromptWithSkill('humanizer');
      const messages = [
        { role: 'system', content: ctx },
        { role: 'user', content:
          `下面是待改写的小红书笔记原文，请按你的方法论做去 AI 腔自然化改写。\n` +
          `改写后必须保留与原文一致的结构：第一行【标题】、随后正文、空行后 #话题标签、末尾 📌 发布建议；不要使用 Markdown 符号（# * - > 等，话题标签的 # 除外）。\n` +
          `严格只输出改写后的最终笔记，不要输出「改写后文本/剩余AI痕迹/最终修正版/修改说明」这类分析结构，也不要寒暄。\n\n原文：\n${raw}` }
      ];
      return askTextFull(messages, { temperature: 0.7, max_tokens: 6000 });
    }

    // 截断判定：被 token 上限截断（finish_reason=length）或空/过短视作异常，需要重调
    const isTruncated = (finishReason, text) => {
      if (finishReason === 'length') return true;
      if (!text || String(text).trim().length < 20) return true;
      return false;
    };

    // 产出「一版」的最终文案（含截断标记），不负责重试
    async function produceVersion(skill) {
      if (skill === 'humanizer') {
        const rawR = await authorAttempt(null);
        let raw = rawR.content.trim();
        if (!raw) raw = (await authorAttempt(null)).content.trim();     // 通用重调一次
        if (!raw) return { text: '', usedSkill: 'default', finishReason: null };
        const h = await humanizeText(raw);
        return {
          text: h.content.trim() || raw,
          usedSkill: h.content.trim() ? 'humanizer' : 'default',
          finishReason: h.finishReason
        };
      }
      let r = await authorAttempt(skill);
      let usedSkill = skill;
      if (!r.content) r = await authorAttempt(skill);                   // 空值 → 重调一次
      if (!r.content) { r = await authorAttempt(null); usedSkill = null; } // 仍空 → 退化无策略兜底
      return { text: r.content.trim(), usedSkill: usedSkill || 'default', finishReason: r.finishReason };
    }

    // 单版生成（带完整性校验）：最多 3 次尝试，必须「完整无截断」才接受；
    // 截断/空则重试，重试耗尽返回最后一次产物（best-effort，避免缺一个版本位）。
    async function genOne(skill) {
      let fallback = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await produceVersion(skill);
          if (r.text) fallback = r;
          if (r.text && !isTruncated(r.finishReason, r.text)) return r;  // 完整 → 接受并展示
        } catch { /* 异常 → 下一轮重试 */ }
      }
      return fallback || { text: '', usedSkill: skill || 'default', error: '生成失败（始终截断/为空）' };
    }

    // 顺序一版一版生成：每版校验完整后再推一条（先完成先展示），推完再生成下一版
    const total = chosenSkills.length;
    for (const skill of chosenSkills) {
      if (res.writableEnded) break;
      const r = await genOne(skill);                 // 内部已确保完整无截断才返回
      if (res.writableEnded) break;
      const draft = saveDraft({
        id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        topic,
        kind: 'copy',
        text: r.text,
        skill: r.usedSkill || 'default',
        model: 'text',
        createdAt: new Date().toISOString(),
        noteId: ids[0] || null
      });
      const skillLabel = (r.usedSkill ? labelOf(r.usedSkill) : '通用无策略') + (r.error ? '（生成失败）' : '');
      res.write(`data: ${JSON.stringify({ id: draft.id, skill: r.usedSkill || 'default', skillLabel, text: r.text, error: r.error || null })}\n\n`);
    }

    if (!res.writableEnded) {
      res.write(`event: done\ndata: ${JSON.stringify({ count: total })}\n\n`);
      res.end();
    }
  } catch (e) {
    if (!res.headersSent) return res.status(500).json({ error: e.message });
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    }
  }
});

export default router;
