import { Router } from 'express';
import { getModels, saveModels, maskApiKey, getSettings, saveSettings } from '../config.js';
import { isRiskStopped, resetRisk } from '../opencli.js';
import { listSkills } from '../skills.js';

const router = Router();

// 对外返回的 models 一律脱敏 apiKey（内部可用 getModels() 拿真实值）
const maskModels = (m) => {
  const text = m?.text || {};
  return { ...(m || {}), text: { ...text, apiKey: maskApiKey(text.apiKey) } };
};

router.get('/models', (req, res) => res.json(maskModels(getModels())));
router.post('/models', (req, res) => {
  try { saveModels(req.body); res.json(maskModels(getModels())); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/settings', (req, res) => res.json(getSettings()));
router.post('/settings', (req, res) => {
  try { res.json(saveSettings(req.body)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// 连通性自检：先试 /models 列模型，失败再退化为一条极短 chat 请求（不产生实际用量）
router.post('/models/test', async (req, res) => {
  const { baseURL, apiKey, model, kind } = req.body || {};
  const base = String(baseURL || '').trim().replace(/\/+$/, '');
  if (!base) return res.status(400).json({ ok: false, error: '缺少 BaseURL' });
  if (!/^https?:\/\//i.test(base)) return res.json({ ok: false, error: 'BaseURL 需以 http(s):// 开头' });

  const headers = { Authorization: `Bearer ${apiKey || ''}`, 'Content-Type': 'application/json' };
  try {
    const r = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(12000) });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      const list = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
      const names = list.map(m => m?.id || m?.name).filter(Boolean);
      return res.json({
        ok: true, via: 'models',
        count: names.length,
        sample: names.slice(0, 3),
        hasModel: model ? names.includes(model) : null
      });
    }
    if (r.status === 404 || r.status === 405 || r.status === 401) {
      // 部分网关不暴露 /models，用一条极短对话验证
      try {
        const c = await fetch(`${base}/chat/completions`, {
          method: 'POST', headers,
          body: JSON.stringify({ model: model || 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
          signal: AbortSignal.timeout(20000)
        });
        const cj = await c.json().catch(() => ({}));
        if (c.ok) return res.json({ ok: true, via: 'chat', count: 0, sample: [], hasModel: true });
        return res.json({ ok: false, error: cj?.error?.message || `HTTP ${c.status}` });
      } catch (e) {
        return res.json({ ok: false, error: e.message });
      }
    }
    return res.json({ ok: false, error: `HTTP ${r.status}` });
  } catch (e) {
    return res.json({ ok: false, error: e.message || '连接失败' });
  }
});

router.get('/skills', (req, res) => res.json(listSkills().map(s => ({ name: s.name, summary: s.summary }))));

router.get('/risk/status', (req, res) => res.json({ riskStopped: isRiskStopped() }));
router.post('/risk/reset', (req, res) => { resetRisk(); res.json({ riskStopped: false }); });

export default router;