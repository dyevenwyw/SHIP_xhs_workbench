import { getModels } from './config.js';

// ---- 超时语义（流式双预算）----
// 流式：① 首 token 需在 FIRST_TOKEN_TIMEOUT 内到达（覆盖 连接+排队+首字符）；
//      ② 出 token 之后，持续 IDLE_TIMEOUT 无任何新数据才中断（惰性：每收到一块数据就重置计时）。
// 非流式（文案生成）：整体 NON_STREAM_TIMEOUT 内完成。
const DEFAULT_FIRST_TOKEN_TIMEOUT = 60_000;   // 首 token 60s
const DEFAULT_IDLE_TIMEOUT = 30_000;          // 输出中途 30s 无新数据则中断
const DEFAULT_NON_STREAM_TIMEOUT = 90_000;    // 非流式 90s
const DEFAULT_RETRIES = 2;                    // 可重试故障最多重试 2 次（共 3 次尝试）
const DEFAULT_MAX_TOKENS = 4096;              // max_tokens 默认上限（调大，降低被 token 截断的概率）

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isTransient = (e) =>
  e?.name === 'TimeoutError' ||
  /timed out|timeout|network|fetch failed|ECONN|aborted|socket/i.test(e?.message || '');

// 底层 chat 调用：流式/非流式分离的超时语义 + 自动重试。
// - stream=false：返回完整 { content, finishReason }，整体 90s（可用 nonStreamTimeout 覆盖）
// - stream=true 且传 onToken：逐 token 回调，返回完整 { content, finishReason }，采用双预算
// 重试仅覆盖「连接 / 5xx / 429 / 超时 / 网络」类瞬时故障；一旦开始读取响应体（含首个 token）则不再重试。
async function postChat(cfg, messages, opts = {}) {
  if (!cfg?.baseURL || !cfg?.apiKey || !cfg?.model) {
    throw new Error('文本模型未配置（config/models.json 的 text 项需填 baseURL/apiKey/model）');
  }
  const url = `${cfg.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const stream = !!opts.stream;
  const body = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.max_tokens ?? DEFAULT_MAX_TOKENS,
    stream
  };
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const firstTokenTimeout = opts.firstTokenTimeout ?? DEFAULT_FIRST_TOKEN_TIMEOUT;
  const idleTimeout = opts.idleTimeout ?? DEFAULT_IDLE_TIMEOUT;
  const nonStreamTimeout = opts.nonStreamTimeout ?? opts.timeout ?? DEFAULT_NON_STREAM_TIMEOUT;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // 流式：用自建 AbortController 走双预算；非流式：整体时间预算
    const controller = stream ? new AbortController() : null;
    // 已中止则跳过并容忍边界异常，避免计时器晚到对已中止的 controller 二次 abort 触发未捕获异常
    const safeAbort = () => { try { if (controller && !controller.signal.aborted) controller.abort(); } catch { /* 忽略二次中止边界 */ } };
    const firstTokenTimer = stream ? setTimeout(safeAbort, firstTokenTimeout) : null;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: stream ? controller.signal : AbortSignal.timeout(nonStreamTimeout)
      });
    } catch (e) {
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
      // 预算中断（非真网络错误）转成明确的超时语义：
      // 流式=连接/排队/首 token 阶段超时；非流式=整体 90s 超时。预算中断不重试。
      const streamBudgetAbort = stream && controller?.signal?.aborted;
      const nonStreamBudgetAbort = !stream && (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /operation was aborted/i.test(e?.message || ''));
      if (streamBudgetAbort) lastErr = new Error(`文本LLM首 token 超时（> ${firstTokenTimeout}ms）`);
      else if (nonStreamBudgetAbort) lastErr = new Error(`文本LLM调用超时（> ${nonStreamTimeout}ms）`);
      else lastErr = e;
      if (lastErr === e && attempt < retries && isTransient(e)) { await sleep(400 * (attempt + 1)); continue; }
      throw lastErr;
    }
    if (!res.ok) {
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
      const t = await res.text();
      if (attempt < retries && (res.status >= 500 || res.status === 429)) {
        lastErr = new Error(`文本LLM调用失败 ${res.status}: ${t.slice(0, 200)}`);
        await sleep(300 * (attempt + 1));
        continue;
      }
      throw new Error(`文本LLM调用失败 ${res.status}: ${t.slice(0, 400)}`);
    }
    if (!stream) {
      const data = await res.json();
      const choice = data.choices?.[0];
      return { content: choice?.message?.content ?? '', finishReason: choice?.finish_reason || null };
    }
    // 流式：headers 已到达，连接期兜底计时到此为止；此后首 token/空闲由 consumeStream 惰性预算负责
    //（不在已解析的响应流上调用 controller.abort，避免触发 fetch 内部未捕获拒绝）
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    return await consumeStream(res, { firstTokenTimeout, idleTimeout, onToken: opts.onToken });
  }
  throw lastErr || new Error('文本LLM调用失败（重试耗尽）');
}

// 流式 SSE 读取：惰性预算。首 token 前按 firstTokenTimeout；吐首 token 后切为空闲预算 idleTimeout，且每收到一块数据即重置。
// 预算超时通过 Promise.race 判定并用 reader.cancel 释放底层流（不在已解析流上 abort controller，避免 fetch 内部未捕获拒绝）。
async function consumeStream(res, { firstTokenTimeout, idleTimeout, onToken }) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let finishReason = null;
  let gotToken = false;

  const readWithBudget = () => new Promise((resolve, reject) => {
    let settled = false;
    const budget = gotToken ? idleTimeout : firstTokenTimeout;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { reader.cancel?.(); } catch { /* 释放底层流 */ }
      reject(new Error(gotToken
        ? `文本LLM流式中断：输出过程中超过 ${idleTimeout}ms 无新数据`
        : `文本LLM首 token 超时（> ${firstTokenTimeout}ms）`));
    }, budget);
    reader.read().then(
      (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
      (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e); }
    );
  });

  try {
    while (true) {
      const { done, value } = await readWithBudget();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) {
          if (!gotToken) gotToken = true; // 首个 token：此后切换为空闲预算
          full += delta;
          onToken?.(delta);
        }
        const fr = j.choices?.[0]?.finish_reason;
        if (fr) finishReason = fr;
      }
    }
  } catch (e) {
    throw e; // readWithBudget 已把预算中断转成语义明确的错误；其余错误原样上抛
  } finally {
    try { reader.cancel?.(); } catch { /* 忽略取消副作用 */ }
  }
  return { content: full, finishReason };
}

// ---- 对外封装 ----
// 流式（token 级回调）：供分析 / 发布预核做 SSE 逐字推送；返回完整文本 + finishReason
export async function askTextStream(messages, { temperature, max_tokens, onToken, retries, firstTokenTimeout, idleTimeout } = {}) {
  const cfg = getModels().text;
  return postChat(cfg, messages, {
    temperature, max_tokens, stream: true, onToken, retries, firstTokenTimeout, idleTimeout
  });
}

// 非流式（带 onEvent 事件回调）—— 当前已无路由直接调用，保留为公共 API（整体 90s）
export async function askText(messages, { temperature, max_tokens, onEvent, jobId, timeout } = {}) {
  onEvent?.({ type: 'llm_start', jobId, step: 'asking-text' });
  try {
    const cfg = getModels().text;
    const { content } = await postChat(cfg, messages, { temperature, max_tokens, timeout });
    onEvent?.({ type: 'llm_done', jobId, step: 'text' });
    return content;
  } catch (e) {
    onEvent?.({ type: 'llm_error', jobId, message: e.message });
    throw e;
  }
}

// 非流式，返回 { content, finishReason }，供文案生成判断内容是否被 token 上限截断（串行逻辑不变；整体 90s）
export async function askTextFull(messages, { temperature, max_tokens, timeout } = {}) {
  const cfg = getModels().text;
  return postChat(cfg, messages, { temperature, max_tokens, timeout });
}