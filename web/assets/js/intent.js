/**
 * 「一句话找活动」的本地语义解析。
 *
 * 没有后端时也能用：把自然语言里的意图词映射成画像覆盖项 + 关键词，
 * 再交给推荐引擎做加权排序。它不假装是 LLM，但比纯关键词搜索更贴合。
 */
import { CATEGORIES } from './taxonomy.js';

const RULES = [
  // 价格
  { terms: ['免费', '公益', '不花钱', '零元', '0元', '便宜', '低价', '实惠', '省钱', '性价比'], apply: { focus: 'C' }, chip: '优先免费/低价' },
  // 时间
  { terms: ['晚上', '下班后', '晚间', '夜游', '夜景', '夜场'], apply: { time: 'A' }, chip: '工作日晚间' },
  { terms: ['周末', '周六', '周日', '双休'], apply: { time: 'B' }, chip: '周末' },
  { terms: ['假期', '寒假', '暑假', '节假日', '放假'], apply: { time: 'D' }, chip: '寒暑假/节假日' },
  // 人群（只调整类型偏好，不改变用户自己的年龄段）
  { terms: ['亲子', '带孩子', '遛娃', '小孩', '孩子', '儿童', '宝宝', '全家'], apply: { types: ['E', 'F'], comfort: 'A' }, chip: '亲子友好' },
  { terms: ['老人', '父母', '长辈', '退休', '银发', '老年'], apply: { types: ['G'], comfort: 'B' }, chip: '适合长辈' },
  { terms: ['学生', '同学', '大学生', '年轻人', '朋友', '聚会', '约会', '情侣'], apply: { types: ['C', 'B'], demand: 'C' }, chip: '社交/年轻向' },
  // 类型
  { terms: ['非遗', '手工', '手作', '扎染', '皮影', '剪纸', '陶艺'], apply: { types: ['A'] }, chip: '非遗手工' },
  { terms: ['讲座', '沙龙', '分享会', '读书会', '讲坛', '论坛'], apply: { types: ['B'] }, chip: '讲座沙龙' },
  { terms: ['展览', '看展', '博物馆', '美术馆', '文物', '画展'], apply: { types: ['C'], comfort: 'A' }, chip: '展览演出' },
  { terms: ['演出', '音乐会', '话剧', '戏曲', '秦腔', '相声', 'live', '演唱会'], apply: { types: ['C'] }, chip: '演出' },
  { terms: ['看书', '阅读', '图书馆', '书店', '自习', '绘本'], apply: { types: ['D'], comfort: 'C' }, chip: '阅读' },
  { terms: ['公园', '散步', '户外', '晒太阳', '草坪', '景区', '爬山', '城墙'], apply: { types: ['H'], comfort: 'B' }, chip: '公园/户外' },
  { terms: ['街区', '夜市', '市集', '逛街', '打卡', '拍照', '出片', '网红'], apply: { types: ['H'], comfort: 'D' }, chip: '街区打卡' },
  // 体验诉求
  { terms: ['安静', '人少', '清净', '不吵', '发呆', '独处'], apply: { focus: 'D' }, chip: '安静环境' },
  { terms: ['文化', '历史', '底蕴', '传统', '唐', '秦', '汉'], apply: { focus: 'A' }, chip: '文化氛围' },
  { terms: ['室内', '下雨', '避暑', '空调', '不晒'], apply: { comfort: 'A' }, chip: '室内' },
  { terms: ['地铁', '公交', '交通方便', '近一点', '附近'], apply: { traffic: 'A' }, chip: '交通方便' },
  { terms: ['开车', '自驾', '停车'], apply: { traffic: 'D' }, chip: '自驾' },
  { terms: ['学习', '涨知识', '科普', '研学', '长见识'], apply: { demand: 'B' }, chip: '增长知识' },
  { terms: ['放松', '解压', '休闲', '散心', '随便逛逛'], apply: { demand: 'A' }, chip: '休闲放松' },
];

const STOPWORDS = new Set(['的', '了', '在', '有', '和', '与', '去', '想', '要', '找个', '一下', '地方', '活动', '西安', '附近', '有没有', '推荐', '什么', '哪些', '我', '你']);

function tokenize(text) {
  const cleaned = text.toLowerCase().replace(/[，。！？、,.!?;；:："'“”()（）]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((token) => token && token.length >= 2 && !STOPWORDS.has(token));
  return [...new Set(tokens)].slice(0, 8);
}

export function parseQuery(text) {
  const raw = String(text || '').trim();
  if (!raw) return { raw: '', terms: [], overrides: {}, chips: [], matched: [] };

  const overrides = {};
  const chips = [];
  const terms = new Set();

  for (const rule of RULES) {
    const hit = rule.terms.find((term) => raw.includes(term));
    if (!hit) continue;
    chips.push(rule.chip);
    terms.add(hit);
    if (rule.apply.types) {
      overrides.actTypes = [...new Set([...(overrides.actTypes || []), ...rule.apply.types])].slice(0, 3);
    }
    for (const key of ['focus', 'time', 'age', 'comfort', 'demand', 'traffic']) {
      if (rule.apply[key]) overrides[key] = rule.apply[key];
    }
  }

  // 从原句里再抽一些实词，用于内容命中（标题/简介/主题）
  for (const token of tokenize(raw)) {
    if (token.length <= 6) terms.add(token);
  }
  // 如果提到具体类型名，也当成关键词
  for (const [code, label] of Object.entries(CATEGORIES)) {
    if (raw.includes(label.slice(0, 2))) {
      overrides.actTypes = [...new Set([...(overrides.actTypes || []), code])].slice(0, 3);
    }
  }

  return {
    raw,
    terms: [...terms].slice(0, 10),
    overrides,
    chips: [...new Set(chips)],
    matched: Object.keys(overrides),
  };
}

export function mergeProfile(profile, parsed) {
  if (!parsed || !parsed.matched.length) return profile;
  const merged = { ...profile };
  for (const [key, value] of Object.entries(parsed.overrides)) {
    if (key === 'actTypes') {
      merged.actTypes = value;
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export const QUERY_EXAMPLES = [
  '周末带孩子去免费的博物馆',
  '下班后想安静地看个展',
  '想听秦腔，最好是室内的',
  '适合带爸妈去的公园',
  '和朋友拍照打卡的街区',
];
