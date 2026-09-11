/**
 * 冒烟测试（不开真实 API / 不依赖登录态）
 * 覆盖：server 进程可启动 → 健康检查 → settings/config/models → skills 列表 → LLM SSE 假数据回环
 * 端到端抓取类（需真 Key + 小红书登录态）不在本测试内，需手动验证。
 *
 * 运行：node test/smoke.mjs   （或 npm test -w server）
 */
import http from 'http';
import net from 'net';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRV_MAIN = path.join(ROOT, 'src', 'index.js');

// 模型配置唯一来源是 config/models.json；测试通过写它注入假 LLM 地址，结束前还原（不依赖环境变量）
const MODELS_FILE = path.join(ROOT, '..', 'config', 'models.json');
let originalModelsJson = '';
try {
  originalModelsJson = fs.readFileSync(MODELS_FILE, 'utf8');
} catch {
  originalModelsJson = '{\n  "text": { "baseURL": "", "apiKey": "", "model": "" }\n}';
}
function setTestModels({ baseURL, apiKey, model }) {
  fs.writeFileSync(MODELS_FILE, JSON.stringify({ text: { baseURL, apiKey, model } }, null, 2));
}

// 临时占用一个空闲端口，再释放，避免与残留服务冲突
function getFreePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// 失败的断言直接抛出
function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const get = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let s = '';
    res.on('data', (d) => (s += d));
    res.on('end', () => resolve({ status: res.statusCode, json: s ? JSON.parse(s) : null }));
  }).on('error', reject);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1) 本地假 OpenAI 兼容 SSE 服务 ----------
// mode：full=正常流式；never-token=只回 headers 不吐数据（测首 token 超时）；stall=发首块后停滞（测输出空闲超时）
function startFakeLLM(mode = 'full') {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    if (mode === 'never-token') return; // 连接建立但 body 一直不发
    if (mode === 'stall') {
      const payload = JSON.stringify({ choices: [{ delta: { content: '只', finish_reason: null } }] });
      res.write(`data: ${payload}\n\n`);
      return; // 只发首块后停住
    }
    const chunks = ['你好', '，这是', '一段假', '内容。'];
    let i = 0;
    const send = () => {
      if (i >= chunks.length) {
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const payload = JSON.stringify({
        choices: [{ delta: { content: chunks[i] }, finish_reason: i === chunks.length - 1 ? 'stop' : null }]
      });
      res.write(`data: ${payload}\n\n`);
      i++;
      setTimeout(send, 5);
    };
    send();
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

// ---------- 2) SSE 假数据回环（写 config/models.json 注入假地址，不真调 API）----------
async function testLLMStream(fakePort) {
  setTestModels({ baseURL: `http://127.0.0.1:${fakePort}`, apiKey: 'test-key', model: 'smoke-model' });

  const { askTextStream } = await import(path.join(ROOT, 'src', 'llm.js'));
  let got = '';
  const out = await askTextStream([{ role: 'user', content: 'hi' }], {
    onToken: (t) => (got += t),
    retries: 0
  });
  assert(out.content === '你好，这是一段假内容。', `SSE 拼接内容不完整: "${out.content}"`);
  assert(got === out.content, 'onToken 累计与返回 content 不一致');
  assert(out.finishReason === 'stop', `finishReason 异常: ${out.finishReason}`);
  console.log('  ✔ SSE 假数据回环：token 拼接 / onToken / finishReason 均通过');
}

// ---------- 2b) 流式双预算超时（首 token / 输出空闲）----------
async function testLLMTimeouts() {
  const { askTextStream } = await import(path.join(ROOT, 'src', 'llm.js'));
  const msgs = [{ role: 'user', content: 'hi' }];

  // 用例 1：服务端只回 headers、不吐任何数据 → 首 token 超时
  const s1 = await startFakeLLM('never-token');
  setTestModels({ baseURL: `http://127.0.0.1:${s1.port}`, apiKey: 'k', model: 'm' });
  let firstErr = '';
  try { await askTextStream(msgs, { retries: 0, firstTokenTimeout: 400 }); }
  catch (e) { firstErr = e.message; }
  assert(/首 token 超时/.test(firstErr), `首 token 超时应报错, 实得: ${firstErr}`);
  s1.srv.close();
  console.log('  ✔ 首 token 超时：400ms 未见 token 则中断');

  // 用例 2：发出首块后停滞 → 输出空闲超时（惰性检查需先放行首 token）
  const s2 = await startFakeLLM('stall');
  setTestModels({ baseURL: `http://127.0.0.1:${s2.port}`, apiKey: 'k', model: 'm' });
  let idleErr = '';
  try { await askTextStream(msgs, { retries: 0, firstTokenTimeout: 5000, idleTimeout: 400 }); }
  catch (e) { idleErr = e.message; }
  assert(/无新数据/.test(idleErr), `输出空闲超时应报错, 实得: ${idleErr}`);
  s2.srv.close();
  console.log('  ✔ 输出空闲超时：首块后 400ms 无新数据则中断');
}

// ---------- 3) 启动真实 server 进程，验证基础接口 ----------
async function testServerBoot(fakePort, testPort) {
  setTestModels({ baseURL: `http://127.0.0.1:${fakePort}`, apiKey: 'test-key', model: 'smoke-model' });
  const child = spawn(process.execPath, [SRV_MAIN], {
    env: { ...process.env, PORT: String(testPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const base = `http://127.0.0.1:${testPort}`;

  try {
    // 等待 health 就绪（最多 8s）
    let healthy = false;
    for (let t = 0; t < 40; t++) {
      try {
        const r = await get(`${base}/api/health`);
        if (r.status === 200 && r.json?.ok) { healthy = true; break; }
      } catch { /* not ready */ }
      await sleep(200);
    }
    assert(healthy, 'server 未在 8s 内就绪 (health)');

    const settings = await get(`${base}/api/settings`);
    assert(settings.status === 200 && settings.json?.workbench, '/api/settings 200 且含 workbench');

    const models = await get(`${base}/api/models`);
    assert(models.status === 200, '/api/models 200');
    assert(models.json?.text?.baseURL === `http://127.0.0.1:${fakePort}`, 'config/models.json 的 baseURL 已生效');
    assert(models.json?.text?.model === 'smoke-model', 'config/models.json 的 model 已生效');

    const skills = await get(`${base}/api/skills`);
    assert(skills.status === 200 && Array.isArray(skills.json), '/api/skills 200 且为数组');
    assert(skills.json.length >= 6, `skills 数量异常: ${skills.json.length}`);

    console.log('  ✔ server 进程启动 + health / settings / models / skills 接口均通过');
  } finally {
    child.kill('SIGTERM');
  }
}

// ---------- 主流程 ----------
const { srv, port: fakePort } = await startFakeLLM();
const testPort = await getFreePort();
let fail = 0;
try {
  console.log('▶ 冒烟测试开始\n');
  await testLLMStream(fakePort);
  await testLLMTimeouts();
  await testServerBoot(fakePort, testPort);
  console.log('\n✅ 冒烟测试全部通过。');
} catch (e) {
  fail = 1;
  console.error('\n❌ ' + e.message);
} finally {
  srv.close();
  fs.writeFileSync(MODELS_FILE, originalModelsJson);   // 还原 config/models.json（不含任何测试残留）
}
process.exit(fail);