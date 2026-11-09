/**
 * 共享 UI 组件：导航、卡片、匹配度环、提示条。
 * 不依赖任何框架，全部原生 DOM，减少国内网络下的外部依赖风险。
 */
const CATEGORY_TEXT = { A: '非遗手工', B: '讲座沙龙', C: '展览演出', D: '阅读借阅', E: '亲子活动', F: '少儿研学', G: '老年文娱', H: '公园空间' };
const PRICE_TEXT = { free: '免费', low: '50元以下', medium: '50-200元', high: '200元以上', unknown: '价格待定' };

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toast(message, kind = 'info') {
  let host = qs('#toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-visible'));
  setTimeout(() => {
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 300);
  }, 2600);
}

export function scoreRing(percent, size = 72) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, percent)) / 100) * circumference;
  return `
    <svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="匹配度 ${percent}%">
      <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="var(--ring-track)" stroke-width="6"></circle>
      <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="var(--ring-fill)" stroke-width="6"
        stroke-linecap="round" stroke-dasharray="${filled} ${circumference}" transform="rotate(-90 ${size / 2} ${size / 2})"></circle>
      <text x="50%" y="50%" text-anchor="middle" dy="0.36em" class="ring-text">${percent}</text>
    </svg>`;
}

export function renderTopbar(active = '') {
  const host = qs('#topbar');
  if (!host) return;
  const items = [
    { id: 'home', href: 'index.html', label: '首页' },
    { id: 'survey', href: 'survey.html', label: '开始问卷' },
    { id: 'recommend', href: 'recommend.html', label: '我的推荐' },
    { id: 'admin', href: 'admin.html', label: '管理员' },
  ];
  host.innerHTML = `
    <div class="topbar-inner">
      <a class="brand" href="index.html" aria-label="文享智配首页">
        <span class="brand-mark" aria-hidden="true">文</span>
        <span class="brand-text"><strong>文享智配</strong><small>西安公共文化 · 智能匹配</small></span>
      </a>
      <nav class="topnav" aria-label="主导航">
        ${items.map((item) => `<a href="${item.href}" class="${item.id === active ? 'is-active' : ''}">${item.label}</a>`).join('')}
      </nav>
    </div>`;
}

export function renderFooter(dataset) {
  const host = qs('#footer');
  if (!host) return;
  const date = dataset?.generatedAt ? new Date(dataset.generatedAt) : null;
  const stamp = date && !Number.isNaN(date.getTime())
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : '—';
  const counts = new Map();
  for (const activity of dataset?.activities || []) {
    if (!activity.source) continue;
    counts.set(activity.source, (counts.get(activity.source) || 0) + 1);
  }
  const sources = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const sourceText = sources.length
    ? `${sources.slice(0, 6).join(' / ')}${sources.length > 6 ? ' 等' : ''}`
    : '—';
  host.innerHTML = `
    <div class="footer-inner">
      <p><strong>文享智配</strong> · 西安公共文化需求匹配平台</p>
      <p class="muted">数据来源：${escapeHtml(sourceText)} · 活动 ${dataset?.count ?? '—'} 条 · 更新于 ${stamp}</p>
      <p class="muted">活动数据由采集与 AI 语义标注流水线生成，按需更新；画像与问卷默认只保存在你的浏览器本地。</p>
    </div>`;
}

export function priceText(activity) {
  if (activity.price_level === 'free') return '免费';
  if (activity.price_text) return activity.price_text;
  return PRICE_TEXT[activity.price_level] || '价格待定';
}

export function categoryText(activity) {
  const codes = activity.tags?.categories || [];
  if (codes.length) return codes.map((code) => CATEGORY_TEXT[code]).filter(Boolean).join(' · ');
  return activity.category_text || '文化活动';
}

function dimensionRows(rec) {
  const dims = rec.dims || {};
  const labels = [
    ['type', '兴趣类型'],
    ['demand', '核心需求'],
    ['time', '时间可达'],
    ['price', '预算匹配'],
    ['transport', '交通便利'],
    ['quality', '信息质量'],
  ];
  return labels
    .map(([key, label]) => {
      const value = Math.round((dims[key] ?? 0.5) * 100);
      return `<div class="dim-row"><span>${label}</span><div class="dim-track"><i style="width:${value}%"></i></div><b>${value}</b></div>`;
    })
    .join('');
}

export function activityCard(rec, options = {}) {
  const activity = rec.activity;
  const percent = rec.percent ?? Math.round((rec.score || 0) * 100);
  const reasons = (rec.reasons || [])
    .map((reason) => `<span class="chip chip-soft">${escapeHtml(reason.text)}</span>`)
    .join('');
  const warnings = (rec.penalties || [])
    .slice(0, 2)
    .map((item) => `<span class="chip chip-warn">${escapeHtml(item.text)}</span>`)
    .join('');
  const article = document.createElement('article');
  article.className = 'rec-card';
  article.dataset.id = activity.id;
  article.style.setProperty('--delay', `${(options.index || 0) * 60}ms`);

  const link = activity.link && activity.link !== '无'
    ? `<a class="btn btn-ghost" href="${escapeHtml(activity.link)}" target="_blank" rel="noopener">查看详情 ↗</a>`
    : '';

  article.innerHTML = `
    <div class="rec-score">
      ${scoreRing(percent)}
      <span class="rec-score-label">${escapeHtml(options.label || '')}</span>
    </div>
    <div class="rec-body">
      <header class="rec-head">
        <h3>${escapeHtml(activity.name)}</h3>
        <p class="rec-meta">
          <span>${escapeHtml(categoryText(activity))}</span>
          <span>${escapeHtml(activity.district || '西安')}</span>
          <span class="price-tag ${activity.price_level === 'free' ? 'is-free' : ''}">${escapeHtml(priceText(activity))}</span>
        </p>
      </header>
      <p class="rec-summary">${escapeHtml(activity.summary || activity.highlights || '暂无简介')}</p>
      ${rec.aiReason ? `<p class="rec-ai"><span class="ai-badge">AI 推荐理由</span>${escapeHtml(rec.aiReason)}</p>` : ''}
      <div class="chip-row">${reasons}${warnings}</div>
      <details class="rec-detail">
        <summary>为什么是它？</summary>
        <div class="dim-list">${dimensionRows(rec)}</div>
        <dl class="rec-facts">
          <dt>地址</dt><dd>${escapeHtml(activity.address || '—')}</dd>
          <dt>时间</dt><dd>${escapeHtml(activity.time_text || '—')}</dd>
          <dt>费用</dt><dd>${escapeHtml(activity.price_text || PRICE_TEXT[activity.price_level] || '—')}</dd>
          <dt>适合</dt><dd>${escapeHtml((activity.tags?.audience || []).join(' / ') || '—')}</dd>
          <dt>来源</dt><dd>${escapeHtml(activity.source || '—')}</dd>
        </dl>
      </details>
      <footer class="rec-foot">
        <div class="rec-actions">
          <button type="button" class="btn btn-like" data-action="like" aria-pressed="false">👍 感兴趣</button>
          <button type="button" class="btn btn-dislike" data-action="dislike" aria-pressed="false">不太合适</button>
        </div>
        ${link}
      </footer>
    </div>`;
  return article;
}

export function emptyState(title, description, actionHtml = '') {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${actionHtml}</div>`;
}

export function statCard(label, value, hint = '') {
  return `<div class="stat-card"><span class="stat-label">${escapeHtml(label)}</span><strong class="stat-value">${escapeHtml(String(value))}</strong>${hint ? `<span class="stat-hint">${escapeHtml(hint)}</span>` : ''}</div>`;
}

// 可视化编辑模式：?edit=1 临时开，或在本机把「编辑态」常开（edit.html 里切换）
const editorForcedByUrl = new URLSearchParams(location.search).has('edit');
let editorAlwaysOn = false;
try {
  editorAlwaysOn = localStorage.getItem('wenxiang.editor') === '1';
} catch {
  editorAlwaysOn = false;
}
if (!document.body.hasAttribute('data-no-editor') && (editorForcedByUrl || editorAlwaysOn)) {
  import('./page-editor.js');
}