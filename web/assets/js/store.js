/**
 * 本地存储：画像、问卷记录、反馈。
 *
 * 站点默认是「纯前端」模式，数据只存在用户自己的浏览器里；
 * 如果部署了 backend/，cloud.js 会把记录同步到服务器，管理员端能看到汇总。
 */
const KEY = 'wenxiang.v2';
const MEMORY = {};

function readRaw() {
  try {
    const text = window.localStorage.getItem(KEY);
    return text ? JSON.parse(text) : null;
  } catch (error) {
    return null;
  }
}

const EMPTY = {
  version: 2,
  profile: null,
  responses: [],
  feedback: {},
  seen: [],
};

let state = null;

function load() {
  if (state) return state;
  const stored = readRaw();
  state = { ...structuredClone(EMPTY), ...(stored || {}) };
  if (!Array.isArray(state.responses)) state.responses = [];
  if (!state.feedback || typeof state.feedback !== 'object') state.feedback = {};
  if (!Array.isArray(state.seen)) state.seen = [];
  return state;
}

function persist() {
  const current = load();
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch (error) {
    // 隐私模式 / 存储已满：退化为内存存储，页面仍可用
    MEMORY[KEY] = JSON.stringify(current);
  }
  window.dispatchEvent(new CustomEvent('wenxiang:store', { detail: { key: KEY } }));
}

export function getProfile() {
  return load().profile;
}

export function setProfile(profile) {
  const current = load();
  current.profile = { ...profile, updatedAt: new Date().toISOString() };
  persist();
  return current.profile;
}

export function clearProfile() {
  const current = load();
  current.profile = null;
  persist();
}

export function addResponse(profile, meta = {}) {
  const current = load();
  const record = {
    id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: new Date().toISOString(),
    profile: { ...profile },
    ...meta,
  };
  current.responses.push(record);
  persist();
  return record;
}

export function listResponses() {
  return [...load().responses];
}

export function replaceResponses(responses) {
  const current = load();
  current.responses = Array.isArray(responses) ? responses : [];
  persist();
}

export function clearResponses() {
  const current = load();
  current.responses = [];
  current.seen = [];
  persist();
}

/* ------------------------------------------------------------------ 反馈 */

export function getFeedback() {
  return { ...load().feedback };
}

export function setFeedback(activity, liked) {
  const current = load();
  const id = activity.id;
  const existing = current.feedback[id];
  if (existing && existing.liked === liked) {
    delete current.feedback[id];
  } else {
    current.feedback[id] = {
      liked,
      at: new Date().toISOString(),
      name: activity.name,
      tags: {
        categories: (activity.tags?.categories || []).slice(),
        themes: (activity.tags?.themes || []).slice(),
        audience: (activity.tags?.audience || []).slice(),
      },
    };
  }
  persist();
  return { ...current.feedback };
}

export function feedbackOf(id) {
  return load().feedback[id] || null;
}

/* -------------------------------------------------------------- 已看过的 */

export function markSeen(ids) {
  const current = load();
  const merged = new Set([...current.seen, ...ids]);
  current.seen = [...merged].slice(-300);
  persist();
}

export function getSeen() {
  return [...load().seen];
}

export function clearSeen() {
  const current = load();
  current.seen = [];
  persist();
}

/* ---------------------------------------------------------------- 导入导出 */

export function exportAll() {
  return { ...load(), exported_at: new Date().toISOString() };
}

export function importAll(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('文件格式不正确');
  const current = load();
  const next = {
    ...current,
    profile: payload.profile ?? current.profile,
    responses: Array.isArray(payload.responses) ? payload.responses : current.responses,
    feedback: payload.feedback ?? current.feedback,
  };
  state = next;
  persist();
  return next;
}

export function resetAll() {
  state = { ...structuredClone(EMPTY) };
  try {
    window.localStorage.removeItem(KEY);
  } catch (error) {
    /* ignore */
  }
  persist();
}

export function storageAvailable() {
  try {
    const probeKey = `${KEY}.probe`;
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return true;
  } catch (error) {
    return false;
  }
}
