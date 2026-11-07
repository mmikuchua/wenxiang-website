/**
 * 活动数据集加载。
 *
 * 数据由 MyXianSpiderBot 的流水线生成（爬取 → LLM 语义打标 → activities.json），
 * 前端只负责按画像匹配，不在浏览器里调用任何外部 API。
 */
let cache = null;

export async function loadDataset(url = 'data/activities.json') {
  if (cache) return cache;
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`活动数据加载失败（HTTP ${response.status}），请先运行数据流水线生成 web/data/activities.json`);
  }
  const payload = await response.json();
  const activities = (payload.activities || []).filter((item) => item && item.name);
  cache = {
    meta: payload.meta || {},
    generatedAt: payload.generated_at || '',
    count: activities.length,
    activities,
  };
  return cache;
}

export function datasetSummary(dataset) {
  if (!dataset) return '';
  const sources = new Set(dataset.activities.map((item) => item.source).filter(Boolean));
  const date = dataset.generatedAt ? new Date(dataset.generatedAt) : null;
  const stamp = date && !Number.isNaN(date.getTime())
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : '未知';
  return `${dataset.count} 个活动 · ${sources.size} 个来源 · 更新于 ${stamp}`;
}
