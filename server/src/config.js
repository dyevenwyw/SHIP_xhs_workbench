import fs from 'fs';
import { MODELS_FILE, SETTINGS_FILE } from './paths.js';

// 只保留文本模型配置（生图链路已移除，不再有 image 配置）
const DEFAULT_MODELS = {
  text: { baseURL: '', apiKey: '', model: '' }
};

const DEFAULT_SETTINGS = {
  antiRisk: {
    minIntervalMs: 5000,      // 串行 + 无序间隔 5~20 秒
    maxIntervalMs: 20000,
    stopOnRisk: true,         // 命中风控信号立即全体停止
    riskKeywords: ['安全限制', '300017', '300031']
  },
  defaults: {
    minLikes: 0,              // 最低点赞默认
    fetchCount: 30,           // 默认抓取数量
    sortByLikes: true,        // 默认按点赞降序
    includeOcr: true          // 默认抓取图片文本
  },
  workbench: {
    host: '127.0.0.1',
    serverPort: 3099,
    webPort: 5180
  }
};

function ensureFile(file, defaults) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaults, null, 2));
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

export function getModels() {
  ensureFile(MODELS_FILE, DEFAULT_MODELS);
  const m = readJson(MODELS_FILE);
  const base = m?.text || {};
  return {
    text: { ...DEFAULT_MODELS.text, ...base }
  };
}

// 仅暴露后 4 位，其余打码；key 过短则全量打码，不泄露任何字符
export function maskApiKey(key) {
  const k = String(key || '');
  if (!k) return '';
  if (k.length <= 4) return '****';
  return '****' + k.slice(-4);
}

// 客户端回传的 apiKey 若为脱敏占位（以 **** 开头），视为「未修改」
export function isMaskedApiKey(key) {
  return typeof key === 'string' && key.startsWith('****');
}

export function saveModels(models) {
  // 若回传的是脱敏占位符，保留磁盘上已有的真实 apiKey，避免被覆盖
  if (isMaskedApiKey(models?.text?.apiKey)) {
    const realKey = getModels().text.apiKey;
    models = { ...(models || {}), text: { ...(models?.text || {}), apiKey: realKey } };
  }
  fs.writeFileSync(MODELS_FILE, JSON.stringify(models, null, 2));
  return getModels();
}

export function getSettings() {
  ensureFile(SETTINGS_FILE, DEFAULT_SETTINGS);
  const s = readJson(SETTINGS_FILE);
  return { ...structuredClone(DEFAULT_SETTINGS), ...(s || {}), defaults: { ...DEFAULT_SETTINGS.defaults, ...(s?.defaults || {}) }, antiRisk: { ...DEFAULT_SETTINGS.antiRisk, ...(s?.antiRisk || {}) } };
}

export function saveSettings(settings) {
  const base = getSettings();
  const merged = {
    ...base, ...(settings || {}),
    defaults: { ...base.defaults, ...(settings?.defaults || {}) },
    antiRisk: { ...base.antiRisk, ...(settings?.antiRisk || {}) }
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  return getSettings();
}