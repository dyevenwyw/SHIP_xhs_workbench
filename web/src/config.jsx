import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const EMPTY_MODEL = { baseURL: '', apiKey: '', model: '' };

function ModelFields({ label, cfg, onChange, notify, onSave, saveLabel }) {
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const test = async () => {
    setTesting(true); setResult(null);
    try {
      const r = await api.testModels({ baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model });
      setResult(r);
      if (r.ok) {
        notify(`${label} 连接正常${r.count ? `，可访问 ${r.count} 个模型` : ''}${r.hasModel === false ? '（但填的模型名不在列表里）' : ''}`, r.hasModel === false ? 'info' : 'success');
      } else {
        notify(`${label} 连接失败：${r.error}`, 'error');
      }
    } catch (e) {
      setResult({ ok: false, error: e.message });
      notify(`${label} 测试失败：${e.message}`, 'error');
    } finally { setTesting(false); }
  };

  return (
    <div className="model-block">
      <h4>{label}</h4>
      <div className="col">
        <label>BaseURL
          <input value={cfg.baseURL} onChange={e => onChange({ ...cfg, baseURL: e.target.value })} placeholder="https://api.longcat.chat/openai/v1" />
        </label>
        <label>API Key
          <div className="secret-row">
            <input type={showKey ? 'text' : 'password'} value={cfg.apiKey} onChange={e => onChange({ ...cfg, apiKey: e.target.value })} placeholder="sk-..." />
            <button type="button" className="tiny" onClick={() => setShowKey(v => !v)}>{showKey ? '隐藏' : '显示'}</button>
          </div>
        </label>
        <label>模型名
          <input value={cfg.model} onChange={e => onChange({ ...cfg, model: e.target.value })} placeholder="如 LongCat-Flash-Chat / gpt-4o" />
        </label>
      </div>
      <div className="model-actions">
        {result && (
          <span className={`test-result ${result.ok ? 'ok' : 'bad'}`}>
            {result.ok
              ? `可用${result.count ? ` · ${result.count} 个模型${result.sample?.length ? `（如 ${result.sample.join('、')}）` : ''}` : ''}${result.hasModel === false ? ' · 模型名未匹配' : ''}`
              : `不可用 · ${result.error}`}
          </span>
        )}
        <span className="spacer" />
        <button className="tiny act-btn" onClick={test} disabled={testing}>{testing ? '测试中…' : '测试连接'}</button>
        <button className="tiny primary act-btn" onClick={onSave}>{saveLabel}</button>
      </div>
    </div>
  );
}

export default function ConfigModal({ onClose, notify }) {
  const [models, setModels] = useState({ text: { ...EMPTY_MODEL } });
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [settings, setSettings] = useState(null);
  const [risk, setRisk] = useState({ riskStopped: false });
  const cardRef = useRef(null);

  useEffect(() => {
    // 初值：服务端为准；若浏览器有未保存草稿则用草稿覆盖并标记
    api.getModels().then(m => {
      setModels({ text: { ...EMPTY_MODEL, ...(m?.text || {}) } });
    }).catch(() => {}).finally(() => setModelsLoaded(true));
    api.getSettings().then(s => setSettings(s)).catch(() => {});
    api.riskStatus().then(r => setRisk(r)).catch(() => {});
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 模型配置：本地编辑，点「保存模型配置」才写后端
  const changeModels = (t) => {
    if (!modelsLoaded) return;
    setModels({ text: t });
  };
  const saveModelsNow = async () => {
    try {
      const saved = await api.saveModels({ text: models.text });   // 只保存文本模型（生图配置已移除）
      setModels({ text: { ...EMPTY_MODEL, ...(saved?.text || {}) } });
      notify('保存成功', 'success');
    } catch (e) { notify('保存失败：' + e.message, 'error'); }
  };

  // 防风控配置：本地编辑，点「保存防风控配置」才写后端
  const changeSettings = (s) => {
    setSettings(s);
  };
  const saveSettingsNow = async () => {
    try {
      const saved = await api.saveSettings(settings);
      setSettings(saved);
      notify('保存成功', 'success');
    } catch (e) { notify('保存失败：' + e.message, 'error'); }
  };
  const resetRisk = async () => {
    const r = await api.riskReset();
    setRisk(r); notify('风控状态已重置，可以重新抓取', 'success');
  };

  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" ref={cardRef}>
        <div className="modal-head">
          <b>工作台配置</b>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>

        <div className="modal-body">
          {!modelsLoaded ? (
            <div className="cfg-section-hint">正在读取当前配置…</div>
          ) : (
            <ModelFields label="模型配置" cfg={models.text} onChange={changeModels} notify={notify} onSave={saveModelsNow} saveLabel="保存模型配置" />
          )}

          {settings && (
            <>
              <h4>调研抓取 · 防风控与默认值</h4>
              <div className="settings-grid">
                <label>最小间隔（秒）
                  <input type="number" value={settings.antiRisk.minIntervalMs / 1000} onChange={e => changeSettings({ ...settings, antiRisk: { ...settings.antiRisk, minIntervalMs: (+e.target.value || 0) * 1000 } })} />
                </label>
                <label>最大间隔（秒）
                  <input type="number" value={settings.antiRisk.maxIntervalMs / 1000} onChange={e => changeSettings({ ...settings, antiRisk: { ...settings.antiRisk, maxIntervalMs: (+e.target.value || 0) * 1000 } })} />
                </label>
                <label>默认抓取数
                  <input type="number" value={settings.defaults.fetchCount} onChange={e => changeSettings({ ...settings, defaults: { ...settings.defaults, fetchCount: +e.target.value } })} />
                </label>
                <label>最低点赞
                  <input type="number" value={settings.defaults.minLikes} onChange={e => changeSettings({ ...settings, defaults: { ...settings.defaults, minLikes: +e.target.value } })} />
                </label>
              </div>
              <div className="row">
                <label className="check"><input type="checkbox" checked={settings.antiRisk.stopOnRisk} onChange={e => changeSettings({ ...settings, antiRisk: { ...settings.antiRisk, stopOnRisk: e.target.checked } })} /> 命中风控立即停止抓取</label>
                <span style={{ flex: 1 }} />
                <button className="tiny primary" onClick={saveSettingsNow}>保存防风控配置</button>
              </div>

              <div className="risk-zone">
                <span>当前风控状态：{risk.riskStopped ? '已触发（抓取已停止）' : '正常'}</span>
                <button className="tiny" onClick={resetRisk} disabled={!risk.riskStopped}>重置风控状态</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
