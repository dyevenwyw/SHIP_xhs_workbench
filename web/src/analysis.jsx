import { useEffect, useState } from 'react';
import { api } from './api.js';

const SECTION_EMOJI = { '一': '🔥', '二': '🪝', '三': '💡', '四': '🍳', '五': '📌' };

export default function AnalysisPanel({ selectedNotes, onAnalysis, analysis, activeTopic, setActiveTopic, setAnalysisExtra, setAnalysisHook, notify }) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  // 生成期间逐字累积的流式预览文本（done 事件到达后再提交结构化结果）
  const [streamText, setStreamText] = useState('');
  // 思考态展示当前文本模型名（供「…正在深度思考」提示）
  const [modelName, setModelName] = useState('');

  useEffect(() => {
    api.getModels()
      .then(m => setModelName(m?.text?.model || '模型'))
      .catch(() => setModelName('模型'));
  }, []);

  const run = async () => {
    if (!selectedNotes.length) { notify('请先在调研结果里勾选素材'); return; }
    setBusy(true); setStreamText('');
    notify(`正在分析 ${selectedNotes.length} 篇素材的爆款基因…`);
    try {
      // SSE 流式消费（与 copy.jsx 同一套 reader 解析）：逐字累积预览，done 事件再提交结构化结果
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteIds: selectedNotes, instruction })
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `分析失败 ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalResult = null;
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
          if (event === 'error') throw new Error(payload.error || '分析出错');
          if (event === 'done') { finalResult = payload; continue; }
          if (payload && payload.delta) setStreamText(prev => prev + payload.delta);
        }
      }
      if (finalResult) {
        onAnalysis(finalResult);
        notify('✅ 爆款内核分析完成');
      } else {
        notify('分析未完成', 'error');
      }
    } catch (e) { notify('分析失败：' + e.message); }
    finally { setBusy(false); setStreamText(''); }
  };

  // 建议选题解析：只认「选题1、2、3…」编号开头的行，选题正文取「」内的内容（不含钩子）。
  // 格式：选题X：「建议选题内容」（钩子）。钩子单独留存，点选题时再拼回注入文案框（round17）。
  const parseTopics = (text = '') => {
    if (!text) return [];
    const out = [];
    text.split('\n')
      .map(l => l.replace(/^[-*•>·•‣◦]+\s*/, '').replace(/^\d+\s*[.、)）]\s*/, '').trim())
      .forEach(l => {
        const m = l.match(/^选题\s*[0-9０-９一二三四五六七八九十]+\s*[:：、.．)）]?\s*/);
        if (!m) return;
        const body = l.slice(m[0].length).trim();
        let title = '';
        let rest = body;
        const bt = body.match(/^「\s*([^」]*?)\s*」/);
        if (bt) { title = bt[1].trim(); rest = body.slice(bt[0].length).trim(); }
        else { title = body.replace(/\s*[（(][^（）()]*[)）]\s*$/, '').trim(); rest = ''; }
        if (!title) return;
        const hm = rest.match(/[（(]\s*([^（）()]*?)\s*[)）]/);
        out.push({ title, hook: hm ? hm[1].trim() : '' });
      });
    return out.slice(0, 20);
  };

  // 章节解析：按「X、标题」抓取整段正文（兼容模型自带 emoji / 「#」/ 列表前缀）
  const extractSection = (text = '', cnNum) => {
    if (!text) return '';
    const re = new RegExp(
      `(?:^|\\n)[ \\t]*(?:[-*•·‣◦])?\\s*(?:[🔥🪝💡🍳📌])?\\s*${cnNum}、[^\\n]*\\n([\\s\\S]*?)(?=(?:\\n[ \\t]*(?:[-*•·‣◦])?\\s*(?:[🔥🪝💡🍳📌])?\\s*[一二三四五六七八九十]+、)|$)`,
      ''
    );
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };
  const topicItems = analysis ? parseTopics(analysis.result) : [];
  const topicLines = topicItems.map(it => it.title); // 选题选择框只显示标题（不含钩子）
  const fire = analysis ? extractSection(analysis.result, '一') : '';    // 一、什么会火
  const logic = analysis ? extractSection(analysis.result, '二') : '';   // 二、底层逻辑
  const recipe = analysis ? extractSection(analysis.result, '四') : '';  // 四、落地配方

  // 「三、建议选题」正文已由下方选题按钮呈现，正文逐行渲染时跳过该段，避免重复展示
  const resultLines = analysis ? analysis.result.split('\n') : [];
  const secHead = (line) => {
    const m = line.replace(/\*/g, '').match(/^\s*#?\s*[🔥🪝💡🍳📌]?\s*([一二三四五六七八九十]+)、(.*)$/);
    return m ? { num: m[1], title: m[2] } : null;
  };
  let skipFrom = -1, skipTo = resultLines.length;
  resultLines.forEach((line, i) => {
    const h = secHead(line);
    if (h && (h.num === '三' || /建议选题/.test(h.title)) && skipFrom < 0) skipFrom = i;
    else if (h && skipFrom >= 0 && skipTo === resultLines.length) skipTo = i;
  });
  // 兜底：正文里若还有漏网的「选题N：…」行，也一并跳过（已由 chips 展示）
  const isTopicLine = (line) => /^选题\s*[0-9０-９一二三四五六七八九十]+\s*[:：、.．)）]?\s*/.test(
    line.replace(/^[-*•>·•‣◦]+\s*/, '').replace(/^\d+\s*[.、)）]\s*/, '').trim()
  );

  // 注入文案框的「分析上下文」：一+二+四 三段全部带上（用户要求整段分析作为文案上下文）
  const analysisExtra = [fire && `【一、什么会火】\n${fire}`, logic && `【二、底层逻辑】\n${logic}`, recipe && `【四、落地配方】\n${recipe}`]
    .filter(Boolean).join('\n\n');

  const isPick = (t) => !!(activeTopic && String(activeTopic).trim() === String(t).trim());
  const chipCls = (t) => `topic-chip${isPick(t) ? ' picked' : ''}`;

  // 点击设为当前选题；再次点击同一选题则取消。同时把「钩子 + 一/二/四 分析上下文」一并带入文案输入框。
  const pickTopic = (t) => {
    const it = topicItems.find(x => x.title === t);
    if (isPick(t)) {
      setActiveTopic('');
      setAnalysisHook('');
      setAnalysisExtra('');
      notify('已取消当前选题');
      return;
    }
    setActiveTopic(t);
    setAnalysisHook(it ? it.hook : '');
    setAnalysisExtra(analysisExtra);
    notify('✅ 已设为当前选题 → 自动带入「③ 文案」输入框（含钩子 + 一/二/四 分析上下文，可自由编辑）');
  };

  return (
    <div className="analysis">
      {selectedNotes.length === 0 && !analysis && (
        <div className="empty-state">
          <b>还没有选中素材</b>
          <span>回到「① 调研」，在结果或素材库里勾选几篇对标笔记（建议 3-8 篇），再回来点「分析并脑暴选题」。</span>
        </div>
      )}

      <div className="row">
        <span>已选素材 {selectedNotes.length} 篇</span>
        <input value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="补充分析指令（可选）：如『我的账号是XX方向，帮我针对性扩展』" style={{ flex: 1 }} />
        <button className="primary" onClick={run} disabled={busy}>{busy ? '分析中' : '分析并脑暴选题'}</button>
      </div>

      {busy && (
        <div className="thinking-line" aria-live="polite">
          <span className="think-dot" />
          <span className="think-text">{modelName} 正在深度思考…</span>
        </div>
      )}

      {analysis && !busy && (
        <div className="analysis-result">
          <div className="markdown-body">
            {resultLines.map((line, i) => {
              if (skipFrom >= 0 && i >= skipFrom && i < skipTo) return null;   // 跳过「三、建议选题」段
              if (isTopicLine(line)) return null;                              // 兜底跳过选题行
              const clean = line.replace(/\*/g, '');
              const sec = clean.match(/^\s*#?\s*[🔥🪝💡🍳📌]?\s*([一二三四五六七八九十]+)、(.*)$/);
              if (sec) return <h3 key={i}>{SECTION_EMOJI[sec[1]] || ''} {sec[1]}、{sec[2]}</h3>;
              if (clean.startsWith('#')) return <h3 key={i}>{clean.replace(/^#+\s*/, '')}</h3>;
              if (clean.startsWith('**') && /\.$/.test(clean)) return <Separator key={i} line={clean} />;
              return <p key={i} className={clean.trim() === '' ? 'empty' : ''}>{clean}</p>;
            })}
          </div>

          {topicLines.length > 0 && (
            <div className="topic-block">
              <h4>建议选题（点击设为当前选题）</h4>
              <div className="topic-list">
                {topicLines.map((t, i) => (
                  <button key={i} className={chipCls(t)} onClick={() => pickTopic(t)} title={t}>{t.slice(0, 40)}{isPick(t) && ' ✓'}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {busy && streamText && (
        <div className="analysis-result">
          <pre className="stream-preview">{streamText}</pre>
        </div>
      )}
    </div>
  );
}

function Separator({ line }) { return <p className="sep"><strong>{line.replace(/\*\*/g, '')}</strong></p>; }
