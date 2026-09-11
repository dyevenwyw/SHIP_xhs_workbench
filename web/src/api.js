const BASE = '/api';

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败 ${res.status}`);
    err.risk = !!data.risk;
    err.riskStopped = !!data.riskStopped;
    throw err;
  }
  return data;
}

export const api = {
  // 配置
  getModels: () => req('GET', '/models'),
  saveModels: (m) => req('POST', '/models', m),
  testModels: (p) => req('POST', '/models/test', p),
  getSettings: () => req('GET', '/settings'),
  saveSettings: (s) => req('POST', '/settings', s),
  listSkills: () => req('GET', '/skills'),
  riskStatus: () => req('GET', '/risk/status'),
  riskReset: () => req('POST', '/risk/reset'),

  // 素材库
  library: () => req('GET', '/library'),
  libraryNote: (id) => req('GET', `/library/${id}`),
  removeLibraryNotes: (ids) => req('POST', '/library/remove', { ids }),

  // 调研
  research: (payload) => req('POST', '/research', payload),
  researchLink: (payload) => req('POST', '/research/link', payload),
  refetchNote: (id, forceReadonly = false) => req('POST', '/research/refetch', { id, forceReadonly }),

  // 文案
  copySkills: () => req('GET', '/copy/skills'),
  genCopy: (payload) => req('POST', '/copy', payload),

  // 工作台进度（服务端持久化，刷新不丢）
  getProgress: () => req('GET', '/progress'),
  saveProgress: (p) => req('POST', '/progress', p),

  // 素材去重整理
  dedupeLibrary: () => req('POST', '/library/dedupe')
};