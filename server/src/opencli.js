import { spawn } from 'child_process';
import { OPENCLI_NODE, OPENCLI_MAIN } from './paths.js';
import { getSettings } from './config.js';

// ---- 全局串行队列 + 随机间隔 + 风控停止 ----
let queue = Promise.resolve();
let riskStopped = false;
let lastRunAt = 0;

const makeDelay = (s) => {
  const { antiRisk } = s || {};
  const min = antiRisk?.minIntervalMs ?? 5000;
  const max = antiRisk?.maxIntervalMs ?? 20000;
  return min + Math.floor(Math.random() * (max - min));
};

function runOnce(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(OPENCLI_NODE, [OPENCLI_MAIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
  });
}

export function signalRisk(argsStr) {
  riskStopped = true;
  const msg = `[风控] 已触发安全限制信号（${argsStr ?? ''}）。已全体停止，需人工确认后重置。`;
  return msg;
}

export function resetRisk() {
  riskStopped = false;
}

export function isRiskStopped() {
  return riskStopped;
}

/**
 * 串行调用 opencli。每个请求前随机等待 5~20 秒，命中风控信号立即停止并抛错。
 */
export function opencli(args, { label = '' } = {}) {
  const task = queue.then(async () => {
    if (riskStopped) {
      throw new Error('风控已触发，已停止。请重置后再试。');
    }
    const settings = getSettings();
    // 等距随机：自上次运行起再延迟 5~20s
    const wait = makeDelay(settings);
    const since = Date.now() - lastRunAt;
    if (since < wait) {
      await new Promise(r => setTimeout(r, wait - since));
    }
    lastRunAt = Date.now();
    const res = await runOnce(args);
    const combined = (res.stdout + res.stderr);
    const risk = (settings.antiRisk?.riskKeywords || ['安全限制', '300017', '300031'])
      .find(k => combined.includes(k));
    if (risk) {
      signalRisk(label || args.join(' '));
      throw new Error(`风控信号[${risk}]：${label || args.join(' ')}`);
    }
    return res;
  }).catch(e => { throw e; });
  // 让队列继续串行（即使某个失败）
  queue = task.catch(() => {});
  return task;
}

/** 解析 opencli 的 -f json 输出 */
function parseJson(stdout) {
  const text = stdout.trim();
  if (!text) return [];
  try { return JSON.parse(text); }
  catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* ignore */ }
    }
    return null;
  }
}

export async function search({ keyword, limit = 30, sort }) {
  const args = ['xiaohongshu', 'search', keyword, '--limit', String(limit), '-f', 'json', '--site-session', 'persistent'];
  if (sort) args.push('--sort', sort);
  const res = await opencli(args, { label: `search:${keyword}` });
  const data = parseJson(res.stdout);
  if (data === null) throw new Error(`搜索解析失败：${res.stdout.slice(0, 300)}`);
  return data.map((n, i) => normalizeNote(n, i, keyword));
}

export async function fetchNote(url) {
  const res = await opencli(['xiaohongshu', 'note', url, '-f', 'json', '--site-session', 'persistent'], { label: `note:${url}` });
  let parsed;
  try { parsed = JSON.parse(res.stdout.trim()); } catch { parsed = null; }
  if (parsed === null) throw new Error(`笔记解析失败：${res.stdout.slice(0, 300)}`);
  // 详情返回为 [{field, value}, ...] 结构
  let obj = {};
  if (Array.isArray(parsed)) obj = Object.fromEntries(parsed.map(x => [x?.field, x?.value]));
  else if (parsed && typeof parsed === 'object') obj = parsed;
  return { ...normalizeNote(obj, 0, url), url, id: extractNoteId(url) || obj.id || '' };
}

/**
 * 下载笔记图片到本地目录（opencli download 接受完整 URL，输出到输出目录后返回占用）
 */
export async function downloadNoteImages(url, outputDir) {
  return opencli(['xiaohongshu', 'download', url, '--output', outputDir, '--site-session', 'persistent'], { label: `download:${url}` });
}

export function extractNoteId(url) {
  const m = String(url || '').match(/xiaohongshu\.com\/[^/?#]+\/([0-9a-f]{8,32})/);
  return m ? m[1] : '';
}

// ---- 归一化：点赞数校验、排序字段、图片 ----
function parseLikes(v) {
  if (v == null) return 0;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s === '赞' || s === 'like') return 0;
  const m = s.match(/^([0-9.]+)(万)?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return m[2] ? Math.round(n * 10000) : Math.round(n);
}

export function normalizeNote(raw, idx = 0, source = '') {
  const likes = parseLikes(raw.likes ?? raw.likes_num ?? raw.interact_info?.liked_count);
  return {
    index: idx,
    source,
    id: raw.id || raw.note_id || `${source}_${idx}`,
    title: raw.title || raw.display_title || '',
    author: raw.author || raw.nickname || raw.user?.nickname || '',
    content: raw.content || raw.desc || '',
    likes,
    collects: raw.collects === undefined ? (raw.interact_info?.collected_count ?? '') : raw.collects,
    comments: raw.comments === undefined ? (raw.interact_info?.comment_count ?? '') : raw.comments,
    published_at: raw.published_at || raw.time || '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [],
    images: Array.isArray(raw.image_list) ? raw.image_list.map(im => im.url || im.url_default || '').filter(Boolean) : [],
    url: raw.url || '',
    raw
  };
}