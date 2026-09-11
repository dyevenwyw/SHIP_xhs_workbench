import { Router } from 'express';
import { search, fetchNote, extractNoteId, isRiskStopped } from '../opencli.js';
import { toReadableUrl, resolveNoteReadonly } from '../linkresolver.js';
import { getSettings } from '../config.js';
import { addNote, listLibrary, updateNoteContent } from '../library.js';

const router = Router();

/** 归一化：fetchNote 需接收 explore/ 直读链接才能拿到正文 */
function preferReadable(src) {
  if (!src?.url) return src;
  const r = toReadableUrl(src.url);
  return { ...src, url: r.ok ? r.url : src.url };
}

// 按关键词调研
router.post('/research', async (req, res) => {
  try {
    const { keyword, minLikes, count, includeOcr, downloadImages, batchTag } = req.body || {};
    const settings = getSettings();
    const limit = count ?? settings.defaults.fetchCount ?? 30;
    const min = minLikes ?? settings.defaults.minLikes ?? 0;
    const doOcr = includeOcr ?? settings.defaults.includeOcr ?? true;
    const doDownload = downloadImages ?? false;

    const notes = await search({ keyword, limit });
    // 过滤 + 按点赞降序
    let filtered = notes.filter(n => n.likes >= min);
    filtered.sort((a, b) => b.likes - a.likes);

    // 逐条拉完整详情（search 结果无正文与图片 URL）+ 入库 + OCR
    // opencli 内部已保证串行 + 5~20s 无序间隔；fetchNote 用 explore 直读链接才能取到正文
    const added = [];
    let newCount = 0, dupCount = 0;
    for (const s of filtered.slice(0, limit)) {
      let note = s;
      if (s.url) {
        try { const r = await fetchNote(preferReadable(s).url); note = { ...r, likes: r.likes || s.likes }; } catch (e) { /* 详情失败则退回列表数据 */ }
      }
      const r = await addNote(note, {
        downloadImages: doDownload,
        ocr: doOcr,
        batchTag: batchTag || `search:${keyword}`
      });
      r.isNew ? newCount++ : dupCount++;
      added.push(r);
    }

    res.json({
      keyword, limit, minLikes: min, total_fetched: notes.length, kept: filtered.length,
      new_count: newCount, dup_count: dupCount,
      notes: added
    });
  } catch (e) {
    const risk = e.message.includes('风控');
    res.status(risk ? 429 : 500).json({ error: e.message, risk, riskStopped: isRiskStopped() });
  }
});

// 粘贴对标链接，抓取单篇进素材库
router.post('/research/link', async (req, res) => {
  try {
    const { url, includeOcr, downloadImages, batchTag } = req.body || {};
    if (!url) return res.status(400).json({ error: '缺少 url' });
    const r0 = toReadableUrl(url);
    const note = await fetchNote(r0.ok ? r0.url : url);
    const r = await addNote(note, {
      downloadImages: !!downloadImages,
      ocr: includeOcr ?? true,
      batchTag: batchTag || `link:${url}`
    });
    res.json({ added: r });
  } catch (e) {
    const risk = e.message.includes('风控');
    res.status(risk ? 429 : 500).json({ error: e.message, risk, riskStopped: isRiskStopped() });
  }
});

// 对已有素材补抓正文：主=opencli(explore直读链接)，备=只读链接解析
router.post('/research/refetch', async (req, res) => {
  try {
    const { id, forceReadonly } = req.body || {};
    if (!id) return res.status(400).json({ error: '缺少 id' });
    const entry = listLibrary().find(x => x.id === id);
    if (!entry) return res.status(404).json({ error: '素材不存在' });
    if (!entry.url) return res.status(400).json({ error: '该素材无链接，无法补抓' });

    const r0 = toReadableUrl(entry.url);
    let fresh = null;
    let used = '';

    // 主通道：opencli（登录态会话，字段最全），传 explore 直读链接
    if (!forceReadonly && !isRiskStopped() && r0.ok) {
      try {
        fresh = await fetchNote(r0.url);
        used = fresh?.content ? 'opencli' : '';
        if (fresh?.content) {
          const realId = extractNoteId(entry.url) || id;
          const updated = updateNoteContent(realId, fresh) || updateNoteContent(id, fresh);
          return res.json({ refetched: true, channel: 'opencli', id: realId, title: updated?.title, content: updated?.content });
        }
      } catch (e) { fresh = null; used = ''; }
    }

    // 备通道：只读链接解析（匿名、无态），即使 opencli 空/风控也可尝试
    const ro = await resolveNoteReadonly(entry.url);
    if (ro.ok && ro.content) {
      const realId = extractNoteId(entry.url) || id;
      const updated = updateNoteContent(realId, { content: ro.content, title: ro.title }) || updateNoteContent(id, { content: ro.content, title: ro.title });
      return res.json({ refetched: true, channel: 'readonly', id: realId, title: updated?.title, content: updated?.content });
    }

    res.json({ refetched: false, channel: used || 'none', reason: ro.reason || '未返回正文', title: entry.title });
  } catch (e) {
    const risk = e.message.includes('风控');
    res.status(risk ? 429 : 500).json({ error: e.message, risk, riskStopped: isRiskStopped() });
  }
});

export default router;