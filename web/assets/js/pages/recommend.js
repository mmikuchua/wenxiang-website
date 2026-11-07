import { loadDataset } from '../data.js';
import { matchLabel, rankActivities, scoreActivity, computeAffinity, summarizeProfile, toPercent } from '../engine.js';
import { parseQuery, mergeProfile, QUERY_EXAMPLES } from '../intent.js';
import { getFeedback, getProfile, markSeen, setFeedback } from '../store.js';
import { probe, chat } from '../cloud.js';
import { activityCard, emptyState, renderFooter, renderTopbar, toast } from '../ui.js';

renderTopbar('recommend');

const el = {
  intro: document.querySelector('#intro'),
  profileBar: document.querySelector('#profile-bar'),
  list: document.querySelector('#rec-list'),
  meta: document.querySelector('#result-meta'),
  form: document.querySelector('#lookup-form'),
  input: document.querySelector('#lookup-input'),
  clear: document.querySelector('#lookup-clear'),
  mode: document.querySelector('#lookup-mode'),
  examples: document.querySelector('#example-chips'),
  shuffle: document.querySelector('#btn-shuffle'),
  applyFeedback: document.querySelector('#btn-apply-feedback'),
};

const profile = getProfile();
const state = {
  dataset: null,
  shown: new Set(),
  query: null,
  parsed: null,
  cloudMode: false,
  llmMode: false,
  feedbackDirty: false,
  llmItems: null, // 云端 AI 返回的排序结果
};

if (!profile) {
  document.body.classList.add('no-profile');
  el.intro.innerHTML = '还没有你的文化画像。完成 11 道题后，这里会给出按你偏好排序的活动。';
  el.profileBar.innerHTML = '<a class="btn btn-primary" href="survey.html">先去填写问卷 →</a>';
  el.list.innerHTML = emptyState(
    '还没有画像',
    '推荐需要先知道你的年龄、可支配时间、预算和兴趣。约 90 秒，全部选择按钮。',
    '<a class="btn btn-primary" href="survey.html">开始问卷</a>',
  );
  el.shuffle.disabled = true;
  el.form.querySelector('button[type="submit"]').disabled = true;
} else {
  el.intro.textContent = '根据你的年龄段、空闲时间、预算与兴趣，从活动库中挑出匹配度最高的几个，并说明理由。';
  el.profileBar.innerHTML = summarizeProfile(profile)
    .map((chip) => `<span class="profile-chip"><b>${chip.label}</b>${chip.value}</span>`)
    .join('') + '<a class="profile-chip" href="survey.html?reset=1">重新填写 ↘</a>';
}

el.examples.innerHTML = QUERY_EXAMPLES.map(
  (example) => `<button type="button" class="example-chip">${example}</button>`,
).join('');
el.examples.addEventListener('click', (event) => {
  const button = event.target.closest('.example-chip');
  if (!button) return;
  el.input.value = button.textContent;
  el.form.requestSubmit();
});

/* ------------------------------------------------------------------ 渲染 */

function renderCards(items, meta = {}) {
  el.list.innerHTML = '';
  if (!items.length) {
    el.list.innerHTML = emptyState(
      '暂时没有合适的活动',
      '试试放宽条件：换一批、清除描述，或者重新填写问卷。',
      '<a class="btn btn-ghost" href="survey.html?reset=1">重新填写问卷</a>',
    );
    return;
  }
  const fragment = document.createDocumentFragment();
  items.forEach((rec, index) => {
    const card = activityCard(
      { ...rec, percent: rec.percent ?? toPercent(rec.score), label: rec.label },
      { index, label: matchLabel(rec.percent ?? toPercent(rec.score)) },
    );
    const feedback = getFeedback()[rec.activity.id];
    if (feedback) {
      const selector = feedback.liked ? '[data-action="like"]' : '[data-action="dislike"]';
      const button = card.querySelector(selector);
      if (button) button.setAttribute('aria-pressed', 'true');
    }
    fragment.appendChild(card);
  });
  el.list.appendChild(fragment);
  markSeen(items.map((rec) => rec.activity.id));

  const avg = Math.round(items.reduce((sum, rec) => sum + (rec.percent ?? toPercent(rec.score)), 0) / items.length);
  el.meta.textContent =
    meta.label ||
    `${meta.pool ? `从 ${meta.pool} 个可用活动中` : ''}选出 ${items.length} 个 · 平均匹配度 ${avg}%${state.query ? ' · 已按你的描述调整' : ''}`;
}

function renderLocal() {
  const affinity = computeAffinity(getFeedback());
  const mergedProfile = state.parsed ? mergeProfile(profile, state.parsed) : profile;
  const { items, stats } = rankActivities(mergedProfile, state.dataset.activities, {
    limit: 8,
    exclude: [...state.shown],
    affinity,
    query: state.query ? { terms: state.query.terms } : null,
  });
  renderCards(items, stats);
}

function renderLlm(items) {
  renderCards(items, { pool: state.dataset.count });
}

/* ------------------------------------------------------------------ 主流程 */

async function refresh({ shuffle = false } = {}) {
  if (!profile) return;
  if (shuffle) {
    el.list.querySelectorAll('.rec-card').forEach((card) => state.shown.add(card.dataset.id));
    if (state.dataset.activities.length - state.shown.size < 4) {
      state.shown.clear();
      toast('已经翻完一轮，从头再来', 'info');
    }
  }

  const status = await probe();
  state.cloudMode = status.available;
  state.llmMode = !!status.llm;
  el.mode.textContent = state.cloudMode
    ? status.llm
      ? '已连接云端：可以用自然语言提问，由 AI 顾问理解后排序。'
      : '已连接云端（未配置 AI 顾问），使用本地智能匹配。'
    : '本地模式：画像与数据都在你的浏览器里，不上传服务器。自然语言会在本地解析。';

  if (state.query && state.cloudMode && state.llmMode) {
    el.meta.textContent = 'AI 顾问正在阅读你的描述并从活动库中挑选…';
    el.list.innerHTML = '<div class="loading">AI 顾问正在阅读你的描述…通常需要 3–8 秒</div>';
    const reply = await chat([{ role: 'user', content: buildUserMessage(state.query.raw) }]);
    if (reply.text) {
      const byId = new Map(state.dataset.activities.map((activity) => [activity.id, activity]));
      const picks = (reply.items?.length ? reply.items : [])
        .map((item) => ({ activity: byId.get(item.id), reason: item.reason || item.why }))
        .filter((item) => item.activity)
        .slice(0, 8);
      const fallbackIds = reply.ids && reply.ids.length ? reply.ids : extractIds(reply.text);
      const finalPicks = picks.length
        ? picks
        : fallbackIds.map((id) => ({ activity: byId.get(id), reason: '' })).filter((item) => item.activity);
      if (finalPicks.length) {
        const mergedProfile = state.parsed ? mergeProfile(profile, state.parsed) : profile;
        const affinity = computeAffinity(getFeedback());
        state.llmItems = finalPicks
          .map(({ activity, reason }) => {
            const result = scoreActivity(mergedProfile, activity, { affinity });
            return {
              activity,
              score: result.score,
              dims: result.dims,
              reasons: result.reasons.slice(0, 2),
              aiReason: reason || '',
              penalties: result.penalties,
            };
          })
          .sort((a, b) => b.score - a.score);
        let previous = 100;
        state.llmItems = state.llmItems.map((item) => {
          const percent = Math.min(previous, toPercent(item.score));
          previous = percent;
          return { ...item, percent };
        });
        renderCards(state.llmItems, {
          label: `AI 顾问从 ${state.dataset.count} 个活动中选出 ${state.llmItems.length} 个 · ${escapeText(reply.text).slice(0, 46)}`,
        });
        return;
      }
      toast('AI 顾问这次没给出具体活动，已切回本地排序', 'info');
    }
    if (reply.error) toast(`AI 顾问暂时不可用：${reply.error}，已切回本地匹配`, 'error');
  }

  renderLocal();
}

function escapeText(text) {
  return String(text || '').replace(/[<>&]/g, '');
}

function extractIds(text) {
  return [...String(text).matchAll(/act-[0-9a-f]{10}/g)].map((match) => match[0]);
}

function buildUserMessage(question) {
  const chips = summarizeProfile(profile).map((chip) => `${chip.label}:${chip.value}`).join('；');
  return `画像：${chips}\n需求：${question}\n可选活动：\n${state.dataset.activities
    .map((activity) => `${activity.id} | ${activity.name} | ${activity.district || ''} | ${(activity.tags?.themes || []).join('/')} | ${activity.price_level}`)
    .join('\n')}`;
}

/* ------------------------------------------------------------------ 事件 */

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!profile) return;
  const raw = el.input.value.trim();
  if (!raw) {
    state.query = null;
    state.parsed = null;
    state.shown.clear();
    el.clear.hidden = true;
    refresh();
    return;
  }
  state.parsed = parseQuery(raw);
  state.query = state.parsed;
  state.shown.clear();
  el.clear.hidden = false;
  if (state.parsed.chips.length) {
    toast(`已按描述调整：${state.parsed.chips.slice(0, 3).join('、')}`, 'success');
  }
  refresh();
});

el.clear.addEventListener('click', () => {
  el.input.value = '';
  state.query = null;
  state.parsed = null;
  state.shown.clear();
  state.llmItems = null;
  el.clear.hidden = true;
  refresh();
});

el.shuffle.addEventListener('click', () => refresh({ shuffle: true }));

el.list.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const card = button.closest('.rec-card');
  const activity = state.dataset.activities.find((item) => item.id === card.dataset.id);
  if (!activity) return;
  const liked = button.dataset.action === 'like';
  const feedback = setFeedback(activity, liked);
  const entry = feedback[activity.id];
  card.querySelectorAll('[data-action]').forEach((node) => node.setAttribute('aria-pressed', 'false'));
  if (entry) {
    button.setAttribute('aria-pressed', 'true');
    toast(liked ? '已记录：以后多推这类' : '已记录：以后少推这类', 'success');
  } else {
    toast('已取消标记', 'info');
  }
  state.feedbackDirty = true;
  el.applyFeedback.hidden = false;
});

el.applyFeedback.addEventListener('click', () => {
  state.feedbackDirty = false;
  el.applyFeedback.hidden = true;
  state.shown.clear();
  refresh();
});

/* ------------------------------------------------------------------ 启动 */

loadDataset()
  .then((dataset) => {
    state.dataset = dataset;
    renderFooter(dataset);
    if (!profile) return;
    refresh();
  })
  .catch((error) => {
    el.list.innerHTML = emptyState('活动数据未加载', error.message, '<a class="btn btn-ghost" href="index.html">返回首页</a>');
    console.error(error);
  });
