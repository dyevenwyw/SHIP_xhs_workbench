import { Router } from 'express';
import { askTextStream } from '../llm.js';
import { getNote, listLibrary, saveArtefact } from '../library.js';
import { ANALYSIS_DIR } from '../paths.js';

const router = Router();

// 分析选中的素材，产出人性点 + 扩展选题（SSE 流式逐字返回）
router.post('/analyze', async (req, res) => {
  const { noteIds, instruction } = req.body || {};
  const ids = Array.isArray(noteIds) && noteIds.length ? noteIds : listLibrary().slice(0, 10).map(e => e.id);
  const notes = ids.map(getNote).filter(Boolean);

  const material = notes.map((n, i) => (
    `[素材${i + 1}] 标题：${n.title} | 点赞：${n.likes} | 正文：${(n.content || '').slice(0, 800)}`
    + (n._ocr?.length ? ` | 图片OCR：${n._ocr.slice(0, 2).map(o => o.text).join('；').slice(0, 400)}` : '')
  )).join('\n\n');

  const prompt = [
    '你是小红书爆款内核分析师。请按爆款拆解方法论分析下面这批真实对标笔记：先把样本归类并做归因，再挖掘命中的底层人性钩子（每条钩子要直接融合「它为什么能让人上钩、会点击甚至互动」），然后按爆款品类×受众做选题脑暴（保证标题多变、不同质化），最后给出对标文风方向。',
    `用户补充指令：${instruction || '（无）'}`,
    '',
    '【输出硬性要求】整篇只允许下面四个部分，四部分标题按此固定写法；除此之外不要输出任何前言、总结或多余章节。输出不要使用 Markdown 强调符号 *，纯文本呈现，分段用空行。',
    '',
    '一、什么会火（爆款内核）',
    '🔥 归纳这批笔记共通的爆款题材/内核，分点用一句话点破本质。',
    '',
    '二、底层逻辑（深层钩子拆解）',
    '🪝 把命中的深层人性钩子逐条拆解（如：向上跃升欲、损失厌恶、身份认同、认知省力、窥探欲、情绪疗愈、对比效应、叙事偏好、可得性错觉、锚定效应、幸存者偏差、收藏囤积欲、玄学掌控感、情感共鸣、社交货币、猎奇心、峰终定律、参与感、互惠心理、从众效应、证实性偏见、禀赋效应、稀缺心理、归属感、自我投射等）——不要被这个清单框死，按真实素材匹配最贴切的机制。',
    '💡 每一条钩子的拆解里要直接融合“它为什么能让人上钩、会点击甚至互动”：落到这批笔记里具体是哪个标题/封面/内容设计/结果呈现触发了它，不要在最末再单独列一句抽象的“为什么会上钩”。',
    '',
    '三、扩展方向（选题脑暴）',
    '- 先判断这批素材属于什么内容赛道。',
    '- 给出 12 个可直接发布的选题标题；12 个之间必须明显差异、禁止同质化——用"角度 × 情绪 × 受众"三轴交叉保证多变：',
    '  · 角度：蹭热点/节日节点、拟人化或自创IP(规避侵权)、细分而非大类、反转认知、实用清单、场景代入、对比…',
    '  · 情绪：好奇/治愈/扎心/爽感/共鸣/焦虑/轻松…',
    '  · 受众：闺蜜向/宝妈/学生党/打工人/汉服圈/铲屎官…',
    '- 标题句式尽量每一句都不同，12条内容中不得有3条标题同一句式',
    '- 每个标题必须带具体意象、像真人发的笔记、口语化有画面，有网感。',
    '- 格式严格为「- 选题1：「<标题>」（<具体钩子或优势），依此类推到「- 选题12：…」；括号内只写钩子说明。',
    '',
    '四、落地配方（怎么写才爆）',
    '- 给出建议的文风方向：例如趣味化/无厘头/玩梗类要避免“正经感”，口语轻快；走内心情绪共鸣的不能真的煽情，而是克制白描。',
    '- 给出一句方向性要点即可，不要在此部分堆叠标题、标签、封面等其他内容。',
    '',
    '素材如下：',
    material
  ].join('\n');

  const messages = [
    {
      role: 'system',
      content: '你是小红书爆款内核分析师。请按照以下爆款拆解方法论工作：①先把样本归类并做归因；②挖掘命中的深层人性钩子，每条钩子要直接融合「它为什么能让人上钩、会点击甚至互动」；③按爆款品类×受众做选题脑暴，保证标题多变、不同质化；④给出对标文风方向。对于用户给出的素材，严格只产出「一、什么会火 / 二、底层逻辑 / 三、扩展方向 / 四、落地配方」四个部分，全部用中文，不要输出前言或总结。'
    },
    { role: 'user', content: prompt }
  ];

  // SSE：逐字推送，首字延迟从「整段」降到 1~2 秒；结束再发 done 事件（含完整结果 + 落库 id）
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  try {
    const { content } = await askTextStream(messages, {
      temperature: 0.7,
      max_tokens: 8000,
      onToken: (d) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify({ delta: d })}\n\n`);
      }
    });
    const artefact = saveArtefact(ANALYSIS_DIR, 'json', { result: content, noteIds: ids, instruction }, { kind: 'analysis' });
    if (!res.writableEnded) {
      res.write(`event: done\ndata: ${JSON.stringify({ id: artefact.id, result: content, noteCount: notes.length, noteIds: ids })}\n\n`);
      res.end();
    }
  } catch (e) {
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    }
  }
});

export default router;