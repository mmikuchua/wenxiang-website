import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const payload = JSON.parse(readFileSync(new URL('../data/activities.json', import.meta.url), 'utf8'));
const activities = payload.activities || [];

const CATEGORY_CODES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
const PRICE_LEVELS = new Set(['free', 'low', 'medium', 'high', 'unknown']);
const AGE_CODES = new Set(['A', 'B', 'C', 'D']);
const TIME_CODES = new Set(['A', 'B', 'C', 'D']);

test('数据集非空且字段完整', () => {
  assert.ok(activities.length >= 50, `活动数量过少：${activities.length}`);
  assert.equal(payload.schema_version, 2);
  const ids = new Set();
  for (const item of activities) {
    assert.ok(item.id, `缺少 id: ${item.name}`);
    assert.ok(!ids.has(item.id), `id 重复: ${item.id}`);
    ids.add(item.id);
    assert.ok(item.name && item.name.length <= 160);
    assert.ok(item.summary && item.summary.length <= 200, `摘要过长或缺失: ${item.name}`);
    assert.ok(item.district, `缺少行政区: ${item.name}`);
    assert.ok(PRICE_LEVELS.has(item.price_level), `价格档位非法: ${item.name} ${item.price_level}`);
  }
});

test('标签编码合法', () => {
  for (const item of activities) {
    for (const code of item.tags.categories || []) {
      assert.ok(CATEGORY_CODES.has(code), `${item.name} 类型编码非法: ${code}`);
    }
    for (const code of item.tags.age_fit || []) {
      assert.ok(AGE_CODES.has(code), `${item.name} 年龄编码非法: ${code}`);
    }
    for (const code of item.tags.time_slots || []) {
      assert.ok(TIME_CODES.has(code), `${item.name} 时段编码非法: ${code}`);
    }
    assert.ok((item.tags.categories || []).length > 0, `${item.name} 缺少类型标签`);
    assert.ok((item.tags.themes || []).length > 0, `${item.name} 缺少主题标签`);
  }
});

test('评分都在 0-1 区间', () => {
  for (const item of activities) {
    for (const [key, value] of Object.entries(item.scores)) {
      assert.ok(value >= 0 && value <= 1, `${item.name} 的 ${key} 越界: ${value}`);
    }
  }
});

test('覆盖主要活动类型与多个数据来源', () => {
  const categories = new Set(activities.flatMap((item) => item.tags.categories));
  assert.ok(categories.size >= 5, `类型覆盖不足: ${[...categories].join(',')}`);
  const sources = new Set(activities.map((item) => item.source).filter(Boolean));
  assert.ok(sources.size >= 2, `来源过少: ${[...sources].join(',')}`);
});
