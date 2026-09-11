import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { getSettings } from './config.js';
import { ensureDirs } from './bootstrap.js';
import { LIB_NOTES, LIB_INDEX, DATA_DIR } from './paths.js';
import configRoutes from './routes/config.js';
import researchRoutes from './routes/research.js';
import analysisRoutes from './routes/analysis.js';
import copyRoutes from './routes/copy.js';
import publishRoutes from './routes/publish.js';
import { listLibrary, getNote, readdirImages, dedupeLibrary, removeLibraryNotes } from './library.js';

ensureDirs();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const settings = getSettings();
const PORT = Number(process.env.PORT) || settings.workbench?.serverPort || 3099;

// 素材库只读接口
app.get('/api/library', (req, res) => res.json(listLibrary()));
app.get('/api/library/:id', (req, res) => {
  const n = getNote(req.params.id);
  if (!n) return res.status(404).json({ error: '未找到' });
  res.json(n);
});
// 素材首图（供列表封面展示，只读；opencli 下载时会多套一层子目录，这里递归查找）
app.get('/api/library/:id/cover', (req, res) => {
  const id = String(req.params.id || '').replace(/[^a-f0-9]/gi, '');
  if (!id) return res.status(400).end();
  try {
    const idx = JSON.parse(fs.readFileSync(LIB_INDEX, 'utf8'));
    const e = idx.find(x => x.id === id);
    let file = e?.cover ? path.join(LIB_NOTES, e.cover) : null;
    if (!file || !fs.existsSync(file)) {
      const imgs = readdirImages(path.join(LIB_NOTES, `${id}_imgs`));
      if (!imgs.length) return res.status(404).end();
      file = imgs.find(f => /[_-]1\.(png|jpe?g|webp|heic)$/i.test(f)) || imgs.slice().sort()[0];
      if (e) {
        e.cover = path.relative(LIB_NOTES, file);
        fs.writeFileSync(LIB_INDEX, JSON.stringify(idx, null, 2));
      }
    }
    return res.sendFile(file);
  } catch { return res.status(404).end(); }
});
// 整理历史重复素材（标题+作者相同只留最新）
app.post('/api/library/dedupe', (req, res) => {
  try { res.json(dedupeLibrary()); } catch (e) { res.status(500).json({ error: e.message }); }
});
// 按 id 批量删除素材（body: { ids: [...] }；必须显式提供至少一个 id，且单次上限保护）
app.post('/api/library/remove', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: '缺少要删除的 ids' });
    if (ids.length > 50) return res.status(400).json({ error: '单次删除数量过多' });
    res.json(removeLibraryNotes(ids));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 工作台进度（选题 / 分析 / 定稿 / 草稿）：写盘保存，刷新页面不丢
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
app.get('/api/progress', (req, res) => {
  try {
    res.json(fs.existsSync(PROGRESS_FILE) ? JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) : {});
  } catch { res.json({}); }
});
app.post('/api/progress', (req, res) => {
  try {
    const data = { ...(req.body || {}), updatedAt: Date.now() };
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true, updatedAt: data.updatedAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use('/api', configRoutes);
app.use('/api', researchRoutes);
app.use('/api', analysisRoutes);
app.use('/api', copyRoutes);
app.use('/api', publishRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, port: PORT }));

app.listen(PORT, settings.workbench?.host ?? '127.0.0.1', () => {
  console.log(`🔥 小红书创作工作台后端已启动: http://localhost:${PORT}`);
  console.log(`  - 文本/生图模型配置: ./config/models.json`);
  console.log(`  - 防风控与默认值: ./config/settings.json`);
  console.log(`  - 素材默认目录: ./data/library`);
});