import { useState } from 'react';
import { api } from './api.js';

// 单张素材/结果卡片，可展开查看正文 + OCR。
// 整个卡片可点击展开/收起；勾选框与详情区内的按钮各自 stopPropagation，互不干扰。
function NoteCard({ entry, ocr, isOpen, detail, loading, onToggleExpand, onToggleSelect, selected, onRefetch, onRefetchReadonly, refetching, refetchingReadonly, dup, replaced }) {
  const ocrArr = detail?._ocr || ocr || [];
  const ocrCount = Array.isArray(ocrArr) ? ocrArr.length : 0;
  // 素材本身带 OCR 即展示（详情未加载时不显示数量，避免误导）
  const hasOcr = !!(entry?.hasOcr || ocrCount > 0);
  // 展开标签：有图片文字显示「🖼 图片文字(n)」；无 OCR 的笔记也给出「📝 展开正文」标签，
  // 让用户知道整卡可点击展开查看正文（之前无 OCR 笔记没有该提示，易误以为不能展开）。
  const expandLabel = hasOcr ? `🖼 图片文字${ocrCount > 0 ? `(${ocrCount})` : ''}` : '📝 展开正文';
  const title = entry?.title || detail?.title || '(无标题)';
  const likes = entry?.likes;
  const author = entry?.author || '';
  const keyword = entry?.batchTag || entry?.source || '';
  return (
    <div className={`note-card ${selected ? 'sel' : ''} ${isOpen ? 'open' : ''} ${dup ? 'dup' : ''}`}
      onClick={onToggleExpand} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpand(); } }}>
      <div className="note-head">
        <label className="check" onClick={e => onToggleSelect?.(e)}>
          <input type="checkbox" checked={selected} onChange={() => {}} readOnly />
        </label>
        <div className="note-info">
          {/* 标题默认占 2 行，超长省略 */}
          <div className="note-title">{title}</div>
          {/* 作者占一行 */}
          <div className="note-author">
            {author || '未知作者'}
            {dup && <span className="dup-tag">{replaced ? '已更新' : '历史重复'}</span>}
          </div>
          {/* 点赞 + 关键词占一行 */}
          <div className="note-meta">
            {likes !== undefined && <span className="likes">👍 {likes}</span>}
            {keyword && <span className="kw" title={keyword}>{keyword}</span>}
          </div>
          {/* 「展开」独立一行，位于信息流最底部；箭头随展开翻转，整卡点击展开/收起。
              有 OCR 显示图片文字标签，无 OCR 显示「📝 展开正文」，都提示可点开看正文。 */}
          <div className="note-ocr-line">
            <span className="ocr-tag">{expandLabel}<i className="ocr-caret">{isOpen ? '▲' : '▼'}</i></span>
          </div>
        </div>
      </div>
      {isOpen && (
        <div className="note-detail" onClick={e => e.stopPropagation()}>
          {loading && <div className="dim">加载详情…</div>}
          {detail && (
            <>
              <div className="d-sec">
                <div className="d-label">正文</div>
                {detail.content ? (
                  <div className="d-text">{detail.content}</div>
                ) : (
                  <div>
                    <div className="d-empty">⚠️ 未获取到正文。该条源自关键词搜索列表，顺带可用下方任一方式补抓。</div>
                    <div className="d-actions">
                      {onRefetch && (
                        <button className="link-btn" onClick={e => { e.stopPropagation(); onRefetch(); }} disabled={refetching}>
                          {refetching ? '补抓中…' : '🔄 opencli补抓'}
                        </button>
                      )}
                      {onRefetchReadonly && (
                        <button className="link-btn ghost" onClick={e => { e.stopPropagation(); onRefetchReadonly(); }} disabled={refetchingReadonly}>
                          {refetchingReadonly ? '解析中…' : '📎 只读解析'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {ocrArr.length > 0 && (
                <div className="d-sec">
                  <div className="d-label">图片上的文字(OCR)</div>
                  {ocrArr.map((im, i) => (
                    <div key={i} className="ocr-line">
                      <span className="ocr-file">{im.file}</span>
                      <span className="ocr-text">{String(im.text).replace(/\n/g, ' / ') || '[无文字]'}</span>
                    </div>
                  ))}
                </div>
              )}
              {detail.url && <a className="d-link" href={detail.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>查看原文 ↗</a>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ResearchPanel({ selectedNotes, setSelectedNotes, library, onRefreshLibrary, setLoading, notify }) {
  const [mode, setMode] = useState('search'); // search | link
  const [keyword, setKeyword] = useState('');
  const [minLikes, setMinLikes] = useState(0);
  const [count, setCount] = useState(30);
  const [doOcr, setDoOcr] = useState(true);
  const [linkUrl, setLinkUrl] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  // 展开详情
  const [expanded, setExpanded] = useState(new Set());
  const [detailMap, setDetailMap] = useState({});
  const [loadingDetail, setLoadingDetail] = useState(null);
  // 素材库整体折叠状态
  const [libOpen, setLibOpen] = useState(true);
  const [refetching, setRefetching] = useState(null);
  const [refetchingRo, setRefetchingRo] = useState(null);

  const toggleSelect = (id, e) => {
    e?.stopPropagation();
    setSelectedNotes(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleExpand = async (r) => {
    const id = r.id;
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    // 未加载过详情则拉取（正文 + 图片OCR）
    if (!detailMap[id] && r?.entry) {
      setLoadingDetail(id);
      try { const d = await api.libraryNote(id); setDetailMap(prev => ({ ...prev, [id]: d })); }
      catch (e) { notify('加载详情失败：' + e.message); }
      finally { setLoadingDetail(null); }
    }
  };

  // 素材库内已勾选（与分析共用 selectedNotes）
  const libCheckedIds = library.filter(it => selectedNotes.includes(it.id)).map(it => it.id);
  const allLibChecked = library.length > 0 && libCheckedIds.length === library.length;

  // 全选 / 取消全选素材库
  const toggleLibSelectAll = (e) => {
    e.stopPropagation();
    const allIds = library.map(it => it.id);
    setSelectedNotes(prev => allLibChecked ? prev.filter(id => !allIds.includes(id)) : [...new Set([...prev, ...allIds])]);
  };

  // 删除所选素材（替换原「清空所有素材」）
  const deleteSelected = async () => {
    const ids = libCheckedIds;
    if (!ids.length) { notify('请先勾选要删除的素材', 'error'); return; }
    if (!window.confirm(`确定删除所选 ${ids.length} 条素材？笔记、图片、OCR 都会被删除，且不可恢复。`)) return;
    setLoading('正在删除所选素材…');
    try {
      const r = await api.removeLibraryNotes(ids);
      // 同步清掉本轮搜索结果里对应的卡片
      setResult(prev => prev ? { ...prev, notes: (prev.notes || []).filter(n => !ids.includes(n.id)) } : prev);
      setSelectedNotes(prev => prev.filter(id => !ids.includes(id)));
      const dmap = { ...detailMap }; ids.forEach(id => delete dmap[id]); setDetailMap(dmap);
      const ex = new Set(expanded); ids.forEach(id => ex.delete(id)); setExpanded(ex);
      await onRefreshLibrary();
      notify(`✅ 已删除 ${r.removed} 条素材`, 'success');
    } catch (e) { notify('删除失败：' + e.message, 'error'); }
    finally { setLoading(false); }
  };

  const runSearch = async () => {
    if (!keyword.trim()) { notify('请输入关键词'); return; }
    setErr(''); setResult(null); setLoading(`正在抓取「${keyword}」…`); notify(`正在搜索「${keyword}」… 将按 5-20s 无序间隔串行抓取 ${count} 条`);
    try {
      const data = await api.research({ keyword: keyword.trim(), minLikes, count, includeOcr: doOcr });
      setResult(data);
      await onRefreshLibrary();
      notify(`✅ 抓取完成：共 ${data.total_fetched} 条，命中(≥${minLikes}赞) ${data.kept} 条 → 新增 ${data.new_count}、与历史重复 ${data.dup_count}`);
    } catch (e) {
      setErr(e.message);
      if (e.riskStopped) notify('⚠️ 风控已触发并停止！请到配置页手动重置后再试');
    } finally { setLoading(false); }
  };

  const runLink = async () => {
    if (!linkUrl.trim()) { notify('请粘贴对标笔记链接'); return; }
    setErr(''); setResult(null); setLoading('正在抓取对标笔记…'); notify('正在抓取对标笔记…');
    try {
      const data = await api.researchLink({ url: linkUrl.trim(), includeOcr: doOcr });
      setResult({ linkMode: true, notes: [data.added] });
      await onRefreshLibrary();
      notify('✅ 对标笔记已进素材库');
    } catch (e) {
      setErr(e.message);
      if (e.riskStopped) notify('⚠️ 风控已触发并停止！请重置');
    } finally { setLoading(false); }
  };

  const displayNotes = result ? (result.notes || []) : [];

  // 历史遗留重复（标题 + 作者相同）
  const dupCount = (() => {
    const seen = new Set();
    let n = 0;
    for (const it of library) {
      const t = String(it.title || '').replace(/\s|　/g, '');
      if (!t) continue;
      const k = `${t}|${String(it.author || '').replace(/\s|　/g, '')}`;
      if (seen.has(k)) n++; else seen.add(k);
    }
    return n;
  })();

  const runDedupe = async () => {
    if (!window.confirm(`检测到 ${dupCount} 条重复素材（标题与作者相同）。整理后会保留最新的一条，其余连同图片一起删除，确定继续？`)) return;
    setLoading('正在整理重复素材…');
    try {
      const r = await api.dedupeLibrary();
      await onRefreshLibrary();
      notify(`已整理：删除 ${r.removed} 条重复素材，现有 ${r.total} 条`, 'success');
    } catch (e) { notify('整理失败：' + e.message, 'error'); }
    finally { setLoading(false); }
  };

  // 点击素材库卡片展开 / 收起
  const toggleLibExpand = (id) => {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    if (!detailMap[id]) {
      setLoadingDetail(id);
      api.libraryNote(id)
        .then(d => setDetailMap(prev => ({ ...prev, [id]: d })))
        .catch(e => notify('加载详情失败：' + e.message))
        .finally(() => setLoadingDetail(null));
    }
  };

  const renderRoundNote = (r) => (
    <NoteCard
      key={r.id}
      entry={r.entry}
      ocr={r.ocr}
      dup={r.isNew === false}
      replaced={r.replaced}
      selected={selectedNotes.includes(r.id)}
      isOpen={expanded.has(r.id)}
      detail={detailMap[r.id]}
      loading={loadingDetail === r.id}
      onToggleExpand={() => toggleExpand(r)}
      onToggleSelect={e => toggleSelect(r.id, e)}
      onRefetch={() => doRefetch(r.id)}
      refetching={refetching === r.id}
      onRefetchReadonly={() => doRefetchRo(r.id)}
      refetchingReadonly={refetchingRo === r.id}
    />
  );

  // 只读方式补抓正文（匿名、无态，不消耗登录态/风控配额）
  const doRefetchRo = async (id) => {
    if (refetchingRo) return;
    setRefetchingRo(id);
    try {
      const d = await api.refetchNote(id, true);
      setDetailMap(prev => ({ ...prev, [id]: null }));
      if (d.refetched) {
        const fresh = await api.libraryNote(id).catch(() => null);
        if (fresh) setDetailMap(prev => ({ ...prev, [id]: fresh }));
        else setDetailMap(prev => ({ ...prev, [id]: { ...(prev[id] || {}), content: d.content } }));
        onRefreshLibrary();
        notify('✅ 只读解析已补抓正文');
      } else {
        notify('⚠️ 只读解析未成功：' + (d.reason || ''));
      }
    } catch (e) {
      notify('只读解析失败：' + e.message);
      if (e.riskStopped) notify('⚠️ 风控已触发并停止，请到配置页重置');
    } finally { setRefetchingRo(null); }
  };

  // 补抓正文：主=opencli，备=只读链接解析；成功刷新详情并通知素材库刷新
  const doRefetch = async (id, forceReadonly = false) => {
    if (refetching) return;
    setRefetching(id);
    try {
      const d = await api.refetchNote(id, forceReadonly);
      setDetailMap(prev => ({ ...prev, [id]: null }));
      if (d.refetched) {
        const fresh = await api.libraryNote(id).catch(() => null);
        if (fresh) setDetailMap(prev => ({ ...prev, [id]: fresh }));
        else setDetailMap(prev => ({ ...prev, [id]: { ...(prev[id] || {}), content: d.content } }));
        onRefreshLibrary();
        notify(`✅ 已补抓正文（${d.channel === 'readonly' ? '只读解析' : 'opencli'}）`);
      } else {
        notify(`⚠️ 补抓未成功：${d.reason || ''}${d.channel !== 'none' ? '' : '；可改用只读方式'}`);
      }
    } catch (e) {
      notify('补抓失败：' + e.message);
      if (e.riskStopped) notify('⚠️ 风控已触发并停止，请到配置页重置（可改用只读方式补抓）');
    } finally { setRefetching(null); }
  };

  const renderLibNote = (it) => {
    const id = it.id;
    return (
      <NoteCard
        key={id}
        entry={it}
        selected={selectedNotes.includes(id)}
        isOpen={expanded.has(id)}
        detail={detailMap[id]}
        loading={loadingDetail === id}
        onToggleExpand={() => toggleLibExpand(id)}
        onToggleSelect={e => toggleSelect(id, e)}
        onRefetch={() => doRefetch(id)}
        refetching={refetching === id}
        onRefetchReadonly={() => doRefetchRo(id)}
        refetchingReadonly={refetchingRo === id}
      />
    );
  };

  return (
    <div className="research">
      <div className="tabs">
        <button className={mode === 'search' ? 'on' : ''} onClick={() => setMode('search')}>关键词调研</button>
        <button className={mode === 'link' ? 'on' : ''} onClick={() => setMode('link')}>对标链接抓取</button>
      </div>

      {mode === 'search' && (
        <div className="filters">
          <div className="field filter-wide">
            <label className="f-label">对标内容关键词</label>
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="想在小红书搜索的对标内容，如养生、变美、AI…" />
          </div>
          <div className="field">
            <label className="f-label">点赞数 ≥</label>
            <input type="number" value={minLikes} onChange={e => setMinLikes(+e.target.value)} />
            <span className="hint">低于该赞数的笔记会被过滤掉，不收录</span>
          </div>
          <div className="field">
            <label className="f-label">抓取数量</label>
            <input type="number" value={count} onChange={e => setCount(+e.target.value)} />
            <span className="hint">本轮抓点赞最高的前 N 条；不删历史素材，重复自动去重</span>
          </div>
          <div className="field filter-wide checkbox-field">
            <label className="check"><input type="checkbox" checked={doOcr} onChange={e => setDoOcr(e.target.checked)} /> 识别图片文字(OCR)</label>
            <button className="primary" onClick={runSearch}>开始调研</button>
          </div>
        </div>
      )}

      {mode === 'link' && (
        <div className="row">
          <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="粘贴 xiaohongshu.com 笔记链接" style={{ flex: 1 }} />
          <button className="primary" onClick={runLink}>抓取入素材库</button>
          <label className="check"><input type="checkbox" checked={doOcr} onChange={e => setDoOcr(e.target.checked)} /> 识别图片文字</label>
        </div>
      )}

      {err && <div className="err">{err}</div>}

      {result && (
        <div className="result-bar">
          <span>本轮抓取 {result.total_fetched ?? '单篇'} 条，命中(≥{result.minLikes}赞) {result.kept ?? result.notes?.length} 条</span>
          <span className="bar-new">🆕 新增 {result.new_count ?? result.notes?.filter(n => n.isNew !== false).length ?? 0} 条</span>
          {result.dup_count > 0 && <span className="bar-dup">其中 {result.dup_count} 条已存在，已用最新内容替换</span>}
          <span className="bar-total">📚 素材库共 {library.length} 条（去重后总量）</span>
          <span>已选 {selectedNotes.length} 篇用于分析</span>
        </div>
      )}

      {displayNotes.length > 0 && (
        <div className="note-grid">{displayNotes.map(renderRoundNote)}</div>
      )}

      {!result && library.length === 0 && (
        <div className="empty-state">
          <b>还没有任何素材</b>
          <span>输入一个对标关键词开始抓取，或粘贴一条笔记链接。收录的笔记会沉淀在下方素材库，之后每次都能直接复用。</span>
        </div>
      )}

      {result && displayNotes.length === 0 && (
        <div className="empty-state">
          <b>这一轮没有命中素材</b>
          <span>可以调低「点赞数 ≥」的门槛，或换个关键词试试。</span>
        </div>
      )}

      {/* 素材库：整体可展开/收起，内部每张卡片也可展开 */}
      <div className="lib-block">
        <div className="lib-head" onClick={() => setLibOpen(o => !o)}>
          <span className="lib-toggle">{libOpen ? '▾' : '▸'}</span>
          <span className="lib-title">📚 素材库</span>
          <span className="lib-count">共 {library.length} 条</span>
          <label className="check lib-select-all" onClick={e => e.stopPropagation()}>
            <input type="checkbox" checked={allLibChecked} onChange={toggleLibSelectAll} />
            全选
          </label>
          <button className="tiny" disabled={expanded.size === 0}
            onClick={e => { e.stopPropagation(); setExpanded(new Set()); }}>全部收起</button>
          <span style={{ flex: 1 }} />
          <span className={selectedNotes.length ? 'chip-selected' : 'chip-selected empty'}>已选 {selectedNotes.length} 篇</span>
          {dupCount > 0 && (
            <button className="danger" title="标题与作者相同的只保留最新一条"
              onClick={e => { e.stopPropagation(); runDedupe(); }}>整理重复（{dupCount}）</button>
          )}
          <button className="danger" disabled={!libCheckedIds.length}
            title={`删除已勾选的 ${libCheckedIds.length} 条素材（笔记/图片/OCR）`}
            onClick={e => { e.stopPropagation(); deleteSelected(); }}>🗑 删除所选{libCheckedIds.length ? `（${libCheckedIds.length}）` : ''}</button>
        </div>
        {libOpen && (
          library.length === 0 ? (
            <div className="lib-empty">素材库为空。先在上方输入关键词调研或粘贴链接抓取，收录的笔记会累加到这里。</div>
          ) : (
            <div className="note-grid">{library.map(renderLibNote)}</div>
          )
        )}
      </div>
    </div>
  );
}