// 给某个页面拍张图，用来看改动效果。
// 用法：node tools/shot.mjs <url> <outName> [width] [height] [--full] [--clip=selector]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [url, name = 'shot', w = '1280', h = '900', ...flags] = process.argv.slice(2);
const OUT = fileURLToPath(new URL('../.shots/', import.meta.url));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9334;
const WIDTH = Number(w);
const HEIGHT = Number(h);
const FULL = flags.includes('--full');

mkdirSync(OUT, { recursive: true });

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=C:/Users/33226/Downloads/edgeprofile-shot',
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let target;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((item) => item.type === 'page');
    if (target) break;
  } catch {
    /* 还在启动 */
  }
  await sleep(250);
}
if (!target) {
  edge.kill();
  throw new Error('Edge 没起来');
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result);
  }
});
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Page.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 2,
  mobile: WIDTH < 600,
});
await send('Page.navigate', { url });
await sleep(1800);

let clip;
if (FULL) {
  const metrics = await send('Page.getLayoutMetrics');
  clip = {
    x: 0,
    y: 0,
    width: Math.min(WIDTH, Math.ceil(metrics.cssContentSize.width)),
    height: Math.min(8000, Math.ceil(metrics.cssContentSize.height)),
    scale: 1,
  };
}
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: Boolean(clip),
  ...(clip ? { clip } : {}),
});
const path = `${OUT}${name}.png`;
writeFileSync(path, Buffer.from(shot.data, 'base64'));
console.log(`${path}  ${clip ? `${clip.width}x${clip.height}` : `${WIDTH}x${HEIGHT}`}`);

ws.close();
edge.kill();
