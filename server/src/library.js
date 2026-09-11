import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LIB_NOTES, LIB_OCR, LIB_INDEX, DATA_DIR, DRAFTS_DIR, JOBS_DIR } from './paths.js';
import { ocrImages } from './ocr.js';
import { downloadNoteImages } from './opencli.js';

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
const writeJson = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj, null, 2));

function loadIndex() {
  if (!fs.existsSync(LIB_INDEX)) return [];
  try { return JSON.parse(fs.readFileSync(LIB_INDEX, 'utf8')); } catch { return []; }
}

// 写 index 前自动滚动快照（防止误删/覆盖后无法恢复；保留最近 30 份）
function snapshotIndex() {
  try {
    if (!fs.existsSync(LIB_INDEX)) return;
    const backupDir = path.join(DATA_DIR, 'library', '.backup');
    ensureDir(backupDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(backupDir, `index-${stamp}.json`);
    fs.copyFileSync(LIB_INDEX, target);
    const files = fs.readdirSync(backupDir).filter(f => f.startsWith('index-')).sort();
    while (files.length > 30) {
      const oldest = files.shift();
      fs.rmSync(path.join(backupDir, oldest), { force: true });
    }
  } catch { /* 快照失败不阻断主流程 */ }
}

function saveIndex(idx) {
  ensureDir(path.dirname(LIB_INDEX));
  snapshotIndex();
  writeJson(LIB_INDEX, idx);
}

export function listLibrary() {
  const idx = loadIndex();
  return idx.map(e => ({
    ...e,
    notePath: e.noteFile ? path.join(LIB_NOTES, e.noteFile) : null,
    ocrPath: e.ocrFile ? path.join(LIB_OCR, e.ocrFile) : null
  }));
}

/** 用新的详情覆盖素材笔记文件，并同步点赞等索引字段。返回更新后的笔记。 */
export function updateNoteContent(id, fresh) {
  if (!id) return null;
  const idx = loadIndex();
  const e = idx.find(x => x.id === id);
  if (!e) return null;
  const file = path.join(LIB_NOTES, e.noteFile);
  if (!fs.existsSync(file)) return null;
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  const merged = { ...old, ...fresh, raw: fresh.raw ?? old.raw };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  if (fresh) Object.assign(e, { likes: fresh.likes ?? e.likes, title: fresh.title || e.title, content: merged.content });
  saveIndex(idx);
  return merged;
}

export function getNote(id) {
  const idx = loadIndex();
  const e = idx.find(x => x.id === id);
  if (!e) return null;
  const file = path.join(LIB_NOTES, e.noteFile);
  if (!fs.existsSync(file)) return null;
  const note = JSON.parse(fs.readFileSync(file, 'utf8'));
  // OCR 可选：ocrFile 可能缺失/为空（无 OCR 的笔记）。仅在 ocrFile 确为文件名时才读，
  // 并用 try/catch 兜底，避免 ocrFile 为空导致 path.join 落到目录本身而抛 EISDIR、或 OCR 文件损坏致 500。
  const ocrName = String(e.ocrFile || '').trim();
  note._ocr = null;
  if (ocrName) {
    const ocrFile = path.join(LIB_OCR, ocrName);
    if (fs.existsSync(ocrFile) && fs.statSync(ocrFile).isFile()) {
      try { note._ocr = JSON.parse(fs.readFileSync(ocrFile, 'utf8')); }
      catch { note._ocr = null; }
    }
  }
  return note;
}

/** 标题 + 作者 归一化（去空白、全角空格；用于去重匹配） */
function normTitle(t) { return String(t || '').replace(/\s|　/g, '').trim(); }
function normAuthor(a) { return String(a || '').replace(/\s|　/g, '').trim(); }

/**
 * 命中已有素材：先按 id（source+笔记id），再按「标题 + 作者」。
 * 标题相同时若任一方作者缺失，也视为同一篇，避免空作者导致重复入库。
 */
function findExisting(idx, id, note) {
  const byId = idx.find(x => x.id === id);
  if (byId) return { entry: byId, by: 'id' };
  const t = normTitle(note.title);
  const a = normAuthor(note.author);
  if (!t) return { entry: null, by: null };
  const byTitle = idx.find(x => {
    if (normTitle(x.title) !== t) return false;
    const xa = normAuthor(x.author);
    return !a || !xa || xa === a;
  });
  return byTitle ? { entry: byTitle, by: 'title_author' } : { entry: null, by: null };
}

/** 删除某条素材的图片目录与 OCR（替换内容前清理旧资源） */
function purgeAssets(id) {
  const imgDir = path.join(LIB_NOTES, `${id}_imgs`);
  if (fs.existsSync(imgDir)) fs.rmSync(imgDir, { recursive: true, force: true });
  const ocrFile = path.join(LIB_OCR, `${id}_ocr.json`);
  if (fs.existsSync(ocrFile)) fs.rmSync(ocrFile, { force: true });
}

/** 从图片目录里挑一张封面（优先 _1 结尾的首图） */
function pickCover(id) {
  const files = readdirImages(path.join(LIB_NOTES, `${id}_imgs`));
  if (!files.length) return null;
  const first = files.find(f => /[_-]1\.(png|jpe?g|webp|heic)$/i.test(f));
  return path.relative(LIB_NOTES, first || files.slice().sort()[0]);
}

/**
 * 收录一条笔记进素材库（含可选图片下载 + OCR）。
 * 命中已有素材（同 id 或 同标题+作者）时用新内容替换，不重复入库。
 * @param {object} note  已归一化的笔记
 * @param {object} opts  { downloadImages: bool, ocr: bool, batchTag }
 */
export async function addNote(note, opts = {}) {
  ensureDir(LIB_NOTES);
  ensureDir(LIB_OCR);
  const newId = crypto.createHash('md5').update(`${note.source}_${note.id}`).digest('hex').slice(0, 12);
  const idx = loadIndex();
  const hit = findExisting(idx, newId, note);
  const exist = hit.entry;
  const replaced = !!exist;                       // 已存在 -> 本次是替换更新
  const id = exist ? exist.id : newId;            // 沿用命中条目的 id，避免产生重复
  const noteFile = `${id}.json`;

  // 若命中条目的 id 与本次算出的 id 不同（同文不同链接），清掉本次算出的那条临时文件
  if (exist && newId !== id) {
    const tmpFile = path.join(LIB_NOTES, `${newId}.json`);
    if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile, { force: true });
    const tmpImg = path.join(LIB_NOTES, `${newId}_imgs`);
    if (fs.existsSync(tmpImg)) fs.rmSync(tmpImg, { recursive: true, force: true });
  }

  if (!exist) {
    fs.writeFileSync(path.join(LIB_NOTES, noteFile), JSON.stringify(note, null, 2));
    const entry = {
      id,
      source: note.source || '',
      title: note.title || '',
      author: note.author || '',
      likes: note.likes || 0,
      collected_at: new Date().toISOString(),
      batchTag: opts.batchTag || '',
      noteFile,
      ocrFile: null,
      hasOcr: false,
      cover: null,
      url: note.url || ''
    };
    idx.push(entry);
    saveIndex(idx);
  } else {
    // 替换：以新抓取内容为准，刷新点赞/标题/作者/链接/时间
    fs.writeFileSync(path.join(LIB_NOTES, exist.noteFile), JSON.stringify(note, null, 2));
    Object.assign(exist, {
      title: note.title || exist.title,
      author: note.author || exist.author,
      likes: note.likes ?? exist.likes,
      url: note.url || exist.url,
      source: note.source || exist.source,
      batchTag: opts.batchTag || exist.batchTag,
      updated_at: new Date().toISOString(),
      ocrFile: null,
      hasOcr: false,
      cover: null
    });
    saveIndex(idx);
  }

  // 图片下载 + OCR（可选）
  let ocrResult = null;
  if (opts.ocr && note.url) {
    if (replaced) purgeAssets(id);   // 替换时先清旧图，避免新旧图混在一起
    const imgDir = path.join(LIB_NOTES, `${id}_imgs`);
    ensureDir(imgDir);
    try {
      await downloadNoteImages(note.url, imgDir);
    } catch (e) { /* 下载失败不阻断 */ }
    const files = readdirImages(imgDir);
    if (files.length) {
      ocrResult = await ocrImages(files);
      const ocrFile = `${id}_ocr.json`;
      writeJson(path.join(LIB_OCR, ocrFile), ocrResult);
      const all = loadIndex();
      const e = all.find(x => x.id === id);
      if (e) {
        e.ocrFile = ocrFile;
        e.hasOcr = true;
        e.cover = pickCover(id);
        saveIndex(all);
      }
    }
  }

  const entry = loadIndex().find(x => x.id === id);
  return { id, entry, ocr: ocrResult, isNew: !exist, replaced };
}

/** 按 id 删除若干素材：图片目录 + OCR + 笔记文件 + 索引条目 */
export function removeLibraryNotes(ids) {
  const set = new Set((ids || []).map(String));
  if (!set.size) return { removed: 0 };
  const idx = loadIndex();
  const kept = [];
  let removed = 0;
  for (const e of idx) {
    if (set.has(e.id)) {
      try {
        if (e.noteFile) { const f = path.join(LIB_NOTES, e.noteFile); if (fs.existsSync(f)) fs.rmSync(f, { force: true }); }
        purgeAssets(e.id);
      } catch {}
      removed++;
      continue;
    }
    kept.push(e);
  }
  saveIndex(kept);
  return { removed, total: kept.length };
}

/** 整理历史重复：标题+作者相同的只保留最新一条，其余删除 */
export function dedupeLibrary() {
  const idx = loadIndex();
  const seen = new Map();
  const keep = [];
  let removed = 0;
  for (const e of idx.slice().sort((a, b) => String(b.collected_at || b.updated_at || '').localeCompare(String(a.collected_at || a.updated_at || '')))) {
    const key = `${normTitle(e.title)}|${normAuthor(e.author)}`;
    if (normTitle(e.title) && seen.has(key)) {
      const f = path.join(LIB_NOTES, e.noteFile);
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
      purgeAssets(e.id);
      removed++;
      continue;
    }
    seen.set(key, e.id);
    keep.push(e);
  }
  // 保留原顺序
  const order = idx.map(x => x.id);
  keep.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  // 补齐缺失的封面字段
  for (const e of keep) if (!e.cover) e.cover = pickCover(e.id);
  saveIndex(keep);
  return { removed, total: keep.length };
}

function isImage(f) {
  return /\.(png|jpg|jpeg|webp|heic)$/i.test(f);
}

export function readdirImages(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readdirImages(full));   // opencli 会在输出目录下建子文件夹
    else if (isImage(full)) out.push(full);
  }
  return out;
}

// ---- 产物归档（分析/文案/方案/jobs）----
export function saveArtefact(dir, ext, payload, meta = {}) {
  ensureDir(dir);
  const id = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const file = path.join(dir, `${id}.${ext}`);
  const data = { id, createdAt: new Date().toISOString(), ...meta, payload };
  writeJson(file, { ...data, payloadDeepStore: false });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return { id, file, data };
}

export function loadArtefacts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function saveJob(job) {
  ensureDir(JOBS_DIR);
  const file = path.join(JOBS_DIR, `${job.id || Date.now()}.json`);
  writeJson(file, job);
  return job;
}
export function saveDraft(draft) {
  ensureDir(DRAFTS_DIR);
  const file = path.join(DRAFTS_DIR, `${draft.id}.json`);
  writeJson(file, draft);
  return draft;
}
export function listDrafts() { return loadArtefacts(DRAFTS_DIR); }

/** 清空素材库（索引 + 笔记 + 图片 + OCR）。仅用户显式点击"清空所有素材"时调用。 */
export function clearLibrary() {
  writeJson(LIB_INDEX, []);
  for (const dir of [LIB_NOTES, LIB_OCR]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return { cleared: true };
}