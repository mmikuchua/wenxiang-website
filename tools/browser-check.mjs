// 用 Chrome DevTools Protocol 驱动无头 Edge，做端到端 UI 验证（不依赖 Playwright）。
// 用法：node tools/browser-check.mjs [baseUrl]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://127.0.0.1:8010';
const OUT = fileURLToPath(new URL('../.shots/', import.meta.url));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;

mkdirSync(OUT, { recursive: true });

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `页面脚本异常: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description || ''}`,
      );
    }
    return result.result?.value;
  }

  async goto(url, wait = 1200) {
    await this.send('Page.navigate', { url });
    await sleep(wait);
  }

  async shot(name) {
    const metrics = await this.send('Page.getLayoutMetrics');
    const width = Math.min(1440, Math.ceil(metrics.cssContentSize.width));
    const height = Math.min(9000, Math.ceil(metrics.cssContentSize.height));
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'));
    console.log(`  screenshot -> ${name}.png (${width}x${height})`);
  }
}

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=C:/Users/33226/Downloads/edgeprofile-cdp',
    '--window-size=1440,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let target;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const list = await response.json();
    target = list.find((item) => item.type === 'page');
    if (target) break;
  } catch (error) {
    /* 浏览器还没起来 */
  }
  await sleep(300);
}
if (!target) throw new Error('无法连接到 Edge 调试端口');

const cdp = new CDP(target.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Network.enable');
// ES module 会被浏览器缓存，调试时必须关掉，否则看到的还是旧代码
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

const errors = [];
cdp.ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
    errors.push(data.params.args.map((arg) => arg.value || arg.description).join(' '));
  }
});

try {
  console.log('[1] home');
  await cdp.goto(`${BASE}/index.html`, 1200);
  await cdp.evaluate('localStorage.clear()');
  await cdp.goto(`${BASE}/index.html`, 1400);
  await cdp.shot('01-home');

  console.log('[2] survey');
  await cdp.goto(`${BASE}/survey.html`, 900);
  await cdp.shot('02-survey');

  const answers = ['B', 'D', 'D', 'B', 'C', 'B'];
  for (const value of answers) {
    await cdp.evaluate(`document.querySelector('.option[data-value="${value}"]').click()`);
    await sleep(420);
  }
  // 第 7 题多选：非遗手工 + 展览演出
  await cdp.evaluate(
    `document.querySelectorAll('.option[data-value="A"], .option[data-value="C"]').forEach((node) => node.click())`,
  );
  await sleep(200);
  await cdp.shot('03-survey-multi');
  await cdp.evaluate(`document.querySelector('#btn-next').click()`);
  await sleep(420);
  for (const value of ['A', 'A', 'A', 'A']) {
    await cdp.evaluate(`document.querySelector('.option[data-value="${value}"]').click()`);
    await sleep(420);
  }
  await sleep(3200);
  console.log('    url:', await cdp.evaluate('location.href'));
  await cdp.shot('04-recommend');

  console.log('[3] natural language');
  await cdp.evaluate(`
    (() => {
      const input = document.querySelector('#lookup-input');
      input.value = '周末带孩子去免费的博物馆';
      document.querySelector('#lookup-form').requestSubmit();
    })()
  `);
  await sleep(13000);
  await cdp.shot('05-recommend-query');

  console.log('[4] admin (inject 6 samples)');
  const samples = [
    { age: 'B', actTypes: ['A', 'C'], focus: 'A', demand: 'B', comfort: 'C', time: 'B', traffic: 'A', income: 'B', occupation: 'H', education: 'D', living: 'B' },
    { age: 'C', actTypes: ['E', 'F'], focus: 'C', demand: 'C', comfort: 'A', time: 'B', traffic: 'D', income: 'C', occupation: 'B', education: 'D', living: 'D' },
    { age: 'C', actTypes: ['C'], focus: 'D', demand: 'A', comfort: 'B', time: 'C', traffic: 'B', income: 'B', occupation: 'G', education: 'C', living: 'D' },
    { age: 'D', actTypes: ['G', 'D'], focus: 'B', demand: 'C', comfort: 'B', time: 'A', traffic: 'A', income: 'A', occupation: 'I', education: 'B', living: 'D' },
    { age: 'B', actTypes: ['C', 'D'], focus: 'C', demand: 'A', comfort: 'C', time: 'A', traffic: 'C', income: 'A', occupation: 'H', education: 'E', living: 'A' },
    { age: 'B', actTypes: ['B'], focus: 'A', demand: 'B', comfort: 'A', time: 'B', traffic: 'A', income: 'B', occupation: 'C', education: 'E', living: 'B' },
  ];
  const payload = JSON.stringify(
    samples.map((profile, index) => ({
      id: `demo-${index}`,
      created_at: new Date(Date.now() - index * 86400000).toISOString(),
      profile,
      source: 'demo',
    })),
  );
  await cdp.goto(`${BASE}/admin.html`, 700);
  await cdp.evaluate(`(() => {
    const state = JSON.parse(localStorage.getItem('wenxiang.v2') || '{}');
    state.responses = ${payload};
    state.feedback = {};
    state.seen = [];
    localStorage.setItem('wenxiang.v2', JSON.stringify(state));
  })()`);
  await cdp.goto(`${BASE}/admin.html`, 1200);
  await cdp.shot('06-admin');
  console.log(
    '    charts:',
    await cdp.evaluate("document.querySelector('#charts').innerText.replace(/\\n/g, ' | ').slice(0, 200)"),
  );

  console.log('[5] mobile');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp.goto(`${BASE}/recommend.html`, 2200);
  await cdp.shot('07-mobile-recommend');

  if (errors.length) {
    console.log('console errors:');
    for (const error of errors.slice(0, 10)) console.log('   ', error);
  } else {
    console.log('OK: no console errors');
  }
} finally {
  edge.kill();
}
