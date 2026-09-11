import { useEffect, useState } from 'react';
import { api } from './api.js';

export default function ImagePanel({ confirmedCopy, notify, onResult }) {
  // 定稿文案注入输入框，可编辑后再分析（与 ③选题注入 同逻辑，保持不变）
  const [copyInput, setCopyInput] = useState(confirmedCopy || '');
  useEffect(() => { if (confirmedCopy) setCopyInput(confirmedCopy); }, [confirmedCopy]);

  const [instruction, setInstruction] = useState('');
  const [audiences, setAudiences] = useState([]);      // [{crowd, reason}]
  const [suggestions, setSuggestions] = useState([]);  // [{direction, imgType, scene, impl, post, why}]
  const [busy, setBusy] = useState(false);
  // 生成期间逐字累积的流式预览文本（done 事件到达后再提交结构化结果）
  const [streamText, setStreamText] = useState('');
  const [models, setModels] = useState(null);

  useEffect(() => { api.getModels().then(m => setModels(m)).catch(() => {}); }, []);

  const modelName = () => models?.text?.model || '文本模型';
  const hasCopy = !!(copyInput.trim() || (confirmedCopy || '').trim());

  // 只出配图思路（不出图）：受众分析 + 配图建议（SSE 流式）
  const run = async () => {
    const copy = copyInput.trim() || (confirmedCopy || '').trim();
    if (!copy) { notify('请先填入定稿文案，或在「③ 文案」确认一版', 'error'); return; }
    setBusy(true);
    setAudiences([]);
    setSuggestions([]);
    setStreamText('');
    notify('正在分析受众人群与配图方向…');
    try {
      const resp = await fetch('/api/image/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copy, instruction })
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `生成失败 ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalAudiences = null;
      let finalSuggestions = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message';
          let dataLine = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          let payload;
          try { payload = JSON.parse(dataLine); } catch { continue; }
          if (event === 'error') throw new Error(payload.error || '生成出错');
          if (event === 'done') { finalAudiences = payload.audiences; finalSuggestions = payload.suggestions; continue; }
          if (payload && payload.delta) setStreamText(prev => prev + payload.delta);
        }
      }
      const aList = finalAudiences || [];
      const sList = finalSuggestions || [];
      setAudiences(aList);
      setSuggestions(sList);
      onResult?.(sList.length);
      if (sList.length) notify(`已生成 ${sList.length} 条配图建议`, 'success');
      else notify('未生成配图建议，请重试', 'error');
    } catch (e) {
      notify('生成失败：' + e.message, 'error');
    } finally { setBusy(false); setStreamText(''); }
  };

  return (
    <div className="image">
      {/* 第一行：定稿文案（可编辑；来自 ③ 确认，可改后再生成） */}
      <div className="field-hint">定稿文案（来自 ③ 确认；可编辑，配图思路将按此生成）</div>
      <div className="row">
        <textarea className="img-copy-input" value={copyInput}
          onChange={e => setCopyInput(e.target.value)}
          placeholder="在此输入 / 粘贴要配图的文案…（含标题、正文、话题标签）" rows={4} />
      </div>

      <div className="row">
        <input value={instruction} onChange={e => setInstruction(e.target.value)}
          placeholder="风格偏好（可选：干净通透 / 抽象无厘头 / 手写笔记…）" style={{ flex: 1 }} />
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? '分析中…' : '生成配图思路'}
        </button>
      </div>

      {busy && (
        <div className="row" style={{ marginTop: -6 }}>
          <span className="panel-status"><span className="think-dot" /> {modelName()} 正在分析受众人群与配图方向…</span>
        </div>
      )}

      {!hasCopy && !busy && (
        <div className="empty-state">
          <b>还没有可分析的文案</b>
          <span>在上面粘贴文案，或先回到「③ 文案」确认一版（会自动带入这里，可继续编辑）。</span>
        </div>
      )}

      {busy && streamText && (
        <div className="plan-list">
          <pre className="stream-preview">{streamText}</pre>
        </div>
      )}

      {busy && !streamText && audiences.length === 0 && (
        <div className="suggest-list">
          {[0, 1].map(i => (
            <div className="suggest-item" key={i}>
              <div className="skeleton">
                <div className="bar" style={{ height: 16, width: '40%' }} />
                <div className="bar" style={{ height: 12, width: '92%' }} />
                <div className="bar" style={{ height: 12, width: '72%' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {(audiences.length > 0 || suggestions.length > 0) && (
        <div className="image-result">
          {audiences.length > 0 && (
            <div className="audience-block">
              <div className="audience-head">受众分析</div>
              <div className="audience-list">
                {audiences.map((a, i) => (
                  <div className="audience-item" key={i}>
                    <div className="audience-crowd">{a.crowd || '受众人群'}</div>
                    {a.reason && <p className="audience-reason">{a.reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="suggest-block">
              <div className="audience-head">配图建议</div>
              <div className="suggest-list">
                {suggestions.map((s, i) => (
                  <div className="suggest-item" key={i}>
                    <div className="suggest-h">
                      <span className={`suggest-badge ${s.direction === '实拍' ? 'shot' : 'gen'}`}>{s.direction || '建议'}</span>
                      {s.imgType && <span className="suggest-type">{s.imgType}</span>}
                    </div>
                    {s.scene && <p className="plan-prose">{s.scene}</p>}
                    {s.why && <p className="suggest-why">{s.why}</p>}
                    {(s.impl || s.post) && (
                      <div className="plan-type">
                        <div className="plan-type-meta">
                          {s.impl && <span>实现：{s.impl}</span>}
                          {s.post && <span>后期：{s.post}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
