import { getSettings } from './config.js';
import { isRiskStopped } from './opencli.js';

// ---- 只读链接解析（匿名、无态、零写操作）----
// 复用 opencli 的风控信号/间隔纪律，但完全走匿名请求，不携带任何登录态，
// 命中登录墙或正文缺失时立即放弃，绝不尝试登录或写操作。

// 把任意 xiaohongshu 链接重组为 explore 直读链接（保留真实笔记 ID + xsec_token）。
// 例：search_result/6a42...?xsec_token=ABz... → explore/6a42...?xsec_token=ABz...
export function toReadableUrl(url) {
  const s = String(url || '');
  const idM = s.match(/xiaohongshu\.com\/(?:explore|wenote|search_result|discovery\/item)\/([0-9a-f]{8,32})/i)
    || s.match(/xiaohongshu\.com\/[^/?#]+\/([0-9a-f]{8,32})/i);
  const id = idM ? idM[1] : '';
  if (!id) return { ok: false, id: '', url: '' };
  const tokenM = s.match(/[?&]xsec_token=([^&]+)/);
  const extra = s.match(/[?&]xsec_source=([^&]+)/);
  const qs = new URLSearchParams();
  if (tokenM) qs.set('xsec_token', tokenM[1]);
  if (extra) qs.set('xsec_source', extra[1]);
  const q = qs.toString();
  return { ok: true, id, url: `https://www.xiaohongshu.com/explore/${id}${q ? '?' + q : ''}` };
}

// 从原始链接里提取 xsec_token（供匿名请求时尽量带上 token 以提高成功率）
function extractXsecToken(url) {
  const m = String(url || '').match(/[?&]xsec_token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/**
 * 匿名只读解析单篇笔记正文。严格无态：不带任何 Cookie / 鉴权头。
 * 拿到正文文本返回 {ok:true,content,title}；拿不到返回 {ok:false,reason}。
 */
export async function resolveNoteReadonly(urlOrId) {
  const r = toReadableUrl(urlOrId);
  if (!r.ok) return { ok: false, reason: `无法从链接提取笔记ID: ${String(urlOrId).slice(0, 80)}` };
  if (isRiskStopped()) return { ok: false, reason: '风控已触发，已停止所有请求。请重置后再试。' };

  const settings = getSettings();
  const [min, max] = [ settings.antiRisk?.minIntervalMs ?? 5000, settings.antiRisk?.maxIntervalMs ?? 20000 ];
  const wait = min + Math.floor(Math.random() * (max - min));
  await new Promise(res => setTimeout(res, wait));

  const token = extractXsecToken(r.url);
  try {
    const res = await fetch(r.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://www.xiaohongshu.com/'
      },
      redirect: 'follow'
    });
    const text = await res.text();
    // 登录墙 / 反爬：某些 token 不带或已失效会重定向到登录页
    if (text.length < 200 || /login|登录|验证|安全验证|verify/i.test(text) && !/xsec_token/i.test(text)) {
      return { ok: false, reason: '登录墙或反爬拦截，无法匿名读取（已放弃，保护账号安全）' };
    }
    const content = extractDescFromHtml(text);
    if (content) return { ok: true, content, title: text.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() || '' };
    return { ok: false, reason: '匿名页面未直接含正文文本（需登录状态，已放弃）' };
  } catch (e) {
    return { ok: false, reason: `匿名请求失败: ${e.message}` };
  }
}

// 从 HTML 里抓取正文：优先 __INITIAL_STATE__ 里的 desc，其次 meta[name=description] / og:description
function extractDescFromHtml(html) {
  // 1) 内嵌 JSON 里的 note 描述
  const m = html.match(/<script[^>]*id="__INITIAL_STATE__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const raw = m[1].replace(/undefined/g, 'null');
      const obj = JSON.parse(raw);
      const note = findNoteDescDeep(obj);
      if (note) return note;
    } catch { /* 继续降级 */ }
  }
  // 2) meta 描述
  const meta = html.match(/<meta[^>]+(?:name|property)="(?:description|og:description)"[^>]+content="([^"]+)"/i);
  if (meta && meta[1] && meta[1].length > 10) return cleanHtml(meta[1]);
  return '';
}

function findNoteDescDeep(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj.desc === 'string' && obj.desc) return obj.desc;
  if (typeof obj.desc?.length === 'string' && obj.desc?.length) return obj.desc;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') { const d = findNoteDescDeep(v); if (d) return d; }
    else if (k === 'desc' && typeof v === 'string' && v) return v;
  }
  return '';
}

function cleanHtml(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}