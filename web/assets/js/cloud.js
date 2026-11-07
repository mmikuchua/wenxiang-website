/**
 * 可选云端：如果站点由 backend/ 提供（或通过 ?api=https://... 指定），
 * 就把问卷记录同步到服务器、并使用服务端的 AI 顾问；
 * 否则完全退化为纯前端 localStorage 模式，功能不受影响。
 */
const params = new URLSearchParams(window.location.search);
const BASE = (params.get('api') || window.__WENXIANG_API__ || '').replace(/\/$/, '');

let probePromise = null;

async function timeoutFetch(url, options = {}, ms = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function apiBase() {
  return BASE;
}

export function probe() {
  if (probePromise) return probePromise;
  probePromise = (async () => {
    try {
      const response = await timeoutFetch(`${BASE}/api/health`);
      if (!response.ok) return { available: false, mode: 'local' };
      const payload = await response.json();
      if (payload && payload.service === 'wenxiang') {
        return { available: true, mode: 'cloud', version: payload.version || '', llm: !!payload.llm };
      }
      return { available: false, mode: 'local' };
    } catch (error) {
      return { available: false, mode: 'local' };
    }
  })();
  return probePromise;
}

export async function pushResponse(record) {
  const status = await probe();
  if (!status.available) return { synced: false };
  try {
    const response = await timeoutFetch(`${BASE}/api/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }, 6000);
    return { synced: response.ok };
  } catch (error) {
    return { synced: false };
  }
}

export async function fetchResponses() {
  const status = await probe();
  if (!status.available) return { available: false, responses: [] };
  try {
    const response = await timeoutFetch(`${BASE}/api/responses`);
    if (!response.ok) return { available: false, responses: [] };
    const payload = await response.json();
    return { available: true, responses: payload.responses || [] };
  } catch (error) {
    return { available: false, responses: [] };
  }
}

export async function chat(messages) {
  const status = await probe();
  if (!status.available) return { available: false, text: '' };
  try {
    const response = await timeoutFetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    }, 45000);
    if (!response.ok) return { available: true, text: '', error: `HTTP ${response.status}` };
    const payload = await response.json();
    return {
      available: true,
      text: payload.reply || '',
      ids: payload.activity_ids || [],
      items: payload.items || [],
      usedLlm: !!payload.used_llm,
    };
  } catch (error) {
    return { available: true, text: '', error: String(error) };
  }
}
