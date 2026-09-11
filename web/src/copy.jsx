import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

function countChars(t) {
  const s = String(t || '').replace(/\s/g, '');
  return s.length;
}
function firstLine(t) {
  return String(t || '').split('\n').map(x => x.trim()).find(Boolean) || '';
}

export default function CopyPanel({ activeTopic, setActiveTopic, analysisExtra, analysisHook, onConfirmCopy, onCancelCopy, notify, drafts, setDrafts, confirmedId, setConfirmedId }) {
  const [topic, setTopic] = useState(activeTopic || '');
  const [instruction, setInstruction] = useState('');
  const [checkedSkills, setCheckedSkills] = useState(new Set());
  const [skillOptions, setSkillOptions] = useState({ pool: [], extras: [] });
  const [busy, setBusy] = useState(false);
  const [modelName, setModelName] = useState('模型');
  const [notes, setNotes] = useState([]);            // 素材库选项 [{id,title}]
  const [noteSel, setNoteSel] = useState([]);        // 已选对标笔记 id 列表（≤3）
  const [notesOpen, setNotesOpen] = useState(false); // 对标下拉是否展开
  const notePickerRef = useRef(null);

  // 点击下拉框外部任意位置（含框内空白）→ 收起
  useEffect(() => {
    if (!notesOpen) return;
    const onDocClick = (e) => {
      if (notePickerRef.current && !notePickerRef.current.contains(e.target)) {
        setNotesOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [notesOpen]);

  useEffect(() => {
    if (activeTopic) {
      const hookPart = analysisHook ? `（${analysisHook}）` : '';
      const extraPart = analysisExtra ? `\n\n${analysisExtra}` : ''; // 一+二+四 整段分析上下文
      setTopic(activeTopic + hookPart + extraPart);
    }
  }, [activeTopic, analysisHook, analysisExtra]);
  useEffect(() => {
    api.copySkills().then(s => setSkillOptions(s)).catch(() => {});
    api.getModels().then(m => setModelName(m?.text?.model || '模型')).catch(() => {});
    refreshNotes();
  }, []);

  // 素材库选项：挂载时拉一次，打开下拉时再同步一次，避免素材库更新后这里仍是空/旧数据
  const refreshNotes = () => {
    api.library().then(list => setNotes(list.map(n => ({ id: n.id, title: n.title })))).catch(() => {});
  };

  // 对标笔记多选切换：最多 3 篇
  const toggleNote = (id) => {
    setNoteSel(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 3) { notify('对标笔记最多选 3 篇', 'error'); return prev; }
      return [...prev, id];
    });
  };

  const toggleSkill = (name) => {
    setCheckedSkills(prev => {
      const n = new Set(prev);
      if (n.has(name)) { n.delete(name); return n; }
      if (n.size >= 3) { notify('最多勾选 3 个写稿策略（对应 3 个生成版本）', 'error'); return prev; }
      n.add(name);
      return n;
    });
  };

  const gen = async () => {
    const tk = topic.trim() || activeTopic.trim();
    if (!tk) { notify('请先选择或输入选题', 'error'); return; }
    const picked = [...checkedSkills];
    setBusy(true);
    setDrafts([]);
    setConfirmedId(null);
    if (picked.length === 0) notify('未勾选策略，将自动随机 3 个不同写稿策略生成…');
    else if (picked.length < 3) notify(`已选 ${picked.length} 个策略，剩余版本将随机复用或不用策略…`);
    try {
      // SSE 流式消费：后端顺序生成 3 版，每版完整无截断才推到前端（先完成先展示）
      const resp = await fetch('/api/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: tk, instruction, noteIds: noteSel.length ? noteSel : undefined, skills: picked.length ? picked : undefined })
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `生成失败 ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
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
          if (event === 'done') continue;
          if (payload && payload.id) {
            setDrafts(prev => (prev.some(d => d.id === payload.id) ? prev : [...prev, payload]));
          }
        }
      }
      notify('已生成 3 个版本，挑一个确认', 'success');
    } catch (e) {
      notify('生成失败：' + e.message, 'error');
    } finally { setBusy(false); }
  };

  const pick = (d) => {
    if (confirmedId === d.id) { onCancelCopy?.(); return; }   // 再次点击已确认的版本 → 取消确认
    setConfirmedId(d.id);
    onConfirmCopy(d.id, d.text);
  };

  const installed = [...(skillOptions?.pool || []), ...(skillOptions?.extras || [])].filter(s => s.installed);

  return (
    <div className="copy">
      {/* 第一行：选题注入（选题 + 钩子 + 落地配方 + 一/二段分析） */}
      <div className="field-hint">选题和爆款基因</div>
      <div className="row">
        <input value={topic} onChange={e => setTopic(e.target.value)}
          placeholder="选题内容（在「②」点选题会自动带入 选题+钩子+落地配方+分析）" style={{ flex: 1 }} />
      </div>

      {/* 第二行：对标笔记多选下拉 + 用户补充指令（相邻） */}
      <div className="row">
        <div className="note-picker" ref={notePickerRef}>
          <button className={`note-dropbtn ${noteSel.length ? 'on' : ''}`}
            onClick={() => { setNotesOpen(o => { if (!o) refreshNotes(); return !o; }); }} disabled={busy}>
            📎 对标笔记 {noteSel.length ? `（${noteSel.length}）` : '（可选）'} ▾
          </button>
          {notesOpen && (
            <div className="note-dropdown">
              <div className="note-drop-head">勾选素材库笔记作为对标（≤3，模拟其选题与表达）</div>
              {notes.length === 0 && <div className="note-drop-empty">素材库为空，先到「①」抓取素材</div>}
              <div className="note-drop-list">
                {notes.map(n => (
                  <label key={n.id} className={`note-opt ${noteSel.includes(n.id) ? 'on' : ''}`}
                    title={n.title}>
                    <input type="checkbox" checked={noteSel.includes(n.id)}
                      onChange={() => toggleNote(n.id)}
                      disabled={!noteSel.includes(n.id) && noteSel.length >= 3} />
                    <span>{n.title || '(无标题)'}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <input value={instruction} onChange={e => setInstruction(e.target.value)}
          placeholder="用户补充指令（语气 / 人设 / 想蹭的热点…）" style={{ flex: 1 }} />
      </div>

      <div className="skill-picker">
        <span>写稿策略（最多勾 3 个；不勾 = 自动随机 3 个不同策略）</span>
        <div className="skill-row">
          {installed.length > 0 ? (
            <div className="skill-chips">
              {installed.map(s => (
                <label key={s.name} className={`skill-chip ${checkedSkills.has(s.name) ? 'on' : ''}`} title={s.summary || s.name}>
                  <input type="checkbox" checked={checkedSkills.has(s.name)}
                    onChange={() => toggleSkill(s.name)}
                    disabled={!checkedSkills.has(s.name) && checkedSkills.size >= 3} />
                  {s.label || s.name}
                </label>
              ))}
            </div>
          ) : <span className="skill-empty">暂无已安装的写稿策略，将自动随机 3 个</span>}
          <button className="primary" onClick={gen} disabled={busy}>
            {busy ? '生成中…' : (drafts.length >= 3 ? '重新生成' : '生成 3 个版本')}
          </button>
        </div>
      </div>

      {(busy || drafts.length > 0) && (
        <div className="row">
          {busy
            ? <span className="panel-status"><span className="think-dot" /> {modelName} 正在创作中…</span>
            : <span className="panel-status">当前 {drafts.length} 个版本 · 确认后进入配图</span>}
        </div>
      )}

      {!busy && drafts.length === 0 && (
        <div className="empty-state">
          <b>还没有草稿</b>
          <span>{topic ? '点上面的「生成 3 个版本」出稿' : '先填入选题，或在「② 选题分析」里点一个选题带进来'}</span>
        </div>
      )}

      <div className="draft-grid">
        {drafts.map(d => {
          const st = confirmedId === d.id;
          return (
            <div key={d.id} className={`draft-card ${st ? 'confirmed' : ''}`}>
              <div className="draft-head">
                <span className="skill-tag">{d.skillLabel || d.skill}</span>
                <button className={st ? 'on tiny' : 'tiny'} onClick={() => pick(d)}
                  title={st ? '点击取消确认（可重新选）' : '确认此版并带入配图思路'}>
                  {st ? '已确认' : '确认此版'}
                </button>
              </div>
              <div className="draft-meta">
                <span>{firstLine(d.text).slice(0, 22) || '无标题'}</span>
                <span>{countChars(d.text)} 字</span>
              </div>
              <pre className="draft-body">{d.text}</pre>
            </div>
          );
        })}

        {busy && Array.from({ length: Math.max(0, 3 - drafts.length) }).map((_, i) => (
          <div className="draft-card" key={`sk-${i}`}>
            <div className="draft-head"><span className="skill-tag">生成中</span></div>
            <div className="skeleton">
              <div className="bar" style={{ width: '70%' }} />
              <div className="bar" style={{ width: '100%' }} />
              <div className="bar" style={{ width: '92%' }} />
              <div className="bar" style={{ width: '60%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
