// 可视化编辑模式：地址栏加 ?edit=1 才会动态加载（见 ui.js 末尾）。
//   「文字」模式：点任意一段文字直接改，失焦即保存；
//   「移动」模式：拖动任意文字块/按钮/卡片微调位置，方向键微移，Shift 加速；
//   「导出」把改动导成 JSON，交给开发者落进源码。
// 改动存在本机 localStorage（按页面分开），只在这个浏览器、这个地址下生效。
import { toast } from './ui.js';

const STORE_PREFIX = 'wenxiang.page-edits.v1:';
const TEXT_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, a, button, figcaption, label, dt, dd, td, th, blockquote, .btn';
const MOVE_SELECTOR =
  'h1, h2, h3, h4, p, a, button, img, .btn, .feature, .flow-step, .hero-stats, .hero-actions, .panel, .rec-card, .badge';
const SKIP_SELECTOR = '.title-tune, .pe-panel, .sr-only, h1.wordmark';

start();

function start() {
  const key = STORE_PREFIX + location.pathname;
  const store = { text: {}, offset: {} };
  let mode = 'text';
  let selected = null;

  Object.assign(store, load());
  applySaved();
  const panel = buildPanel();
  document.body.append(panel);
  injectStyle();

  const hint = panel.querySelector('.pe-hint');
  const list = panel.querySelector('.pe-list');

  document.addEventListener('click', (event) => {
    if (event.target.closest('.pe-panel')) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // 顶栏/页脚/统计是异步渲染的，等它们落定再挂编辑能力
  setTimeout(() => setMode('text'), 300);

  function setMode(next) {
    if (next !== 'text' && next !== 'move') return;
    mode = next;
    panel.dataset.editorMode = next;
    panel.querySelectorAll('[data-mode]').forEach((button) => {
      button.classList.toggle('is-on', button.dataset.mode === next);
    });
    document.body.classList.toggle('pe-moving', next === 'move');
    if (next === 'text') {
      textTargets().forEach((el) => {
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'false');
        el.classList.add('pe-editable');
        el.addEventListener('focusout', onTextChange);
      });
      setHint('点任意文字直接改，改完点别处就保存。');
    } else {
      textTargets().forEach((el) => {
        el.removeAttribute('contenteditable');
        el.classList.remove('pe-editable');
        el.removeEventListener('focusout', onTextChange);
      });
      setHint('拖动文字块、按钮或卡片移动位置；方向键微移，Shift 加速。');
    }
  }

  function textTargets() {
    const list = [];
    document.querySelectorAll(TEXT_SELECTOR).forEach((el) => {
      if (el.closest(SKIP_SELECTOR)) return;
      if (el.querySelector(TEXT_SELECTOR)) return; // 只编辑最内层那一块，避免嵌套
      if (!el.textContent.trim()) return;
      list.push(el);
    });
    return list;
  }

  function onTextChange(event) {
    const el = event.currentTarget;
    const selector = cssPath(el);
    if (!selector) return;
    const saved = store.text[selector];
    if (saved === el.innerHTML) return;
    store.text[selector] = el.innerHTML;
    save();
    renderList();
    toast('已保存这处文字');
  }

  // ---- 移动 ----
  let moving = null;
  let start = null;

  document.addEventListener('pointerdown', (event) => {
    if (mode !== 'move') return;
    if (event.target.closest('.pe-panel')) return;
    const el = event.target.closest(MOVE_SELECTOR);
    if (!el || el === document.body || el.closest(SKIP_SELECTOR)) return;
    select(el);
    moving = el;
    start = { x: event.clientX, y: event.clientY, base: offsetOf(el) };
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* 合成事件没有真实指针，忽略 */
    }
    event.preventDefault();
  }, true);

  document.addEventListener('pointermove', (event) => {
    if (!moving || !start) return;
    const em = parseFloat(getComputedStyle(moving).fontSize) || 16;
    const dx = (event.clientX - start.x) / em;
    const dy = (event.clientY - start.y) / em;
    setOffset(moving, start.base.x + dx, start.base.y + dy);
  }, true);

  document.addEventListener('pointerup', () => {
    if (!moving) return;
    moving = null;
    start = null;
    saveOffsets();
    renderList();
  }, true);

  document.addEventListener('pointerover', (event) => {
    if (mode !== 'move' || moving) return;
    if (event.target.closest('.pe-panel')) return;
    const el = event.target.closest(MOVE_SELECTOR);
    document.querySelectorAll('.pe-hover').forEach((node) => {
      if (node !== el) node.classList.remove('pe-hover');
    });
    if (el && el !== document.body) el.classList.add('pe-hover');
  });

  document.addEventListener('keydown', (event) => {
    if (!selected || mode !== 'move') return;
    if (event.target.isContentEditable) return;
    const step = (event.shiftKey ? 10 : 1) / (parseFloat(getComputedStyle(selected).fontSize) || 16);
    const current = offsetOf(selected);
    let handled = true;
    if (event.key === 'ArrowLeft') current.x -= step;
    else if (event.key === 'ArrowRight') current.x += step;
    else if (event.key === 'ArrowUp') current.y -= step;
    else if (event.key === 'ArrowDown') current.y += step;
    else handled = false;
    if (handled) {
      event.preventDefault();
      setOffset(selected, current.x, current.y);
      saveOffsets();
      renderList();
    }
  });

  function select(el) {
    if (selected === el) return;
    if (selected) selected.classList.remove('pe-selected');
    selected = el;
    selected.classList.add('pe-selected');
    renderList();
  }

  function offsetOf(el) {
    return store.offset[cssPath(el)] || { x: 0, y: 0 };
  }

  function setOffset(el, x, y) {
    el.style.transform = `translate(${x.toFixed(3)}em, ${y.toFixed(3)}em)`;
    el.dataset.peEdited = '1';
    store.offset[cssPath(el)] = { x, y };
  }

  function saveOffsets() {
    save();
  }

  // ---- 面板 ----
  function buildPanel() {
    const el = document.createElement('div');
    el.className = 'pe-panel';
    el.innerHTML = `
      <p class="pe-title">页面编辑<span>只在 ?edit=1 下生效</span></p>
      <div class="pe-modes">
        <button type="button" data-mode="text">文字</button>
        <button type="button" data-mode="move">移动</button>
      </div>
      <p class="pe-hint"></p>
      <ul class="pe-list"></ul>
      <div class="pe-actions">
        <button type="button" data-act="export">导出 JSON</button>
        <button type="button" data-act="reset">重置全部</button>
        <button type="button" data-act="exit">退出</button>
      </div>
      <pre class="pe-output" hidden></pre>
    `;

    el.addEventListener('click', (event) => {
      const modeButton = event.target.closest('button[data-mode]');
      if (modeButton) {
        setMode(modeButton.dataset.mode);
        setHint(modeButton.dataset.mode === 'text'
          ? '点任意文字直接改，改完点别处就保存。'
          : '拖动文字块、按钮或卡片移动位置；方向键微移，Shift 加速。');
        return;
      }
      const action = event.target.closest('[data-act]')?.dataset.act;
      if (action === 'export') exportJson();
      if (action === 'reset') resetAll();
      if (action === 'exit') {
        const url = new URL(location.href);
        url.searchParams.delete('edit');
        location.href = url.toString();
      }
    });
    return el;
  }

  function setHint(text) {
    hint.textContent = text;
  }

  function renderList() {
    const items = [];
    if (mode === 'text') {
      Object.keys(store.text).forEach((selector) => {
        items.push({ selector, label: '文字' });
      });
    } else if (selected) {
      items.push({ selector: cssPath(selected), label: '选中' });
    }
    list.innerHTML = items
      .slice(0, 6)
      .map((item) => `<li title="${escapeAttr(item.selector)}">${item.label} · ${escapeAttr(item.selector.slice(-42))}</li>`)
      .join('') || '<li class="pe-empty">还没有改动</li>';
  }

  async function exportJson() {
    const output = panel.querySelector('.pe-output');
    const payload = { page: location.pathname, text: store.text, offset: store.offset };
    const text = JSON.stringify(payload, null, 2);
    output.textContent = text;
    output.hidden = false;
    try {
      await navigator.clipboard.writeText(text);
      toast('改动已复制，发给我就能落进源码');
    } catch {
      toast('已展开，手动复制即可');
    }
  }

  function resetAll() {
    store.text = {};
    store.offset = {};
    localStorage.removeItem(STORE_PREFIX + location.pathname);
    document.querySelectorAll('[data-pe-edited]').forEach((el) => {
      el.style.transform = '';
      delete el.dataset.peEdited;
      el.classList.remove('pe-selected');
    });
    selected = null;
    renderList();
    save();
    toast('已重置这个页面的改动');
  }

  function applySaved() {
    Object.entries(store.text).forEach(([selector, html]) => {
      const el = document.querySelector(selector);
      if (el) el.innerHTML = html;
    });
    Object.entries(store.offset).forEach(([selector, offset]) => {
      const el = document.querySelector(selector);
      if (el) {
        el.style.transform = `translate(${offset.x.toFixed(3)}em, ${offset.y.toFixed(3)}em)`;
        el.dataset.peEdited = '1';
      }
    });
  }

  function save() {
    try {
      localStorage.setItem(STORE_PREFIX + location.pathname, JSON.stringify(store));
    } catch {
      /* 隐私模式写不进去，不影响导出 */
    }
  }

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE_PREFIX + location.pathname) || '{}');
    } catch {
      return {};
    }
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
      body.pe-moving [contenteditable] { cursor: default; }
      body.pe-moving * { user-select: none; }
      .pe-editable:hover { outline: 1px dashed rgba(169, 74, 36, 0.45); outline-offset: 2px; }
      .pe-editable:focus { outline: 2px solid #a94a24; outline-offset: 3px; background: #fffdf9; }
      .pe-hover { outline: 1px dashed rgba(169, 74, 36, 0.5); outline-offset: 2px; }
      .pe-selected { outline: 2px solid #a94a24; outline-offset: 3px; }
      .pe-panel {
        position: fixed; left: 16px; bottom: 16px; z-index: 95;
        width: min(320px, calc(100vw - 32px));
        padding: 14px 16px; border-radius: 14px;
        background: #fffdf9; border: 1px solid #e5ddcf;
        box-shadow: 0 18px 40px rgba(27, 24, 21, 0.18);
        font-size: 12px; color: #1b1815; line-height: 1.5;
      }
      .pe-title { display: flex; justify-content: space-between; gap: 0.6em; margin: 0 0 10px; font-weight: 600; }
      .pe-title span { font-weight: 400; color: #7d746a; font-size: 11px; }
      .pe-modes { display: flex; gap: 6px; margin-bottom: 8px; }
      .pe-modes button {
        flex: 1; padding: 6px 8px; border-radius: 8px; border: 1px solid #d9d0c0;
        background: #fff; color: #1b1815; font-size: 12px; cursor: pointer;
      }
      .pe-modes button.is-on { background: #a94a24; border-color: #a94a24; color: #fff; }
      .pe-hint { margin: 0 0 8px; color: #7d746a; font-size: 11px; }
      .pe-list { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 3px; max-height: 74px; overflow: auto; }
      .pe-list li { color: #4a423a; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pe-list li.pe-empty { color: #9a9188; }
      .pe-actions { display: flex; gap: 6px; }
      .pe-actions button {
        flex: 1; padding: 6px 8px; border-radius: 8px; border: 1px solid #d9d0c0;
        background: #fff; color: #1b1815; font-size: 12px; cursor: pointer;
      }
      .pe-actions button:hover { border-color: #a94a24; color: #a94a24; }
      .pe-output {
        margin: 8px 0 0; padding: 8px 10px; max-height: 120px; overflow: auto;
        background: #f6f1e8; border-radius: 8px; font-size: 9px; line-height: 1.5;
        white-space: pre-wrap; word-break: break-all; color: #4a423a;
      }
    `;
    document.head.append(style);
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return `#${el.id}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList].filter(
        (name) => !name.startsWith('pe-') && !name.startsWith('is-'),
      );
      if (classes.length) part += `.${classes.slice(0, 2).join('.')}`;
      const parent = node.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function escapeAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

