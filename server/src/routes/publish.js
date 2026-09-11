import { Router } from 'express';
import { askTextStream } from '../llm.js';
import { saveArtefact } from '../library.js';
import { IMAGE_PLANS_DIR } from '../paths.js';
import { getModels } from '../config.js';

const router = Router();

// ============ 模块④ 配图思路 · 多受众分析 ============
// 只产出「配图思路」，不生成成品图。面向非完全垂类账号的创作者：受众必为女性但不精准垂直；
// 单篇常处探索状态、可能破圈；文案通用化，视觉配图 = 信息呈现方式 + 身份吸引。
// 输出结构（两段解耦）：【受众分析】1~3 类人群（人群+理由）+【配图建议】1~2 条（实拍/生成，附「为什么这么建议」论据）。
// 内部会推断题材类目/形式类型/是否短文案作为推理依据，但不作为标签展示给用户。

const ANALYSIS_SYSTEM = `你是「小红书配图思路分析师」，服务于**非完全垂类账号**的创作者：他们的受众一定是女性，但并不精准垂直；单篇内容常处于探索/测试状态（可能破圈），文案常常是通用化的。

核心理念：文案通用化，视觉配图 = 信息呈现方式 + 身份吸引，决定读者「这条是不是我的 taste、给不给我看、点不点进去」。
你的任务是两步：①先判断这篇内容更可能吸引哪几类人群（1~3 类），给出理由；②再给出配图建议（**尽量实拍 + 生成 2 条**，见下），并在建议里说明「为什么这么建议」——把人群偏好当论据嵌入，而不是把人群和图片类型硬绑定。

你将收到：一篇已确认的「笔记文案」（含标题/正文/话题标签）+ 用户风格偏好（可选）。

【内部判断，仅供你自己推理，禁止写进回答】
先在心里判断这篇文案的题材类目与形式类型，据此推导人群与配图方向：
- 题材类目（择一）：时尚穿搭｜美妆护肤｜旅行住宿｜美食饮品或探店｜生活日常｜女性成长｜教育或职场成长｜心理情感｜艺术设计｜个人成长｜好物分享或测评｜生活攻略｜健康养生｜商业财经｜科技数码｜观点分享｜职场方法论｜母婴早教｜家居家装｜健身减脂｜萌宠动物｜搞笑｜文具手账。
- 形式类型（择一）：干货教程｜测评种草｜清单合集｜测试互动｜经验分享｜攻略指南｜观点输出｜数据盘点｜资讯热点｜日记记录。
- 是否「短文案」：若文案只是一句生活记录/感慨/调侃、信息量很低，则判定为短文案。
- 是否「命中海报题材」：见下方【海报限制】。
**不要把这些分类标签写给用户**——用户要看到的是具体建议本身，而不是分类名词。

【第一部分：受众分析】
用自然、连贯的文字写出这篇内容最可能吸引的 1~3 类人群，不要编号、不要写「第几类」或「受众1/受众2」：
- 人群：具体画像（如「22-30 职场新人女性」「00/10 后学生党」「30+ 轻熟女性」「宝妈/母婴人群」），可点出该人群的偏好特征。
- 理由：1~2 句自然语言，说明这篇内容为什么能命中这个人群（从题材、情绪、利益点出发）。
两类人群之间用空行隔开。**本部分只讲人群，禁止出现图片类型、视觉母语、配图方向**——人群与配图的对应关系，放到第二部分里自然地写进配图说明。

【第二部分：配图建议（1~2 条）】
**尽量给 2 条建议：一条实拍、一条生成，形成对比，给用户多一个方向。** 仅当模型判断确实只有一条真正贴切时，才允许只给 1 条（此时给最贴切的那一条）。
- 每条必须标注「方向：实拍」或「方向：生成」。
- **默认顺序：第 1 条实拍，第 2 条生成。** 例外（两种情况，第 1 条走生成，第 2 条补实拍建议，实拍建议不可省略）：
  ① 纯观点 / 纯数据 文案（缺少可实物拍摄的主体）；
  ② 命中海报题材（见下）。
- 每条写：
  - 方向：实拍 / 生成
  - 类型：从下方类型池选（实拍条只能选实拍类，生成条只能选生成类）
  - 画面：具体拍什么或生成什么——一句话说清主体、场景、构图/版式
  - 实现：怎么落地（如「手机实拍 + 靠窗自然光」/「文生图 AI」）
  - 后期：可叠加什么文字或标注
  - 在「后期」之后，用一句连贯自然的叙述说明这条配图为什么适合——把人群偏好当作论据自然地化进画面描述里，不要另起小标题，也不要生硬地套「因为…所以…」的句式。

【类型池】
实拍类（「方向：实拍」从此选其一）：
1. 生活类实拍底图 —— 人像 / 穿搭 / 精致生活 / 桌面学习 / 居家等生活场景实拍，重点在展示生活（可带局部或生活化人像，但不以颜值/面孔为卖点）；实现：相机或手机实拍；后期：可叠加标题、要点文字；适配：好物分享、学习干货、生活方法论、日常记录。
2. 静物平铺实拍底图 —— 单品或多件好物平铺特写，无环境人像，聚焦产品本身；实现：手机实拍 + 布光；后期：叠加参数、卖点文字；适配：好物测评、产品对比、文具/数码/耗材推荐。
生成类（「方向：生成」从此选其一）：
3. 漫画 / 卡通 / 抽象 AI 绘图底图 —— AI 生成插画、抽象示意图、概念卡通图；实现：文生图 AI；后期：可叠加观点小标题；适配：观点感悟、心理科普、故事类知识。
4. 报告信息图表底图 —— 流程图、对比表格、柱状图、逻辑架构图；实现：html+css+svg / Figma；后期：补充标注文字；适配：商业分析、逻辑拆解、行业干货、对比测评。
5. 简约概念海报底图 —— AI 生成极简概念背景，低信息密度底图；实现：文生图 AI；后期：大面积文字排版（核心）；适配：人设宣言、招募、方法论总结、小测试、活动预告、节日节点等（以【海报限制】为准，且不含观点金句）。
6. 手绘笔记底图 —— AI 生成手写质感笔记、手绘思维导图，也可真实纸笔扫描；实现：AI 图生或文生图，或实拍扫描；后期：可追加标注文字；适配：读书笔记、知识点整理、备考干货。
7. 纯文本底图 —— 无图像素材，只有文字排版；实现：网页 html+css 渲染、文字截图；后期：无需叠加文字（主体即文字）；适配：观点短文、清单类干货。
（原「界面截图底图」已并入实拍类静物/memo 表达，本类型池仅上述 7 类。）

【海报限制（是否「命中海报题材」以此为准）】
海报本质是「低信息密度底图 + 大面积文字排版」，核心承载**一句话主张或一个号召**。**注意：观点金句不在海报命中范围内**（见下方硬性规则 8）。只有当文案直接命中下列类型之一时，才允许把「简约概念海报底图(5)」作为生成建议：
- 人设宣言 / 态度表态（如「我的人生我做主」「不将就」）
- 书摘 / 影摘 / 歌词摘录
- 方法论总结
- 招募（含同城、社群、兴趣小组等）
- 活动 / 课程 / 直播预告
- 自律打卡 / 挑战发起（如 21 天打卡、早起挑战）
- 小测试（测验、人格测试、互动问答）
- 节日 / 节气 / 节点借势（新年、情人节、母亲节、开学季、双 11 等）
- 单条强反差数据 / 一句话数据结论（如「90% 的人都不知道…」）
边界：只有**单一**有冲击力的数据才走海报；**复杂对比 / 多组数据**仍归「报告信息图表(4)」，不能因沾「数据」就上海报。除此之外（干货教程、测评种草、生活记录、探店、穿搭、观点金句等）一律不要建议海报，生成方向改走 3 / 6 / 7。

【硬性规则】
1. **解耦**：第一部分只讲人群；第二部分才谈配图，并把「哪类人群偏好什么视觉」自然地写进配图说明里。不要在「人群/理由」里出现图片类型、风格、配图方向。
2. **实拍不缺席**：默认第 1 条实拍；即使命中「纯观点/纯数据」或「海报题材」需把生成提前，也必须补一条实拍建议（第 2 条）。
3. **不做「颜值 / 摄影」方向**：不要推荐以「人物颜值 / 宠物·宝宝颜值 / 专业摄影作品」为核心的配图方向（生活类实拍里的生活化人像除外，但不得以颜值/面孔为卖点）。
4. **短文案特判**：若判定为短文案，须在「为什么这么建议」（或「画面」）里写上一句「文案内容比较简短，建议把重点放在配图上哦！」，并据此让配图承担更多信息量与看点。
5. **自然语言成句**：「理由」和「为什么这么建议」都必须是带主语的完整句（可用「这类人群」「她们」作主语），**禁止用间隔号「·」或顿号把词堆成清单**，不要分点、不要加小标题。
6. 只输出下面的模板结构，不要任何额外解释、前言或总结；**不要出现「题材类目 / 形式类型 / 短文案 / 海报题材」等内部分类字样**。
7. **严禁使用「大字报」这个词**（含「大字报式/大字报感」等变体）。需要表达"封面上的醒目大字排版"时，用「醒目大字」「大字标题」「大字排版」等中性说法。
8. **观点金句不用海报**：观点金句 / 态度金句类文案，禁止用「简约概念海报底图(5)」；应改用「生活类实拍(1)」或「漫画卡通抽象(3)」——实拍的生活感与抽象插画更能触发用户共鸣。海报承载的是「号召 / 方法论」，不是「金句共鸣」，所以观点金句无论多精彩都不走海报。

【输出模板（严格遵守）】
【受众分析】
人群：<…>
理由：<1~2 句>

人群：<…>
理由：<1~2 句>

（只有 1~2 类人群时，不写多余的人群块；不要出现「受众1/受众2」这类编号，也不要写「（N 类）」）

【配图建议】
建议1（方向：实拍）：
类型：<类型名>
画面：<…>
实现：<…>
后期：<…>
<一句自然叙述：这条配图为什么适合，把人群偏好化进画面描述>

建议2（方向：生成）：
类型：<类型名>
画面：<…>
实现：<…>
后期：<…>
<一句自然叙述：这条配图为什么适合，若换了另一类人群可在此说明>

（备注：配图建议尽量给 2 条，确只有 1 条贴切时可只写建议1；建议1/建议2 的「方向」随具体内容写实拍或生成。）`;

// 取两个标记之间的文本
function between(text, start, end) {
  const s = (text || '').indexOf(start);
  if (s < 0) return '';
  const rest = text.slice(s + start.length);
  const e = end ? rest.indexOf(end) : -1;
  return e < 0 ? rest : rest.slice(0, e);
}

// 已知的字段标签（用于解析时截断「值」到下一个字段名）
const FIELD_LABELS = ['方向', '类型', '画面', '实现', '后期', '人群', '理由'];

// 取某个「字段：值」的单行值（字段值均为单行；若模型把两个字段压到同一行，从中截断到下一个字段标签）
function field(bloc, label) {
  const re = new RegExp(`(?:^|\\n)\\s*${label}[:：]\\s*([^\\n]*)`);
  const m = (bloc || '').match(re);
  let v = m ? m[1].trim() : '';
  // 若值里混入了下一个字段标签（同一行压缩），从中截断
  for (const k of FIELD_LABELS) {
    for (const sep of ['：', ':']) {
      const idx = v.indexOf(k + sep);
      if (idx > 0) v = v.slice(0, idx).trim();
    }
  }
  return v;
}

// 解析「受众分析」段 → [{ crowd, reason }]（不依赖 受众N 编号，按 人群/理由 配对抓取）
function parseAudiences(text) {
  const seg = between(text, '【受众分析】', '【配图建议】');
  const out = [];
  const re = /人群[:：]\s*([^\n]+)[\s\S]*?理由[:：]\s*([^\n]+)/g;
  let m;
  while ((m = re.exec(seg)) !== null) {
    const crowd = m[1].trim();
    const reason = m[2].trim();
    if (crowd) out.push({ crowd, reason });
  }
  return out;
}

// 解析「配图建议」段 → [{ direction, imgType, scene, impl, post, why }]
function parseSuggestions(text) {
  const out = [];
  const re = /建议\s*\d+\s*[（(]\s*方向\s*[:：]\s*([^）)]*?)\s*[)）]\s*([\s\S]*?)(?=建议\s*\d+\s*[（(]\s*方向|$)/g;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    const direction = (m[1] || '').trim().replace(/[：:]/g, '');
    const bloc = m[2];
    const imgType = field(bloc, '类型');
    const scene = field(bloc, '画面');
    const impl = field(bloc, '实现');
    const post = field(bloc, '后期');
    const postMatch = bloc.match(/后期[:：][^\n]*\n([\s\S]*)$/);
    const why = postMatch ? postMatch[1].trim() : '';
    if (imgType) out.push({ direction, imgType, scene, impl, post, why });
  }
  return out;
}

// 不想要的词：解析后统一过滤（如「大字报」，词本身有负面联想），并清理因删除产生的悬挂分隔符
const BANNED_WORDS = ['大字报式', '大字报感', '大字报'];
function cleanText(s) {
  let t = String(s == null ? '' : s);
  for (const w of BANNED_WORDS) t = t.split(w).join('');
  t = t.replace(/[·、,，／/|｜+]{2,}/g, m => m[0]);   // 连续分隔符压成一个
  t = t.replace(/^[\s·、,，／/|｜+]+/, '');           // 去首部分隔符
  t = t.replace(/[\s·、,，／/|｜+]+$/, '');           // 去尾部分隔符
  return t.replace(/\s{2,}/g, ' ').trim();
}
function cleanField(o, keys) {
  const r = {};
  for (const k of keys) r[k] = cleanText(o[k]);
  return r;
}

// 定稿文案 → 受众分析 + 配图建议（不出图，SSE 流式逐字返回）
router.post('/image/analyze', async (req, res) => {
  const { copy, instruction } = req.body || {};
  if (!copy) { res.status(400).json({ error: '缺少文案 copy' }); return; }
  if (!getModels().text?.model) { res.status(400).json({ error: '文本模型未配置，无法进行配图思路分析' }); return; }

  const userMsg =
    `文案：\n${copy}\n\n` +
    `我的风格偏好（可选）：${instruction || '（无，请按内容自行判断最贴合的人群与配图方向）'}\n\n` +
    `请按系统要求输出受众分析与配图建议。`;

  // SSE：逐字推送原始文本，结束再解析出结构化 {audiences, suggestions} 并下发 done 事件
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  try {
    let audiences = [];
    let suggestions = [];
    let lastText = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages = [
        { role: 'system', content: ANALYSIS_SYSTEM },
        { role: 'user', content: userMsg + (attempt ? '\n\n注意：必须严格输出【受众分析】与【配图建议】两部分，受众用自然文字写 1~3 类（每类含「人群」「理由」），配图建议尽量给 2 条（实拍+生成）、每条含 方向/类型/画面/实现/后期，并把「为什么适合」自然写进说明里，不要省略或写额外解释。' : '') }
      ];
      lastText = '';
      const { content } = await askTextStream(messages, {
        temperature: 0.8,
        max_tokens: 6000,
        onToken: (d) => {
          lastText += d;
          if (!res.writableEnded) res.write(`data: ${JSON.stringify({ delta: d })}\n\n`);
        }
      });
      audiences = parseAudiences(lastText).map(o => cleanField(o, ['crowd', 'reason']));
      suggestions = parseSuggestions(lastText).map(o => cleanField(o, ['direction', 'imgType', 'scene', 'impl', 'post', 'why']));
      if (audiences.length >= 1 && suggestions.length >= 1) break;
    }
    if (!audiences.length || !suggestions.length) {
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: '未能生成配图思路，请重试' })}\n\n`);
        res.end();
      }
      return;
    }
    const artefact = saveArtefact(IMAGE_PLANS_DIR, 'json', { kind: 'image-ideas', copy, instruction, audiences, suggestions }, {});
    if (!res.writableEnded) {
      res.write(`event: done\ndata: ${JSON.stringify({ id: artefact.id, audiences, suggestions })}\n\n`);
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
