import { AGES, CATEGORIES, COMFORTS, DEMANDS, EDUCATIONS, FACTORS, INCOME, LIVING, OCCUPATIONS, TIME_SLOTS, TRAFFIC, labelOf } from '../taxonomy.js';
import { exportAll, importAll, listResponses, resetAll } from '../store.js';
import { fetchResponses, probe } from '../cloud.js';
import { renderFooter, renderTopbar, escapeHtml, statCard, toast } from '../ui.js';
import { loadDataset } from '../data.js';

renderTopbar('admin');

const DIMENSIONS = [
  { key: 'age', field: 'age', pilot: 'age_group', label: '年龄', table: AGES, multi: false },
  { key: 'education', field: 'education', pilot: 'education', label: '学历', table: EDUCATIONS, multi: false },
  { key: 'occupation', field: 'occupation', pilot: 'occupation', label: '职业', table: OCCUPATIONS, multi: false },
  { key: 'income', field: 'income', pilot: 'income', label: '月收入', table: INCOME, multi: false },
  { key: 'living', field: 'living', pilot: 'living_years', label: '在西安生活时长', table: LIVING, multi: false },
  { key: 'actTypes', field: 'actTypes', pilot: 'activity_type', label: '感兴趣的活动类型', table: CATEGORIES, multi: true },
  { key: 'demand', field: 'demand', pilot: 'core_demand', label: '核心需求', table: DEMANDS, multi: false },
  { key: 'comfort', field: 'comfort', pilot: 'comfort_type', label: '偏好空间', table: COMFORTS, multi: false },
  { key: 'focus', field: 'focus', pilot: 'focus_factor', label: '最看重的因素', table: FACTORS, multi: false },
  { key: 'time', field: 'time', pilot: 'available_time', label: '可参与时间', table: TIME_SLOTS, multi: false },
  { key: 'traffic', field: 'traffic', pilot: 'traffic_type', label: '主要交通方式', table: TRAFFIC, multi: false },
];

const state = {
  scope: 'live',
  local: [],
  cloud: [],
  pilot: null,
  cloudAvailable: false,
};

const el = {
  tabs: document.querySelectorAll('.tabs button'),
  statGrid: document.querySelector('#stat-grid'),
  insights: document.querySelector('#insights'),
  charts: document.querySelector('#charts'),
  chartSub: document.querySelector('#chart-sub'),
  records: document.querySelector('#records'),
  modeNote: document.querySelector('#mode-note'),
  liveCount: document.querySelector('#live-count'),
  pilotCount: document.querySelector('#pilot-count'),
};

/* ------------------------------------------------------------------ 统计 */

function countValues(records, dimension) {
  const counter = new Map();
  for (const record of records) {
    const profile = record.profile || record;
    const raw = profile[dimension.field];
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const value of values) {
      counter.set(value, (counter.get(value) || 0) + 1);
    }
  }
  return counter;
}

function distributions(records) {
  const result = {};
  for (const dimension of DIMENSIONS) {
    result[dimension.key] = countValues(records, dimension);
  }
  return result;
}

function pilotDistributions() {
  if (!state.pilot) return null;
  const result = {};
  for (const dimension of DIMENSIONS) {
    const raw = state.pilot.distributions?.[dimension.pilot] || {};
    result[dimension.key] = new Map(Object.entries(raw));
  }
  return result;
}

function activeRecords() {
  if (state.scope === 'live') return state.local;
  return [];
}

function activeDistributions() {
  if (state.scope === 'pilot') return pilotDistributions() || {};
  return distributions(state.local);
}

function topEntry(map, table) {
  let best = null;
  for (const [code, count] of map.entries()) {
    if (!best || count > best.count) best = { code, count, label: labelOf(table, code) };
  }
  return best;
}

/* ------------------------------------------------------------------ 渲染 */

function renderSummary() {
  if (state.scope === 'pilot') {
    const n = state.pilot?.n || 0;
    el.statGrid.innerHTML = [
      statCard('样本量', n, state.pilot?.label || ''),
      statCard('数据来源', '历史基线', '仅聚合统计'),
      statCard('统计维度', DIMENSIONS.length, '年龄/兴趣/时间…'),
      statCard('含个人信息', '0', '无个人记录'),
    ].join('');
    return;
  }

  const records = state.local;
  const dist = distributions(records);
  const age = topEntry(dist.age, AGES);
  const type = topEntry(dist.actTypes, CATEGORIES);
  const focus = topEntry(dist.focus, FACTORS);
  el.statGrid.innerHTML = [
    statCard('有效问卷', records.length, records.length ? '本机 + 云端' : '还没有记录'),
    statCard('主力年龄段', age ? age.label : '—', age ? `${age.count} 人` : ''),
    statCard('最热活动类型', type ? type.label : '—', type ? `${type.count} 次提及` : ''),
    statCard('最看重', focus ? focus.label : '—', focus ? `${focus.count} 人` : ''),
  ].join('');
}

function renderInsights() {
  const dist = activeDistributions();
  const total = state.scope === 'pilot' ? state.pilot?.n || 0 : state.local.length;
  const insights = [];
  if (!total) {
    el.insights.innerHTML = '<li>还没有数据。先完成一份问卷，或切换到「试点基线」查看历史样本。</li>';
    return;
  }

  const pct = (count) => Math.round((count / Math.max(1, total)) * 100);
  const age = topEntry(dist.age || new Map(), AGES);
  if (age) insights.push(`样本以「${age.label}」为主，占 ${pct(age.count)}%（${age.count} 人）。`);

  const types = dist.actTypes || new Map();
  const sortedTypes = [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (sortedTypes.length) {
    insights.push(
      `兴趣最集中在 ${sortedTypes.map(([code, count]) => `${labelOf(CATEGORIES, code)}（${pct(count)}%）`).join('、')}。`,
    );
  }

  const focus = topEntry(dist.focus || new Map(), FACTORS);
  if (focus) insights.push(`选择活动时最看重「${focus.label}」的人最多（${focus.count} 人）。`);

  const traffic = topEntry(dist.traffic || new Map(), TRAFFIC);
  if (traffic) insights.push(`主要出行方式是「${traffic.label}」，推荐排序已按此调整可达性权重。`);

  const comfort = topEntry(dist.comfort || new Map(), COMFORTS);
  if (comfort) insights.push(`空间偏好以「${comfort.label}」为主，可作为供给侧的选址参考。`);

  if (total < 10) insights.push('样本量小于 10，以上比例波动较大，建议继续收集后再对外引用。');
  el.insights.innerHTML = insights.map((text) => `<li>${escapeHtml(text)}</li>`).join('');
}

function barRow(label, count, total, jade = false) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return `
    <div class="bar-row">
      <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <div class="bar-track"><div class="bar-fill ${jade ? 'is-jade' : ''}" style="width:${percent}%"></div></div>
      <b>${count} · ${percent}%</b>
    </div>`;
}

function renderCharts() {
  const dist = activeDistributions();
  const total = state.scope === 'pilot' ? state.pilot?.n || 0 : state.local.length;
  el.chartSub.textContent = total
    ? `当前样本 ${total} 份；多选题按「提及次数」统计，百分比为提及率。`
    : '还没有数据。';

  el.charts.innerHTML = DIMENSIONS.map((dimension) => {
    const counter = dist[dimension.key];
    if (!counter || !counter.size) {
      return `<div><h4 style="font-family:var(--sans);font-size:.92rem;margin:0 0 .6rem">${dimension.label}</h4><p class="small muted">暂无数据</p></div>`;
    }
    const rows = [...counter.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([code, count]) => barRow(labelOf(dimension.table, code), count, Math.max(1, total), dimension.key === 'actTypes'))
      .join('');
    return `<div><h4 style="font-family:var(--sans);font-size:.92rem;margin:0 0 .6rem">${dimension.label}</h4>${rows}</div>`;
  }).join('');
}

function renderRecords() {
  if (state.scope === 'pilot') {
    el.records.innerHTML = '<p class="small muted">历史试点数据仅提供聚合结果，不保留逐条记录。</p>';
    return;
  }
  const records = [...state.local].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (!records.length) {
    el.records.innerHTML = '<p class="small muted">暂无记录。</p>';
    return;
  }
  const rows = records
    .slice(0, 50)
    .map((record, index) => {
      const profile = record.profile || {};
      const when = record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '—';
      return `<tr>
        <td>${index + 1}</td>
        <td class="mono small">${escapeHtml(when)}</td>
        <td>${escapeHtml(labelOf(AGES, profile.age))}</td>
        <td>${escapeHtml((Array.isArray(profile.actTypes) ? profile.actTypes : []).map((code) => labelOf(CATEGORIES, code)).join(' / ') || '—')}</td>
        <td>${escapeHtml(labelOf(FACTORS, profile.focus))}</td>
        <td>${escapeHtml(labelOf(TIME_SLOTS, profile.time))}</td>
      </tr>`;
    })
    .join('');
  el.records.innerHTML = `
    <table class="table">
      <thead><tr><th>#</th><th>填写时间</th><th>年龄</th><th>兴趣类型</th><th>最看重</th><th>时间</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${records.length > 50 ? `<p class="small muted" style="margin-top:.6rem">仅显示最近 50 条，完整数据请导出。</p>` : ''}`;
}

function renderAll() {
  el.liveCount.textContent = `(${state.local.length})`;
  el.pilotCount.textContent = `(${state.pilot?.n ?? '—'})`;
  renderSummary();
  renderInsights();
  renderCharts();
  renderRecords();
  el.modeNote.textContent = state.cloudAvailable
    ? `已连接后端：云端 ${state.cloud.length} 条 + 本机 ${listResponses().length} 条。`
    : '当前为纯前端模式：数据只保存在这台浏览器，换设备/清缓存会丢失。接入 backend/ 后可跨设备汇总。';
}

/* ------------------------------------------------------------------ 数据源 */

el.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.scope = tab.dataset.scope;
    el.tabs.forEach((node) => node.setAttribute('aria-selected', String(node === tab)));
    renderAll();
  });
});

/* ------------------------------------------------------------------ 导入导出 */

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsv(records) {
  const header = ['填写时间', ...DIMENSIONS.map((dimension) => dimension.label)];
  const lines = [header.join(',')];
  for (const record of records) {
    const profile = record.profile || {};
    const cells = DIMENSIONS.map((dimension) => {
      const raw = profile[dimension.field];
      const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return values.map((code) => labelOf(dimension.table, code)).join(' / ');
    });
    lines.push([record.created_at || '', ...cells].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','));
  }
  return '\ufeff' + lines.join('\n');
}

document.querySelector('#btn-csv').addEventListener('click', () => {
  if (!state.local.length) return toast('还没有可导出的记录', 'error');
  download(`wenxiang-responses-${Date.now()}.csv`, toCsv(state.local), 'text/csv;charset=utf-8');
  toast('CSV 已导出', 'success');
});

document.querySelector('#btn-json').addEventListener('click', () => {
  download(`wenxiang-backup-${Date.now()}.json`, JSON.stringify(exportAll(), null, 2), 'application/json');
  toast('JSON 已导出', 'success');
});

document.querySelector('#btn-import').addEventListener('click', () => {
  document.querySelector('#file-input').click();
});

document.querySelector('#file-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    importAll(payload);
    state.local = listResponses();
    renderAll();
    toast('导入成功', 'success');
  } catch (error) {
    toast(`导入失败：${error.message}`, 'error');
  } finally {
    event.target.value = '';
  }
});

document.querySelector('#btn-clear').addEventListener('click', () => {
  if (!window.confirm('确定清空这台浏览器里的问卷记录和画像吗？此操作不可恢复。')) return;
  resetAll();
  state.local = [];
  renderAll();
  toast('已清空本机数据', 'success');
});

document.querySelector('#btn-print').addEventListener('click', () => {
  window.print();
});

document.querySelector('#btn-refresh').addEventListener('click', async () => {
  const result = await fetchResponses();
  state.cloudAvailable = result.available;
  state.cloud = result.responses || [];
  renderAll();
  toast(result.available ? `云端同步了 ${state.cloud.length} 条` : '未检测到后端，继续使用本地数据', result.available ? 'success' : 'info');
});

/* ------------------------------------------------------------------ 启动 */

async function bootstrap() {
  try {
    const [pilotResponse, dataset, status] = await Promise.all([
      fetch('data/pilot.json').then((response) => (response.ok ? response.json() : null)).catch(() => null),
      loadDataset().catch(() => null),
      probe(),
    ]);
    state.pilot = pilotResponse;
    state.cloudAvailable = status.available;
    if (status.available) {
      const result = await fetchResponses();
      state.cloud = result.responses || [];
    }
    state.local = mergeLocalAndCloud(listResponses(), state.cloud);
    renderFooter(dataset);
    renderAll();
  } catch (error) {
    console.error(error);
    toast('管理页数据加载失败', 'error');
  }
}

function mergeLocalAndCloud(local, cloud) {
  const byId = new Map();
  for (const record of [...cloud, ...local]) {
    if (record?.id) byId.set(record.id, record);
  }
  return [...byId.values()];
}

bootstrap();
