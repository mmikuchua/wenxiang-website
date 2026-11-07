/**
 * 推荐引擎（纯函数，无 DOM 依赖，可在 Node 里直接测试）。
 *
 * 相比旧版 `match_activities()` 的四点升级：
 * 1. 软约束替代硬过滤：年龄/时间/预算不再「一刀切」，而是加权 + 折扣，
 *    避免「筛完只剩 0 条」，同时保证真正不可行的活动排不到前面；
 * 2. 权重随画像变化：用户最看重的因素（focus）会动态提高对应维度权重，
 *    而不是所有人共用一组固定权重；
 * 3. MMR 多样性重排：前 8 条不会全是同一种展览；
 * 4. 可解释 + 可学习：每张卡片给出推荐理由；点赞/不喜欢会累积成标签亲和度，
 *    在后续推荐中生效（存在浏览器本地）。
 */
import { CENTRAL_DISTRICTS } from './taxonomy.js';

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const mean = (list) => (list.length ? list.reduce((sum, item) => sum + item, 0) / list.length : 0);

/** 收入档位对应的可接受票价上限（元），用于估算预算匹配度 */
export const BUDGET_CAP = { A: 50, B: 150, C: 300, D: 600 };

const BASE_WEIGHTS = {
  type: 1.0,
  demand: 0.85,
  comfort: 0.65,
  focus: 1.15,
  age: 0.9,
  time: 0.8,
  price: 0.7,
  transport: 0.55,
  culture: 0.35,
  environment: 0.3,
  quality: 0.5,
  personal: 0.4,
};

const FOCUS_WEIGHT_BOOST = {
  A: { culture: 0.7 },
  B: { transport: 0.75 },
  C: { price: 0.75 },
  D: { environment: 0.7 },
};

const PRICE_BY_LEVEL = { free: 1, low: 0.9, medium: 0.6, high: 0.3, unknown: 0.55 };

export function normalizeActivity(raw) {
  const tags = raw.tags || {};
  const scores = raw.scores || {};
  return {
    ...raw,
    id: raw.id || raw.name,
    tags: {
      categories: tags.categories || [],
      demand: tags.demand || [],
      comfort: tags.comfort || [],
      factors: tags.factors || [],
      age_fit: tags.age_fit || [],
      time_slots: tags.time_slots || [],
      themes: tags.themes || [],
      moods: tags.moods || [],
      audience: tags.audience || [],
    },
    scores: {
      culture: clamp01(scores.culture ?? 0.5),
      transport: clamp01(scores.transport ?? 0.5),
      environment: clamp01(scores.environment ?? 0.5),
      cost: clamp01(scores.cost ?? 0.5),
      family: clamp01(scores.family ?? 0.5),
      quiet: clamp01(scores.quiet ?? 0.5),
      social: clamp01(scores.social ?? 0.5),
      learning: clamp01(scores.learning ?? 0.5),
      quality: clamp01(scores.quality ?? 0.5),
    },
  };
}

export function isExpired(activity, now = Date.now()) {
  if (!activity.valid_end) return false;
  const end = Date.parse(activity.valid_end);
  return Number.isFinite(end) && end < now;
}

export function searchText(activity) {
  return [
    activity.name,
    activity.category_text,
    activity.summary,
    activity.highlights,
    activity.address,
    (activity.tags.themes || []).join(' '),
    (activity.tags.audience || []).join(' '),
    (activity.tags.moods || []).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/* ------------------------------------------------------------------ 单维度打分 */

function typeFit(profile, activity) {
  const selected = profile.actTypes || [];
  const categories = activity.tags.categories || [];
  if (!selected.length) return { value: 0.6, matched: [] };
  if (!categories.length) return { value: 0.45, matched: [] };
  const matched = selected.filter((code) => categories.includes(code));
  if (!matched.length) return { value: 0.18, matched: [] };
  return { value: clamp01(0.25 + (0.75 * matched.length) / selected.length), matched };
}

function demandFit(profile, activity) {
  if (!profile.demand) return 0.6;
  const demands = activity.tags.demand || [];
  if (demands.includes(profile.demand)) return 1;
  if (!demands.length) return 0.5;
  return 0.22;
}

function comfortFit(profile, activity) {
  if (!profile.comfort) return 0.6;
  const comforts = activity.tags.comfort || [];
  if (comforts.includes(profile.comfort)) return 1;
  if (!comforts.length) return 0.5;
  const isPublic = (code) => code === 'A' || code === 'B';
  const sameFamily = comforts.some((code) => isPublic(code) === isPublic(profile.comfort));
  return sameFamily ? 0.72 : 0.38;
}

function focusFit(profile, activity) {
  const { scores, tags } = activity;
  const factorHit = (code) => (tags.factors || []).includes(code);
  switch (profile.focus) {
    case 'A':
      return clamp01(0.6 * scores.culture + 0.4 * (factorHit('A') ? 1 : 0.45));
    case 'B':
      return clamp01(scores.transport);
    case 'C':
      return clamp01(0.65 * scores.cost + 0.35 * (factorHit('C') ? 1 : 0.5));
    case 'D':
      return clamp01(0.6 * scores.environment + 0.4 * (factorHit('D') ? 1 : 0.45));
    default:
      return 0.6;
  }
}

function ageFit(profile, activity) {
  if (!profile.age) return 0.7;
  const ages = activity.tags.age_fit || [];
  if (!ages.length) return 0.65;
  return ages.includes(profile.age) ? 1 : 0.28;
}

function timeFit(profile, activity) {
  if (!profile.time) return 0.7;
  if (profile.time === 'C') return 0.85;
  const slots = activity.tags.time_slots || [];
  if (!slots.length) return 0.55;
  return slots.includes(profile.time) ? 1 : 0.32;
}

export function priceFit(profile, activity) {
  const price = activity.price_from;
  const level = activity.price_level || 'unknown';
  if (!profile.income) return price === 0 || level === 'free' ? 1 : PRICE_BY_LEVEL[level] ?? 0.6;
  const budget = BUDGET_CAP[profile.income] || 150;
  if (price != null) {
    if (price <= 0) return 1;
    const ratio = price / budget;
    if (ratio <= 0.4) return 0.96;
    if (ratio <= 1) return 0.82;
    if (ratio <= 1.5) return 0.5;
    if (ratio <= 2.5) return 0.22;
    return 0.08;
  }
  return PRICE_BY_LEVEL[level] ?? 0.55;
}

function transportFit(profile, activity) {
  const base = activity.scores.transport;
  const district = activity.district || '';
  const central = CENTRAL_DISTRICTS.has(district);
  switch (profile.traffic) {
    case 'B': // 步行
      return clamp01(central ? 0.8 + 0.2 * base : 0.3 + 0.25 * base);
    case 'C': // 自行车
      return clamp01(central ? 0.78 + 0.22 * base : 0.42 + 0.3 * base);
    case 'A': // 公交
      return clamp01(0.35 + 0.65 * base);
    case 'D': {
      // 自驾：停车难会抵消一部分便利
      const parkingPenalty = profile.suppParking === 'yes' && central ? 0.15 : 0;
      return clamp01(0.4 + 0.6 * base - parkingPenalty);
    }
    default:
      return 0.6;
  }
}

export function personalFit(activity, affinity) {
  if (!affinity) return 0.5;
  const keys = [
    ...(activity.tags.categories || []).map((code) => `c:${code}`),
    ...(activity.tags.themes || []).map((theme) => `t:${theme}`),
    ...(activity.tags.audience || []).map((item) => `a:${item}`),
  ];
  if (!keys.length) return 0.5;
  const values = keys.map((key) => affinity[key]).filter((value) => Number.isFinite(value));
  if (!values.length) return 0.5;
  return clamp01(0.5 + 0.5 * mean(values));
}

/* --------------------------------------------------------------- 打分主函数 */

export function scoreActivity(profile, activity, options = {}) {
  const affinity = options.affinity || null;
  const query = options.query || null;

  const type = typeFit(profile, activity);
  const dims = {
    type: type.value,
    demand: demandFit(profile, activity),
    comfort: comfortFit(profile, activity),
    focus: focusFit(profile, activity),
    age: ageFit(profile, activity),
    time: timeFit(profile, activity),
    price: priceFit(profile, activity),
    transport: transportFit(profile, activity),
    culture: activity.scores.culture,
    environment: activity.scores.environment,
    quality: activity.scores.quality,
    personal: personalFit(activity, affinity),
  };

  const weights = { ...BASE_WEIGHTS };
  const boost = FOCUS_WEIGHT_BOOST[profile.focus];
  if (boost) {
    for (const [key, extra] of Object.entries(boost)) weights[key] += extra;
  }
  if (profile.suppMarket === 'yes') weights.culture += 0.25;

  const penalties = [];
  if (profile.income && activity.price_from != null) {
    const budget = BUDGET_CAP[profile.income] || 150;
    if (activity.price_from > budget * 1.5) {
      penalties.push({ key: 'budget', factor: 0.8, text: '票价高于你的预算' });
    }
  }
  if (profile.age && (activity.tags.age_fit || []).length && !activity.tags.age_fit.includes(profile.age)) {
    penalties.push({ key: 'age', factor: 0.62, text: '主要面向其他年龄层' });
  }
  if (
    profile.time &&
    ['A', 'B', 'D'].includes(profile.time) &&
    (activity.tags.time_slots || []).length &&
    !activity.tags.time_slots.includes(profile.time)
  ) {
    penalties.push({ key: 'time', factor: 0.84, text: '开放时段与你的空闲时间错开' });
  }
  if (profile.traffic === 'B' && activity.district && !CENTRAL_DISTRICTS.has(activity.district)) {
    penalties.push({ key: 'distance', factor: 0.86, text: '步行略远，建议换交通方式' });
  }

  let queryValue = 0.5;
  if (query && query.terms && query.terms.length) {
    const text = searchText(activity);
    const hits = query.terms.filter((term) => text.includes(term.toLowerCase()));
    queryValue = clamp01(hits.length / Math.max(2, query.terms.length));
    dims.query = queryValue;
    weights.query = 1.1;
    if (hits.length) {
      penalties.push({ key: 'query', factor: 1.06, text: '命中你描述的关键词' });
    }
  }

  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const weighted = Object.entries(weights).reduce(
    (sum, [key, weight]) => sum + weight * (dims[key] ?? 0.5),
    0,
  );
  const penaltyFactor = penalties
    .filter((item) => item.factor < 1)
    .reduce((factor, item) => factor * item.factor, 1);
  const boostFactor = penalties
    .filter((item) => item.factor > 1)
    .reduce((factor, item) => factor * item.factor, 1);

  const rawScore = clamp01((weighted / totalWeight) * penaltyFactor * boostFactor);

  return {
    score: rawScore,
    dims,
    weights,
    penalties: penalties.filter((item) => item.factor < 1),
    matchedCategories: type.matched,
    reasons: buildReasons(profile, activity, dims, weights, totalWeight, type.matched),
  };
}

/* ------------------------------------------------------------------ 推荐理由 */

const CATEGORY_TEXT = { A: '非遗手工', B: '讲座沙龙', C: '展览演出', D: '阅读借阅', E: '亲子活动', F: '少儿研学', G: '老年文娱', H: '公园空间' };

function buildReasons(profile, activity, dims, weights, totalWeight, matchedCategories) {
  const reasons = [];
  const push = (text, value, weight, key) => {
    if (value < 0.68) return;
    const share = (value * weight) / totalWeight;
    if (share < 0.035) return;
    reasons.push({ key, text, share });
  };

  if (matchedCategories.length) {
    push(`契合你选的「${matchedCategories.map((code) => CATEGORY_TEXT[code]).join('、')}」`, dims.type, weights.type, 'type');
  }
  if (dims.age >= 0.99) push(`适合${profile.age === 'A' ? '未满 18 岁' : '你的年龄段'}参与`, dims.age, weights.age, 'age');
  if (dims.time >= 0.99) {
    const text = { A: '工作日晚间也去得了', B: '周末全天可安排', D: '寒暑假/节假日正合适' }[profile.time];
    if (text) push(text, dims.time, weights.time, 'time');
  }
  if (dims.price >= 0.95) {
    push(activity.price_level === 'free' ? '免费公益，几乎零门槛' : '票价在你的预算内', dims.price, weights.price, 'price');
  }
  if (dims.demand >= 0.99) push('正好满足你想要的「' + ({ A: '休闲放松', B: '增长知识', C: '社交陪伴', D: '便民技能' }[profile.demand] || '') + '」', dims.demand, weights.demand, 'demand');
  if (dims.comfort >= 0.99) push('空间类型对味', dims.comfort, weights.comfort, 'comfort');
  if (dims.transport >= 0.8) push(profile.traffic === 'D' ? '自驾停车相对方便' : '公共交通方便', dims.transport, weights.transport, 'transport');
  if (profile.focus === 'A' && dims.focus >= 0.75) push('文化氛围浓', dims.focus, weights.focus, 'focus');
  if (profile.focus === 'D' && dims.focus >= 0.75) push('环境好，适合慢慢逛', dims.focus, weights.focus, 'focus');
  if (profile.focus === 'C' && dims.focus >= 0.8) push('性价比高', dims.focus, weights.focus, 'focus');
  if (profile.focus === 'B' && dims.focus >= 0.8) push('交通方便', dims.focus, weights.focus, 'focus');
  if (dims.personal > 0.62) push('和你之前点赞过的内容相近', dims.personal, weights.personal, 'personal');

  if (!reasons.length) {
    const themes = (activity.tags.themes || []).slice(0, 2);
    reasons.push({ key: 'fallback', text: themes.length ? `主题：${themes.join('、')}` : '综合匹配度较高', share: 0.05 });
  }
  return reasons.sort((a, b) => b.share - a.share).slice(0, 3).map(({ key, text }) => ({ key, text }));
}

/* ------------------------------------------------------------------ 多样性重排 */

function similarity(a, b) {
  const sameCategory = (a.tags.categories || []).some((code) => (b.tags.categories || []).includes(code)) ? 1 : 0;
  const aThemes = new Set(a.tags.themes || []);
  const bThemes = new Set(b.tags.themes || []);
  let themeSim = 0;
  if (aThemes.size && bThemes.size) {
    const shared = [...aThemes].filter((theme) => bThemes.has(theme)).length;
    themeSim = shared / Math.max(aThemes.size, bThemes.size);
  }
  const sameDistrict = a.district && a.district === b.district ? 1 : 0;
  return 0.55 * sameCategory + 0.25 * themeSim + 0.2 * sameDistrict;
}

export function diversify(scored, limit, lambda = 0.32) {
  const selected = [];
  const pool = [...scored];
  while (selected.length < limit && pool.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      let maxSim = 0;
      let sameCategoryCount = 0;
      for (const chosen of selected) {
        maxSim = Math.max(maxSim, similarity(candidate.activity, chosen.activity));
        if ((candidate.activity.tags.categories || []).some((code) => (chosen.activity.tags.categories || []).includes(code))) {
          sameCategoryCount += 1;
        }
      }
      const repeatPenalty = sameCategoryCount >= 3 ? 0.18 : 0;
      const value = candidate.score - lambda * maxSim - repeatPenalty;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    selected.push(pool.splice(bestIndex, 1)[0]);
  }
  return selected;
}

/* --------------------------------------------------------------------- 入口 */

export function rankActivities(profile, activities, options = {}) {
  const {
    limit = 8,
    exclude = [],
    affinity = null,
    query = null,
    now = Date.now(),
    diversity = true,
  } = options;

  const excludeSet = new Set(exclude);
  const pool = activities
    .map(normalizeActivity)
    .filter((activity) => !excludeSet.has(activity.id) && !isExpired(activity, now));

  const scored = pool.map((activity) => {
    const result = scoreActivity(profile, activity, { affinity, query });
    return {
      activity,
      score: result.score,
      percent: toPercent(result.score),
      dims: result.dims,
      reasons: result.reasons,
      penalties: result.penalties,
      matchedCategories: result.matchedCategories,
    };
  });

  scored.sort((a, b) => b.score - a.score || String(a.activity.id).localeCompare(String(b.activity.id)));

  const picked = diversity ? diversify(scored, limit) : scored.slice(0, limit);

  // 展示用的「综合推荐度」= 原始匹配分 - 多样性惩罚，
  // 这样列表顺序与卡片上的百分比始终一致（否则会出现 92 排在 95 前面）。
  const ordered = picked
    .map((item, index) => {
      const earlier = picked.slice(0, index);
      const maxSim = earlier.reduce(
        (value, other) => Math.max(value, similarity(item.activity, other.activity)),
        0,
      );
      return { ...item, adjusted: Math.max(0, item.score - 0.32 * maxSim) };
    })
    .sort((a, b) => b.adjusted - a.adjusted);

  let previous = 100;
  const items = ordered.map((item) => {
    const percent = Math.min(previous, toPercent(item.adjusted));
    previous = percent;
    return { ...item, score: item.adjusted, percent };
  });

  return {
    items,
    stats: {
      pool: pool.length,
      candidates: scored.length,
      avgScore: scored.length ? Number(mean(scored.map((item) => item.score)).toFixed(3)) : 0,
      filters: { excluded: exclude.length, expired: activities.length - pool.length - exclude.length },
    },
  };
}

/** 把 0-1 的内部分数映射成人看的匹配度（55-99），保留区分度 */
export function toPercent(score) {
  const value = clamp01(score);
  return Math.round(55 + 44 * Math.pow(value, 0.9));
}

export function matchLabel(percent) {
  if (percent >= 92) return '非常契合';
  if (percent >= 85) return '很契合';
  if (percent >= 76) return '比较契合';
  if (percent >= 68) return '可以看看';
  return '仅供备选';
}

/* ------------------------------------------------------------- 反馈 → 亲和度 */

/**
 * 把用户点赞/不喜欢的记录聚合成标签亲和度。
 * feedback 形如 { [activityId]: { liked: true, tags: { categories:[], themes:[], audience:[] } } }
 * 返回值形如 { 'c:A': 0.4, 't:秦腔': 0.7 }，范围 [-1, 1]。
 */
export function computeAffinity(feedback = {}) {
  const totals = {};
  const counts = {};
  for (const entry of Object.values(feedback)) {
    if (!entry || !entry.tags) continue;
    const weight = entry.liked === false ? -1 : 1;
    const keys = [
      ...(entry.tags.categories || []).map((code) => `c:${code}`),
      ...(entry.tags.themes || []).map((theme) => `t:${theme}`),
      ...(entry.tags.audience || []).map((item) => `a:${item}`),
    ];
    for (const key of keys) {
      totals[key] = (totals[key] || 0) + weight;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  const affinity = {};
  for (const key of Object.keys(totals)) {
    // 阻尼：第一次反馈影响最大，之后逐步收敛，避免一两票就锁死偏好
    affinity[key] = Math.max(-1, Math.min(1, totals[key] / (counts[key] + 1)));
  }
  return affinity;
}

export function summarizeProfile(profile) {
  const chips = [];
  if (profile.age) chips.push({ label: '年龄', value: profile.age === 'A' ? '未满18岁' : { B: '18-30', C: '31-50', D: '50+' }[profile.age] });
  if (profile.actTypes?.length) {
    chips.push({ label: '兴趣', value: profile.actTypes.map((code) => CATEGORY_TEXT[code]).join(' / ') });
  }
  if (profile.demand) chips.push({ label: '需求', value: { A: '放松', B: '长知识', C: '社交', D: '技能' }[profile.demand] });
  if (profile.time) chips.push({ label: '时间', value: { A: '工作日晚', B: '周末', C: '随机', D: '假期' }[profile.time] });
  if (profile.focus) chips.push({ label: '最看重', value: { A: '文化氛围', B: '交通', C: '价格', D: '环境' }[profile.focus] });
  if (profile.income) chips.push({ label: '预算', value: { A: '<2000', B: '2000-4000', C: '4000-6000', D: '6000+' }[profile.income] });
  return chips;
}
