// 首页书法字标的手动微调器：地址栏加 ?tune=1 才会动态加载，正常访问不会下载。
//   拖动某个字 = 移动；滚轮 = 缩放；方向键 = 微移（Shift 加速）；+/- = 缩放；R = 复位这一个字
// 调完点「复制 CSS」，把四行粘进 app.css 里对应的 nth-of-type 规则即可。
import { toast } from './ui.js';

const h1 = document.querySelector('.hero h1.wordmark');
const images = h1 ? [...h1.querySelectorAll('img')] : [];
const NAMES = ['文', '享', '智', '配'];
const STORAGE_KEY = 'wenxiang.title-tune.v1';
const STEP = 0.01;
const FAST_STEP = 0.05;
const SCALE_STEP = 0.02;
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.6;

if (images.length) {
  start();

  function start() {
    const em = parseFloat(getComputedStyle(h1).fontSize) || 64;
    const saved = loadSaved();
    let selected = 0;
    let saveTimer = 0;

    const entries = images.map((img, index) => {
      const preset = saved[index] || {};
      return {
        img,
        name: NAMES[index] || `第 ${index + 1} 个字`,
        s: numberOr(preset.s, readVar(img, '--s', 1)),
        x: numberOr(preset.x, readVar(img, '--x', 0)),
        y: numberOr(preset.y, readVar(img, '--y', 0)),
      };
    });

    injectStyle();
    const panel = buildPanel();
    document.body.append(panel);
    images.forEach((img) => {
      img.draggable = false; // 不然拖的时候会触发浏览器自带的图片拖拽
    });

    const list = panel.querySelector('.title-tune__list');
    const code = panel.querySelector('.title-tune__code');
    entries.forEach((entry, index) => {
      const row = document.createElement('li');
      row.dataset.index = String(index);
      row.innerHTML = `<b>${entry.name}</b><span></span>`;
      row.addEventListener('click', () => select(index));
      list.append(row);
    });

    select(0);
    render();

    function select(index) {
      selected = Math.max(0, Math.min(entries.length - 1, index));
      entries.forEach((entry, i) => {
        entry.img.classList.toggle('is-tune-selected', i === selected);
        list.children[i].classList.toggle('is-active', i === selected);
      });
    }

    function render() {
      entries.forEach((entry, index) => {
        entry.img.style.setProperty('--s', entry.s.toFixed(3));
        entry.img.style.setProperty('--x', `${entry.x.toFixed(3)}em`);
        entry.img.style.setProperty('--y', `${entry.y.toFixed(3)}em`);
        const cell = list.children[index].lastElementChild;
        cell.textContent = `s ${entry.s.toFixed(2)} · x ${entry.x.toFixed(2)} · y ${entry.y.toFixed(2)}`;
      });
      code.textContent = entries
        .map(
          (entry, index) =>
            `.hero h1.wordmark img:nth-of-type(${index + 1}) { ` +
            `--s: ${entry.s.toFixed(3)}; --x: ${entry.x.toFixed(3)}em; --y: ${entry.y.toFixed(3)}em; } /* ${entry.name} */`,
        )
        .join('\n');
      scheduleSave();
    }

    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save(entries), 400);
    }

    function clampScale(value) {
      return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
    }

    // ---- 拖动 ----
    entries.forEach((entry, index) => {
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let baseX = 0;
      let baseY = 0;

      entry.img.addEventListener('pointerdown', (event) => {
        select(index);
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        baseX = entry.x;
        baseY = entry.y;
        try {
          entry.img.setPointerCapture(event.pointerId);
        } catch {
          /* 合成事件或已释放的指针，捕获不到也无妨 */
        }
        entry.img.classList.add('is-tune-dragging');
        event.preventDefault();
      });

      entry.img.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        entry.x = baseX + (event.clientX - startX) / em;
        entry.y = baseY + (event.clientY - startY) / em;
        render();
      });

      const stop = () => {
        dragging = false;
        entry.img.classList.remove('is-tune-dragging');
      };
      entry.img.addEventListener('pointerup', stop);
      entry.img.addEventListener('pointercancel', stop);

      entry.img.addEventListener(
        'wheel',
        (event) => {
          event.preventDefault();
          select(index);
          entry.s = clampScale(entry.s * Math.exp(-event.deltaY * 0.0015));
          render();
        },
        { passive: false },
      );
    });

    // ---- 键盘 ----
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      const entry = entries[selected];
      const step = event.shiftKey ? FAST_STEP : STEP;
      let handled = true;
      switch (event.key) {
        case 'ArrowLeft':
          entry.x -= step;
          break;
        case 'ArrowRight':
          entry.x += step;
          break;
        case 'ArrowUp':
          entry.y -= step;
          break;
        case 'ArrowDown':
          entry.y += step;
          break;
        case '+':
        case '=':
          entry.s = clampScale(entry.s + SCALE_STEP);
          break;
        case '-':
        case '_':
          entry.s = clampScale(entry.s - SCALE_STEP);
          break;
        case 'r':
        case 'R':
          entry.s = 1;
          entry.x = 0;
          entry.y = 0;
          break;
        default:
          handled = false;
      }
      if (handled) {
        event.preventDefault();
        render();
      }
    });

    // ---- 按钮 ----
    panel.addEventListener('click', (event) => {
      const action = event.target.closest('button')?.dataset.act;
      if (!action) return;
      if (action === 'reset') {
        entries.forEach((entry) => {
          entry.s = 1;
          entry.x = 0;
          entry.y = 0;
        });
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* 忽略 */
        }
        render();
      }
      if (action === 'copy') {
        copy(code.textContent);
      }
      if (action === 'close') {
        panel.remove();
        entries.forEach((entry) => entry.img.classList.remove('is-tune-selected'));
      }
    });

    async function copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        toast('CSS 已复制，粘到 app.css 里就行');
      } catch {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        toast('CSS 已复制');
      }
    }
  }

  function readVar(img, name, fallback) {
    const value = parseFloat(getComputedStyle(img).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function numberOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function loadSaved() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function save(entries) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(entries.map(({ s, x, y }) => ({ s, x, y }))),
      );
    } catch {
      /* 隐私模式写不进去就算了，不影响复制 */
    }
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'title-tune';
    panel.innerHTML = `
      <p class="title-tune__title">字标微调<span>拖动移动 · 滚轮缩放 · 方向键微移 · R 复位</span></p>
      <ul class="title-tune__list"></ul>
      <pre class="title-tune__code"></pre>
      <div class="title-tune__actions">
        <button type="button" data-act="copy">复制 CSS</button>
        <button type="button" data-act="reset">全部复位</button>
        <button type="button" data-act="close">关闭</button>
      </div>
    `;
    return panel;
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .hero h1.wordmark img.is-tune-selected { outline: 2px dashed #a94a24; outline-offset: 3px; }
      .hero h1.wordmark img.is-tune-dragging { cursor: grabbing; }
      .title-tune {
        position: fixed; right: 16px; bottom: 16px; z-index: 90;
        width: min(330px, calc(100vw - 32px));
        padding: 14px 16px; border-radius: 14px;
        background: #fffdf9; border: 1px solid #e5ddcf;
        box-shadow: 0 18px 40px rgba(27, 24, 21, 0.18);
        font-size: 12px; color: #1b1815; line-height: 1.5;
      }
      .title-tune__title { display: flex; justify-content: space-between; gap: 0.6em; margin: 0 0 10px; font-weight: 600; }
      .title-tune__title span { font-weight: 400; color: #7d746a; font-size: 11px; }
      .title-tune__list { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 4px; }
      .title-tune__list li {
        display: flex; align-items: center; justify-content: space-between; gap: 0.6em;
        padding: 5px 8px; border-radius: 8px; border: 1px solid transparent; cursor: pointer;
        font-variant-numeric: tabular-nums;
      }
      .title-tune__list li:hover { background: #f6f1e8; }
      .title-tune__list li.is-active { border-color: #a94a24; background: #fbf1ea; }
      .title-tune__list b { font-size: 14px; font-family: var(--serif); }
      .title-tune__list span { color: #7d746a; }
      .title-tune__code {
        margin: 0 0 10px; padding: 8px 10px; max-height: 96px; overflow: auto;
        background: #f6f1e8; border-radius: 8px; font-size: 10px; line-height: 1.5;
        white-space: pre-wrap; word-break: break-all; color: #4a423a;
      }
      .title-tune__actions { display: flex; gap: 6px; }
      .title-tune__actions button {
        flex: 1; padding: 6px 8px; border-radius: 8px; border: 1px solid #d9d0c0;
        background: #fff; color: #1b1815; font-size: 12px; cursor: pointer;
      }
      .title-tune__actions button:hover { border-color: #a94a24; color: #a94a24; }
    `;
    document.head.append(style);
  }
}
