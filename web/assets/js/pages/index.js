import { loadDataset } from '../data.js';
import { renderTopbar, renderFooter, toast } from '../ui.js';
import { getProfile } from '../store.js';

renderTopbar('home');

const recommendCta = document.querySelector('#cta-recommend');
if (getProfile()) {
  recommendCta.textContent = '继续我的推荐 →';
  recommendCta.classList.add('btn-ink');
}

loadDataset()
  .then((dataset) => {
    const sources = new Set(dataset.activities.map((item) => item.source).filter(Boolean));
    document.querySelector('#stat-activities').textContent = dataset.count;
    document.querySelector('#stat-sources').textContent = sources.size;
    const note = document.querySelector('#dataset-note');
    const date = dataset.generatedAt ? new Date(dataset.generatedAt) : null;
    note.textContent = date
      ? `数据更新于 ${date.toLocaleDateString('zh-CN')} · 共 ${dataset.count} 条`
      : `共 ${dataset.count} 条`;
    renderFooter(dataset);
  })
  .catch((error) => {
    renderFooter(null);
    toast('活动数据加载失败，请检查 data/activities.json', 'error');
    console.error(error);
  });
