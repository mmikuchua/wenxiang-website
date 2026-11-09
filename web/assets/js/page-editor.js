// 可视化编辑模式：地址栏加 ?edit=1 才会动态加载（见 ui.js 末尾）。
//   「文字」模式：点任意一段文字直接改，失焦即保存；
//   「移动」模式：拖动任意文字块/按钮/卡片微调位置，方向键微移，Shift 加速；
//   「大小」模式：选中后拖右下角的圆点缩放；文字改字号，图片/卡片改整体缩放；
//   「导出」把改动导成 JSON，交给开发者落进源码。
// 改动存在本机 localStorage（按页面分开），只在这个浏览器、这个地址下生效。
import { toast } from './ui.js';

const STORE_PREFIX = 'wenxiang.page-edits.v1:';
const TEXT_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, a, button, figcaption, label, dt, dd, td, th, blockquote, .btn';
const SKIP_SELECTOR = '.title-tune, .pe-panel, .sr-only, h1.wordmark';
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption, .btn';
const TEXT_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'A', 'BUTTON', 'LI', 'LABEL', 'TD', 'TH', 'FIGCAPTION', 'BLOCKQUOTE']);

start();

function start() {
  const key = STORE_PREFIX + location.pathname;
  const store = { text: {}, offset: {}, size: {} };
  let mode = 'text';
  let selected = null;
  let applying = false;

  Object.assign(store, load());
  applySaved();
  const panel = buildPanel();
  document.body.append(panel);
  const handle = buildHandle();
  document.body.append(handle);
  injectStyle();

  const hint = panel.querySelector('.pe-hint');
  const list = panel.querySelector('.pe-list');

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target.closest('.pe-panel') || target.closest('.pe-handle')) return;
    // 链接一律不跳转，免得调一半跑掉
    if (target.closest('a[href]')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // 文字模式下禁掉点击，方便把光标点进可编辑区域
    if (mode === 'text') {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  // 顶栏/页脚/统计是异步渲染的，等它们落定再挂编辑能力
  setTimeout(() => setMode('text'), 300);

  function setMode(next) {
    if (next !== 'text' && next !== 'move' && next !== 'size') return;
    mode = next;
    panel.dataset.editorMode = next;
    panel.querySelectorAll('[data-mode]').forEach((button) => {
      button.classList.toggle('is-on', button.dataset.mode === next);
    });
    document.body.classList.toggle('pe-moving', next === 'move');
    document.body.classList.toggle('pe-sizing', next === 'size');
    handle.hidden = next !== 'size' || !selected;
    if (next === 'text') {
      attachTextTargets();
      setHint('点任意文字直接改，改完点别处就保存。');
    } else {
      detachTextTargets();
      setHint(next === 'move'
        ? '页面上任何元素都能拖；按住 Alt 直接抓上一层，方向键微移。'
        : '点谁选谁，拖右下角圆点放大缩小；Alt 选上一层，+ / - 微调。');
    }
    syncHandle();
  }

  // 点击位置对应的元素：默认抓最里面那个，按住 Alt 抓它的上一层
  function pickTarget(node, climb = 0) {
    let el = node instanceof Element ? node : node?.parentElement;
    if (!el || el.closest(SKIP_SELECTOR)) return null;
    while (el && el !== document.body) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) break;
      el = el.parentElement;
    }
    if (!el || el === document.body || el === document.documentElement) return null;
    for (let i = 0; i < climb; i += 1) {
      const parent = el.parentElement;
      if (!parent || parent === document.body || parent.closest(SKIP_SELECTOR)) break;
      el = parent;
    }
    return el;
  }

  function attachTextTargets() {
    textTargets().forEach((el) => {
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'false');
      el.classList.add('pe-editable');
      el.addEventListener('focusout', onTextChange);
    });
  }

  function detachTextTargets() {
    textTargets().forEach((el) => {
      el.removeAttribute('contenteditable');
      el.classList.remove('pe-editable');
      el.removeEventListener('focusout', onTextChange);
    });
  }

  function textTargets() {
    const candidates = [];
    document.querySelectorAll(TEXT_SELECTOR).forEach((el) => {
      if (el.closest(SKIP_SELECTOR)) return;
      if (el.querySelector(BLOCK_SELECTOR)) return; // 有块级子元素时，交给子元素去编辑
      if (!el.textContent.trim()) return;
      candidates.push(el);
    });
    const set = new Set(candidates);
    // 祖先已经在编辑列表里，就不重复挂 contenteditable，否则嵌套编辑会打架
    return candidates.filter((el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (set.has(node)) return false;
      }
      return true;
    });
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
    if (event.target.closest('.pe-panel') || event.target.closest('.pe-handle')) return;
    if (mode !== 'move' && mode !== 'size') return;
    const el = pickTarget(event.target, event.altKey ? 1 : 0);
    if (!el) return;
    select(el);
    if (mode === 'size') {
      event.preventDefault();
      return;
    }
    moving = el;
    start = { x: event.clientX, y: event.clientY, base: offsetOf(el) };
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* 合成事件没有真实指针，忽略 */
    }
    event.preventDefault();
  }, true);

  // ---- 缩放 ----
  let resizing = null;

  handle.addEventListener('pointerdown', (event) => {
    if (mode !== 'size' || !selected) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = selected.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const kind = TEXT_TAGS.has(selected.tagName) ? 'font' : 'scale';
    const parentFont = parseFloat(getComputedStyle(selected.parentElement).fontSize) || 16;
    const saved = store.size[cssPath(selected)];
    const base = kind === 'font'
      ? (saved && saved.kind === 'font' ? saved.value * parentFont : parseFloat(getComputedStyle(selected).fontSize))
      : (saved && saved.kind === 'scale' ? saved.value : 1);
    resizing = {
      kind,
      base,
      parentFont,
      center,
      startDist: Math.max(12, Math.hypot(event.clientX - center.x, event.clientY - center.y)),
    };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* 同上 */
    }
  });

  document.addEventListener('pointermove', (event) => {
    if (!resizing && (!moving || !start)) return;
    if (resizing) {
      const dist = Math.hypot(event.clientX - resizing.center.x, event.clientY - resizing.center.y);
      const factor = Math.min(2.6, Math.max(0.35, dist / resizing.startDist));
      const target = resizing.base * factor;
      if (resizing.kind === 'font') {
        setFontSize(selected, target / resizing.parentFont);
      } else {
        setScale(selected, Math.min(2.6, Math.max(0.35, target)));
      }
      syncHandle();
      renderList();
      return;
    }
    const em = parseFloat(getComputedStyle(moving).fontSize) || 16;
    const dx = (event.clientX - start.x) / em;
    const dy = (event.clientY - start.y) / em;
    setOffset(moving, start.base.x + dx, start.base.y + dy);
    syncHandle();
  }, true);

  document.addEventListener('pointerup', () => {
    if (resizing) {
      resizing = null;
      save();
      syncHandle();
      renderList();
    }
    if (!moving) return;
    moving = null;
    start = null;
    saveOffsets();
    renderList();
  }, true);

  document.addEventListener('pointerover', (event) => {
    if (mode !== 'move' || moving) return;
    if (event.target.closest('.pe-panel')) return;
    const el = pickTarget(event.target, event.altKey ? 1 : 0);
    document.querySelectorAll('.pe-hover').forEach((node) => {
      if (node !== el) node.classList.remove('pe-hover');
    });
    if (el && el !== document.body) el.classList.add('pe-hover');
  });

  document.addEventListener('keydown', (event) => {
    if (!selected || event.target.isContentEditable) return;
    if (mode === 'size') {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        adjustSize(selected, event.shiftKey ? 0.15 : 0.05);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        adjustSize(selected, event.shiftKey ? -0.15 : -0.05);
      }
      return;
    }
    if (mode !== 'move') return;
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

  // 圆点跟随选中元素，滚动或改窗口大小时重新定位
  function syncHandle() {
    if (!selected || mode !== 'size') {
      handle.hidden = true;
      return;
    }
    const rect = selected.getBoundingClientRect();
    handle.hidden = false;
    handle.style.left = `${rect.right - 7}px`;
    handle.style.top = `${rect.bottom - 7}px`;
  }

  window.addEventListener('scroll', syncHandle, { passive: true });
  window.addEventListener('resize', syncHandle);

  // 问卷、推荐这类页面会不断重渲染，节点换掉后把改动重新贴上去
  let reapplyTimer = 0;
  const observer = new MutationObserver(() => {
    if (applying) return;
    clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(() => {
      applySaved();
      if (mode === 'text') attachTextTargets();
    }, 120);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function select(el) {
    if (selected === el) {
      syncHandle();
      return;
    }
    if (selected) selected.classList.remove('pe-selected');
    selected = el;
    selected.classList.add('pe-selected');
    handle.hidden = mode !== 'size';
    syncHandle();
    renderList();
  }

  function selectParent() {
    if (!selected) return;
    const parent = selected.parentElement;
    if (!parent || parent === document.body || parent.closest(SKIP_SELECTOR)) return;
    select(parent);
  }

  function offsetOf(el) {
    return store.offset[cssPath(el)] || { x: 0, y: 0 };
  }

  function sizeOf(el) {
    return store.size[cssPath(el)] || null;
  }

  function applyTransform(el) {
    const offset = offsetOf(el);
    const size = sizeOf(el);
    const scale = size && size.kind === 'scale' ? size.value : 1;
    el.style.transform = `translate(${offset.x.toFixed(3)}em, ${offset.y.toFixed(3)}em) scale(${scale.toFixed(3)})`;
    el.dataset.peEdited = '1';
  }

  function setOffset(el, x, y) {
    store.offset[cssPath(el)] = { x, y };
    applyTransform(el);
  }

  function setScale(el, scale) {
    store.size[cssPath(el)] = { kind: 'scale', value: scale };
    applyTransform(el);
  }

  function setFontSize(el, em) {
    const value = Math.min(4, Math.max(0.4, em));
    el.style.fontSize = `${value.toFixed(3)}em`;
    el.dataset.peEdited = '1';
    store.size[cssPath(el)] = { kind: 'font', value };
  }

  function adjustSize(el, delta) {
    const size = sizeOf(el);
    if (TEXT_TAGS.has(el.tagName)) {
      const parentFont = parseFloat(getComputedStyle(el.parentElement).fontSize) || 16;
      const current = size && size.kind === 'font'
        ? size.value
        : parseFloat(getComputedStyle(el).fontSize) / parentFont;
      setFontSize(el, current + delta);
    } else {
      const current = size && size.kind === 'scale' ? size.value : 1;
      setScale(el, Math.min(2.6, Math.max(0.35, current + delta)));
    }
    save();
    syncHandle();
    renderList();
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
        <button type="button" data-mode="size">大小</button>
      </div>
      <p class="pe-hint"></p>
      <button type="button" class="pe-up" data-act="parent">↑ 选上一层</button>
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
        return;
      }
      const action = event.target.closest('[data-act]')?.dataset.act;
      if (action === 'export') exportJson();
      if (action === 'parent') selectParent();
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
      const size = sizeOf(selected);
      const detail = size
        ? size.kind === 'font'
          ? `字号 ×${size.value.toFixed(2)}`
          : `缩放 ×${size.value.toFixed(2)}`
        : '选中';
      items.push({ selector: cssPath(selected), label: detail });
    }
    list.innerHTML = items
      .slice(0, 6)
      .map((item) => `<li title="${escapeAttr(item.selector)}">${item.label} · ${escapeAttr(item.selector.slice(-40))}</li>`)
      .join('') || '<li class="pe-empty">还没有改动</li>';
  }

  async function exportJson() {
    const output = panel.querySelector('.pe-output');
    const payload = {
      page: location.pathname,
      text: store.text,
      offset: store.offset,
      size: store.size,
    };
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
    store.size = {};
    localStorage.removeItem(STORE_PREFIX + location.pathname);
    document.querySelectorAll('[data-pe-edited]').forEach((el) => {
      el.style.transform = '';
      el.style.fontSize = '';
      delete el.dataset.peEdited;
      el.classList.remove('pe-selected');
    });
    selected = null;
    handle.hidden = true;
    renderList();
    save();
    toast('已重置这个页面的改动');
  }

  function applySaved() {
    applying = true;
    try {
      Object.entries(store.text || {}).forEach(([selector, html]) => {
        const el = document.querySelector(selector);
        if (el && el.innerHTML !== html) el.innerHTML = html;
      });
      const merged = new Set([
        ...Object.keys(store.offset || {}),
        ...Object.keys(store.size || {}),
      ]);
      merged.forEach((selector) => {
        const el = document.querySelector(selector);
        if (!el) return;
        const size = store.size?.[selector];
        if (size && size.kind === 'font') {
          el.style.fontSize = `${size.value.toFixed(3)}em`;
          el.dataset.peEdited = '1';
          return;
        }
        const offset = store.offset?.[selector] || { x: 0, y: 0 };
        const scale = size && size.kind === 'scale' ? size.value : 1;
        el.style.transform = `translate(${offset.x.toFixed(3)}em, ${offset.y.toFixed(3)}em) scale(${scale.toFixed(3)})`;
        el.dataset.peEdited = '1';
      });
    } finally {
      applying = false;
    }
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

  function buildHandle() {
    const el = document.createElement('div');
    el.className = 'pe-handle';
    el.hidden = true;
    el.title = '拖动缩放';
    return el;
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
      body.pe-moving [contenteditable] { cursor: default; }
      body.pe-moving *, body.pe-sizing * { user-select: none; }
      body.pe-sizing .pe-selected { cursor: nwse-resize; }
      .pe-handle {
        position: fixed; z-index: 96; width: 14px; height: 14px; border-radius: 50%;
        background: #fffdf9; border: 2px solid #a94a24; cursor: nwse-resize;
        box-shadow: 0 1px 5px rgba(27, 24, 21, 0.28); touch-action: none;
      }
      .pe-handle::after {
        content: ""; position: absolute; inset: 3px; border-radius: 50%; background: #a94a24;
      }
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
      .pe-up {
        display: inline-block; margin: 0 0 8px; padding: 3px 9px; border-radius: 6px;
        border: 1px solid #d9d0c0; background: #fff; color: #7d746a; font-size: 11px; cursor: pointer;
      }
      .pe-up:hover { border-color: #a94a24; color: #a94a24; }
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

