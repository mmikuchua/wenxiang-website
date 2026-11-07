import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUDGET_CAP,
  computeAffinity,
  diversify,
  isExpired,
  matchLabel,
  normalizeActivity,
  priceFit,
  rankActivities,
  scoreActivity,
  toPercent,
} from '../assets/js/engine.js';

const baseProfile = {
  age: 'C',
  education: 'D',
  living: 'D',
  occupation: 'B',
  income: 'C',
  time: 'B',
  actTypes: ['C'],
  demand: 'A',
  comfort: 'A',
  focus: 'A',
  traffic: 'A',
};

function activity(overrides = {}) {
  return normalizeActivity({
    id: overrides.id || 'act-test',
    name: overrides.name || '测试活动',
    summary: overrides.summary || '',
    district: overrides.district || '雁塔区',
    price_level: overrides.price_level || 'free',
    price_from: overrides.price_from ?? 0,
    tags: {
      categories: ['C'],
      demand: ['A'],
      comfort: ['A'],
      factors: ['A'],
      age_fit: ['A', 'B', 'C', 'D'],
      time_slots: ['A', 'B'],
      themes: ['展览'],
      moods: [],
      audience: [],
      ...(overrides.tags || {}),
    },
    scores: {
      culture: 0.8,
      transport: 0.8,
      environment: 0.7,
      cost: 1,
      family: 0.5,
      quiet: 0.5,
      social: 0.5,
      learning: 0.6,
      quality: 0.8,
      ...(overrides.scores || {}),
    },
    ...overrides,
  });
}

test('没有完全匹配的活动时不会返回空结果（软约束）', () => {
  const profile = { ...baseProfile, actTypes: ['G'], age: 'D', time: 'A', comfort: 'D' };
  const activities = [
    activity({ id: 'a1', tags: { categories: ['F'], age_fit: ['A'], time_slots: ['B'], comfort: ['A'] } }),
    activity({ id: 'a2', tags: { categories: ['C'], age_fit: ['B'], time_slots: ['D'], comfort: ['C'] } }),
  ];
  const { items } = rankActivities(profile, activities, { limit: 5 });
  assert.equal(items.length, 2, '应该保留候选，而不是硬过滤成 0 条');
});

test('低价敏感用户：免费活动应排在 200 元活动前面', () => {
  const profile = { ...baseProfile, income: 'A', focus: 'C' };
  const free = activity({ id: 'free', price_level: 'free', price_from: 0 });
  const pricey = activity({ id: 'pricey', price_level: 'high', price_from: 280 });
  const { items } = rankActivities(profile, [pricey, free], { diversity: false });
  assert.equal(items[0].activity.id, 'free');
});

test('成人画像下，纯少儿活动应显著降权', () => {
  const adult = activity({ id: 'adult' });
  const kids = activity({ id: 'kids', tags: { age_fit: ['A'], categories: ['F'] }, scores: { family: 1 } });
  const { items } = rankActivities(baseProfile, [kids, adult], { diversity: false });
  assert.equal(items[0].activity.id, 'adult');
  const kidPercent = items.find((item) => item.activity.id === 'kids').percent;
  assert.ok(kidPercent < items[0].percent, '少儿活动分数应更低');
});

test('时间不匹配会扣分', () => {
  const ok = activity({ id: 'ok', tags: { time_slots: ['B'] } });
  const off = activity({ id: 'off', tags: { time_slots: ['A'] } });
  const { items } = rankActivities(baseProfile, [off, ok], { diversity: false });
  assert.equal(items[0].activity.id, 'ok');
});

test('多样性重排：前 5 条不会全是同一类型', () => {
  const profile = { ...baseProfile, actTypes: ['C'] };
  const activities = Array.from({ length: 8 }, (_, index) =>
    activity({
      id: `exhibit-${index}`,
      name: `展览${index}`,
      tags: { categories: ['C'], themes: ['展览'] },
      scores: { quality: 0.9 - index * 0.01 },
    }),
  ).concat(
    activity({ id: 'park', name: '公园', tags: { categories: ['H'], themes: ['公园'] }, scores: { quality: 0.6 } }),
    activity({ id: 'read', name: '书房', tags: { categories: ['D'], themes: ['阅读'] }, scores: { quality: 0.55 } }),
  );
  const { items } = rankActivities(profile, activities, { limit: 5, diversity: true });
  const categories = new Set(items.map((item) => item.activity.tags.categories[0]));
  assert.ok(categories.size >= 2, `期望至少 2 类，实际 ${[...categories].join(',')}`);
});

test('展示百分比单调不增，且与顺序一致', () => {
  const activities = Array.from({ length: 12 }, (_, index) =>
    activity({ id: `a${index}`, name: `活动${index}`, scores: { quality: 0.5 + index * 0.03 } }),
  );
  const { items } = rankActivities(baseProfile, activities, { limit: 8 });
  for (let index = 1; index < items.length; index += 1) {
    assert.ok(items[index].percent <= items[index - 1].percent, '百分比必须随排序递减');
  }
});

test('相同输入得到相同排序（确定性）', () => {
  const activities = Array.from({ length: 10 }, (_, index) => activity({ id: `a${index}`, name: `活动${index}` }));
  const first = rankActivities(baseProfile, activities, { limit: 6 }).items.map((item) => item.activity.id);
  const second = rankActivities(baseProfile, activities, { limit: 6 }).items.map((item) => item.activity.id);
  assert.deepEqual(first, second);
});

test('过期活动会被排除，未过期的保留', () => {
  const now = Date.parse('2026-06-01T00:00:00+08:00');
  const expired = activity({ id: 'old', valid_end: '2026-01-01' });
  const future = activity({ id: 'new', valid_end: '2026-12-31' });
  assert.equal(isExpired(expired, now), true);
  const { items } = rankActivities(baseProfile, [expired, future], { now });
  assert.deepEqual(items.map((item) => item.activity.id), ['new']);
});

test('反馈亲和度：点赞同类活动会提高 personal 分', () => {
  const liked = activity({ id: 'liked', tags: { categories: ['A'], themes: ['秦腔'] } });
  const feedback = {
    liked: { liked: true, tags: { categories: ['A'], themes: ['秦腔'], audience: [] } },
  };
  const affinity = computeAffinity(feedback);
  const candidate = activity({ id: 'candidate', tags: { categories: ['A'], themes: ['秦腔'] } });
  const neutral = activity({ id: 'neutral', tags: { categories: ['H'], themes: ['公园'] } });
  const withFeedback = scoreActivity(baseProfile, candidate, { affinity });
  const withoutFeedback = scoreActivity(baseProfile, candidate, { affinity: null });
  const neutralScore = scoreActivity(baseProfile, neutral, { affinity });
  assert.ok(withFeedback.dims.personal > withoutFeedback.dims.personal);
  assert.ok(withFeedback.dims.personal > neutralScore.dims.personal);
});

test('不喜欢会把亲和度压到负值，从而降低同类推荐', () => {
  const affinity = computeAffinity({
    one: { liked: false, tags: { categories: ['C'], themes: ['展览'], audience: [] } },
  });
  assert.ok(affinity['c:C'] < 0);
});

test('预算匹配：收入越低，高价活动折扣越大', () => {
  const expensive = activity({ price_level: 'high', price_from: 300 });
  const lowIncome = priceFit({ ...baseProfile, income: 'A' }, expensive);
  const highIncome = priceFit({ ...baseProfile, income: 'D' }, expensive);
  assert.ok(lowIncome < highIncome);
  assert.ok(BUDGET_CAP.A < BUDGET_CAP.D);
});

test('匹配度映射在 55-99 之间且有区分度', () => {
  assert.equal(toPercent(0), 55);
  assert.equal(toPercent(1), 99);
  assert.ok(toPercent(0.8) > toPercent(0.5));
  assert.equal(matchLabel(96), '非常契合');
  assert.equal(matchLabel(60), '仅供备选');
});

test('diversify 处理空列表与不足 limit 的情况', () => {
  assert.deepEqual(diversify([], 5), []);
  const single = [{ activity: activity(), score: 0.5 }];
  assert.equal(diversify(single, 5).length, 1);
});
