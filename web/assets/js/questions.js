/**
 * 问卷结构：题目、选项、显隐规则、校验规则。
 *
 * 关键改动（相比旧版写死的 11 题 + 跳题 if/else）：
 * - 题目用 when() 声明依赖，流程自动计算，不再有“第4题跳第6题”这类硬编码；
 * - 选项带说明文案，前端直接渲染成按钮，用户不用记字母；
 * - 多选题有上限，避免画像被稀释。
 */
import { AGES, CATEGORIES, COMFORTS, DEMANDS, EDUCATIONS, FACTORS, INCOME, LIVING, OCCUPATIONS, TIME_SLOTS, TRAFFIC } from './taxonomy.js';

const optionsFrom = (table, hints = {}) =>
  Object.entries(table).map(([value, label]) => ({ value, label, hint: hints[value] }));

export const STEPS = [
  {
    id: 'age',
    field: 'age',
    eyebrow: '关于你',
    title: '你的年龄段是？',
    why: '不同年龄能参加的活动差别很大，这是最有效的第一层筛选。',
    options: optionsFrom(AGES),
  },
  {
    id: 'education',
    field: 'education',
    eyebrow: '关于你',
    title: '你的文化程度是？',
    why: '用来判断讲座、展览内容的深浅是否合适。',
    options: optionsFrom(EDUCATIONS),
  },
  {
    id: 'living',
    field: 'living',
    eyebrow: '关于你',
    title: '你在西安生活多久了？',
    why: '新西安人更可能需要“入门级”的城市文化体验。',
    options: optionsFrom(LIVING),
  },
  {
    id: 'occupation',
    field: 'occupation',
    eyebrow: '关于你',
    title: '你的职业是？',
    why: '职业会影响可支配时间与兴趣取向。',
    options: (profile) =>
      profile.age === 'A'
        ? optionsFrom(OCCUPATIONS).filter((item) => ['H', 'K'].includes(item.value))
        : optionsFrom(OCCUPATIONS),
  },
  {
    id: 'income',
    field: 'income',
    eyebrow: '关于你',
    title: '你的月收入大致是？',
    why: '只用来估算可接受的票价，不会展示给任何人。',
    when: (profile) => profile.age !== 'A',
    options: optionsFrom(INCOME),
  },
  {
    id: 'time',
    field: 'time',
    eyebrow: '你的时间',
    title: '你通常什么时候有空？',
    why: '决定推荐工作日晚间场，还是周末全天场。',
    options: (profile) =>
      optionsFrom(TIME_SLOTS).filter((item) => item.value !== 'D' || profile.age === 'A'),
  },
  {
    id: 'actTypes',
    field: 'actTypes',
    eyebrow: '你的兴趣',
    title: '你对哪几类活动感兴趣？',
    why: '最多选 3 类，选得越聚焦，推荐越准。',
    multi: true,
    max: 3,
    options: optionsFrom(CATEGORIES),
  },
  {
    id: 'demand',
    field: 'demand',
    eyebrow: '你的兴趣',
    title: '你这次出门，最想获得什么？',
    why: '同样是看展，有人想放松，有人想长知识，推荐会不一样。',
    options: optionsFrom(DEMANDS),
  },
  {
    id: 'comfort',
    field: 'comfort',
    eyebrow: '你的偏好',
    title: '你更喜欢哪类文化空间？',
    why: '文博馆、公园、书店、街区，四种空间的气质差别很大。',
    options: optionsFrom(COMFORTS),
  },
  {
    id: 'focus',
    field: 'focus',
    eyebrow: '你的偏好',
    title: '选活动时，你最看重哪一点？',
    why: '这一项会直接改变推荐权重，是“更懂你”的关键。',
    options: optionsFrom(FACTORS),
  },
  {
    id: 'traffic',
    field: 'traffic',
    eyebrow: '你的出行',
    title: '你主要怎么去？',
    why: '步行和自驾能接受的半径完全不同。',
    options: optionsFrom(TRAFFIC),
  },
  {
    id: 'suppMarket',
    field: 'suppMarket',
    eyebrow: '再问一句',
    title: '你希望市场类空间里多一些文化元素吗？',
    why: '特色街区里的非遗摊位、书店里的展演，会被优先推荐。',
    when: (profile) => profile.comfort === 'D',
    options: [
      { value: 'yes', label: '希望，越多越好', hint: '会提高“文化+商业”混合空间的权重' },
      { value: 'no', label: '不必，好玩就行' },
    ],
  },
  {
    id: 'suppParking',
    field: 'suppParking',
    eyebrow: '再问一句',
    title: '平时开车出门，找车位困难吗？',
    why: '会帮你在同等条件下优先选停车方便的地方。',
    when: (profile) => profile.traffic === 'D',
    options: [
      { value: 'yes', label: '难，经常绕圈', hint: '优先推荐有停车场或郊区目的地' },
      { value: 'no', label: '还好' },
    ],
  },
];

export function visibleSteps(profile) {
  return STEPS.filter((step) => (step.when ? step.when(profile) : true));
}

export function stepOptions(step, profile) {
  return typeof step.options === 'function' ? step.options(profile) : step.options;
}

export function validateStep(step, value, profile) {
  const options = stepOptions(step, profile);
  const allowed = new Set(options.map((option) => option.value));
  if (step.multi) {
    const values = Array.isArray(value) ? value : [value].filter(Boolean);
    if (!values.length) return '至少选 1 项';
    if (values.some((item) => !allowed.has(item))) return '包含无效选项';
    if (values.length > (step.max || 99)) return `最多选 ${step.max} 项`;
    return null;
  }
  if (!value) return '请选择一个选项';
  if (!allowed.has(value)) return '包含无效选项';
  return null;
}

export const TOTAL_MAIN_STEPS = STEPS.filter((step) => !step.id.startsWith('supp')).length;
