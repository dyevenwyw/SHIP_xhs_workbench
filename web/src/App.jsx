import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import ResearchPanel from './research.jsx';
import AnalysisPanel from './analysis.jsx';
import CopyPanel from './copy.jsx';
import ImagePanel from './image.jsx';
import ConfigModal from './config.jsx';
import './app.css';

const STORE_KEY = 'SHIP_xhs_workbench-progress-v1';

const SECTIONS = [
  { key: 'research', title: '调研' },
  { key: 'analysis', title: '选题' },
  { key: 'copy', title: '文案' },
  { key: 'image', title: '配图' }
];

export default function App() {
  const [library, setLibrary] = useState([]);
  const [selectedNotes, setSelectedNotes] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [activeTopic, setActiveTopic] = useState('');
  const [analysisExtra, setAnalysisExtra] = useState('');
  const [analysisHook, setAnalysisHook] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [confirmedId, setConfirmedId] = useState(null);
  const [confirmedCopy, setConfirmedCopy] = useState('');
  const [planCount, setPlanCount] = useState(0);
  const [risk, setRisk] = useState({ riskStopped: false });
  const [showConfig, setShowConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [phase, setPhase] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const refs = {
    research: useRef(null),
    analysis: useRef(null),
    copy: useRef(null),
    image: useRef(null)
  };

  const refreshLibrary = async () => {
    try { setLibrary(await api.library()); } catch {}
  };
  const refreshRisk = async () => {
    try { setRisk(await api.riskStatus()); } catch {}
  };

  const applyProgress = (s) => {
    if (!s) return;
    if (Array.isArray(s.selectedNotes)) setSelectedNotes(s.selectedNotes);
    if (s.analysis) setAnalysis(s.analysis);
    if (s.activeTopic) setActiveTopic(s.activeTopic);
    if (s.analysisExtra) setAnalysisExtra(s.analysisExtra);
    else if (s.analysisRecipe) setAnalysisExtra(s.analysisRecipe); // 兼容旧存档字段
    if (s.analysisHook) setAnalysisHook(s.analysisHook);
    if (Array.isArray(s.drafts)) setDrafts(s.drafts);
    if (s.confirmedId) setConfirmedId(s.confirmedId);
    if (s.confirmedCopy) setConfirmedCopy(s.confirmedCopy);
    if (typeof s.phase === 'number') setPhase(s.phase);
  };

  // 读取进度：本机缓存即时恢复，再以服务端存档为准（刷新 / 换标签页都不丢）
  useEffect(() => {
    let local = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        local = JSON.parse(raw);
        applyProgress(local);
      }
    } catch {}
    refreshLibrary();
    refreshRisk();
    api.getProgress().then(p => {
      if (p && Object.keys(p).length) {
        const serverNewer = !local || (p.updatedAt || 0) >= (local.savedAt || 0);
        if (serverNewer) { applyProgress(p); }
        setSavedAt(p.updatedAt || null);
      }
      setHydrated(true);
    }).catch(() => setHydrated(true));
  }, []);

  // 写入进度：浏览器缓存 + 服务端存档 data/progress.json
  useEffect(() => {
    if (!hydrated) return;
    const payload = {
      selectedNotes, analysis, activeTopic, analysisExtra, analysisHook, drafts, confirmedId, confirmedCopy, phase,
      savedAt: Date.now()
    };
    const t1 = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); } catch {}
    }, 400);
    const t2 = setTimeout(() => {
      api.saveProgress(payload).then(r => setSavedAt(r?.updatedAt || payload.savedAt)).catch(() => {});
    }, 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [hydrated, selectedNotes, analysis, activeTopic, drafts, confirmedId, confirmedCopy, phase]);

  // 长任务耗时计时
  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  const notify = (msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-2), { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), type === 'error' ? 8000 : 4200);
  };

  const setLoadingState = (v) => {
    if (typeof v === 'string') { setLoadingMsg(v); setLoading(true); }
    else { setLoading(!!v); if (!v) setLoadingMsg(''); }
  };

  const doneMap = [
    library.length > 0,
    !!analysis,
    !!confirmedCopy,
    planCount > 0
  ];

  const goPhase = (i) => {
    setPhase(i);
    const el = refs[SECTIONS[i].key].current;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleConfirmCopy = (draftId, text) => {
    setConfirmedCopy(text);
    setConfirmedId(draftId);
    setPhase(3);
    notify('文案已确认，已带入配图思路', 'success');
    requestAnimationFrame(() => {
      const el = refs.image.current;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleCancelCopy = () => {
    setConfirmedCopy('');
    setConfirmedId(null);
    setPhase(2);
    notify('已取消确认，可重新选择版本');
  };

  const resetProgress = () => {
    if (!window.confirm('清空本机保存的创作进度（选题、分析、文案）？素材库不会被删除。')) return;
    setSelectedNotes([]); setAnalysis(null); setActiveTopic(''); setAnalysisExtra(''); setAnalysisHook('');
    setDrafts([]); setConfirmedId(null); setConfirmedCopy(''); setPlanCount(0); setPhase(0);
    try { localStorage.removeItem(STORE_KEY); } catch {}
    api.saveProgress({ cleared: true }).then(() => setSavedAt(null)).catch(() => {});
    notify('已清空进度（本机与服务端存档均已清除）');
  };

  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v13" />
              <path d="M12 4.5l6.5 8.5H12z" />
              <path d="M3.5 16.5h17l-2 4h-13z" />
            </svg>
          </span>
          <span className="brand-name">SHIP·小红书辅助创作工作台</span>
        </div>
        <div className="topbar-mid">
          <nav className="mini-steps" aria-label="创作流程">
            {SECTIONS.map((s, i) => (
              <button key={s.key}
                className={`mini-step ${phase === i ? 'active' : ''} ${doneMap[i] ? 'done' : ''}`}
                onClick={() => goPhase(i)} title="点击定位到对应面板">
                <span className="idx">{doneMap[i] ? '✓' : i + 1}</span>
                {s.title}
              </button>
            ))}
          </nav>
          {savedAt && (
            <span className="save-badge" title="生成内容与进度已自动保存（服务端 + 浏览器缓存）">
              <span className="save-check">✓</span>
              {new Date(savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · 生成内容与进度已保存
            </span>
          )}
        </div>
        <div className="topbar-right">
          {risk.riskStopped && (
            <button className="risk-banner" onClick={() => setShowConfig(true)} title="点击打开配置并重置">
              风控已触发，抓取已停止 · 去重置
            </button>
          )}
          <button className="ghost" onClick={resetProgress} title="清空本机保存的进度">清空进度</button>
          <button onClick={() => setShowConfig(true)}>模型 / 防风控配置</button>
        </div>
      </header>

      <div className="result-bar concept-bar">
        <span className="concept-rule l" />
        <span className="concept-dot" />
        <span className="concept-text">用对标笔记一键生成你的笔记方案</span>
        <span className="concept-dot" />
        <span className="concept-rule r" />
      </div>

      <section className="panel" ref={refs.research}>
        <div className="panel-head">
          <span className="panel-num">1</span>
          <h2>调研 · 抓对标笔记进素材库</h2>
          <span className="spacer" />
          <span className="panel-status">💡可以多次抓取不同关键词累加素材</span>
        </div>
        <ResearchPanel
          selectedNotes={selectedNotes}
          setSelectedNotes={setSelectedNotes}
          library={library}
          onRefreshLibrary={refreshLibrary}
          setLoading={setLoadingState}
          notify={notify}
        />
      </section>

      <section className="panel" ref={refs.analysis}>
        <div className="panel-head">
          <span className="panel-num">2</span>
          <h2>选题分析 · 爆款基因与脑暴</h2>
          <span className="spacer" />
          <span className="panel-status">💡基于底层人性，多角度脑暴扩展选题</span>
        </div>
        <AnalysisPanel
          selectedNotes={selectedNotes}
          onAnalysis={a => { setAnalysis(a); setPhase(2); }}
          analysis={analysis}
          activeTopic={activeTopic}
          setActiveTopic={setActiveTopic}
          setAnalysisExtra={setAnalysisExtra}
          setAnalysisHook={setAnalysisHook}
          notify={notify}
        />
      </section>

      <section className="panel" ref={refs.copy}>
        <div className="panel-head">
          <span className="panel-num">3</span>
          <h2>文案生成 · 多策略出稿</h2>
          <span className="spacer" />
          <span className="panel-status">💡一键用多种文案skill出稿，生成版本对比</span>
        </div>
        <CopyPanel
          activeTopic={activeTopic}
          setActiveTopic={setActiveTopic}
          analysisExtra={analysisExtra}
          analysisHook={analysisHook}
          onConfirmCopy={handleConfirmCopy}
          onCancelCopy={handleCancelCopy}
          notify={notify}
          drafts={drafts}
          setDrafts={setDrafts}
          confirmedId={confirmedId}
          setConfirmedId={setConfirmedId}
        />
      </section>

      <section className="panel" ref={refs.image}>
        <div className="panel-head">
          <span className="panel-num">4</span>
          <h2>配图思路·多受众分析</h2>
          <span className="spacer" />
          <span className="panel-status">💡深度分析受众与调性</span>
        </div>
        <ImagePanel
          confirmedCopy={confirmedCopy}
          notify={notify}
          onResult={n => setPlanCount(n)}
        />
      </section>

      {showConfig && (
        <ConfigModal
          onClose={() => { setShowConfig(false); refreshRisk(); }}
          notify={notify}
        />
      )}

      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast-item ${t.type}`}>
            <span>{t.msg}</span>
            <button className="close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>

      {loading && (
        <div className="loading-mask">
          <div className="loading-card">
            <div className="spinner" />
            <div>{loadingMsg || '处理中…'}</div>
            <span className="elapsed">已等待 {mmss(elapsed)} · 抓取按 5-20 秒间隔串行执行，请保持页面打开</span>
          </div>
        </div>
      )}
    </div>
  );
}
