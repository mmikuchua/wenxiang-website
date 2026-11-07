/**
 * 问卷编码体系 —— 与后端 xian_activities/taxonomy.py 保持一致。
 * 所有活动标签、画像字段都用这套编码，避免前后端各说各话。
 */

export const AGES = {
  A: '18岁以下',
  B: '18-30岁',
  C: '31-50岁',
  D: '50岁以上',
};

export const EDUCATIONS = {
  A: '初中及以下',
  B: '高中',
  C: '专科',
  D: '本科',
  E: '研究生及以上',
};

export const LIVING = {
  A: '1年以下',
  B: '1-5年',
  C: '6-10年',
  D: '10年以上',
};

export const OCCUPATIONS = {
  A: '党政机关',
  B: '企事业',
  C: '专业技术',
  D: '私营',
  E: '商业',
  F: '工人',
  G: '服务业',
  H: '学生',
  I: '离退休',
  J: '下岗',
  K: '其他',
};

export const INCOME = {
  A: '2000元以下',
  B: '2000-4000元',
  C: '4000-6000元',
  D: '6000元以上',
};

export const TIME_SLOTS = {
  A: '工作日晚间',
  B: '周末全天',
  C: '随机空闲',
  D: '寒暑假/节假日',
};

export const CATEGORIES = {
  A: '非遗手工',
  B: '讲座沙龙',
  C: '展览演出',
  D: '阅读借阅',
  E: '亲子活动',
  F: '少儿艺术/科普/研学',
  G: '老年文娱',
  H: '公园/公共空间',
};

export const DEMANDS = {
  A: '休闲放松',
  B: '增长知识',
  C: '社交陪伴',
  D: '便民/技能',
};

export const COMFORTS = {
  A: '公共I · 文博馆',
  B: '公共II · 公园景点',
  C: '市场I · 书店艺术馆',
  D: '市场II · 特色街区',
};

export const FACTORS = {
  A: '文化氛围',
  B: '交通便利',
  C: '免费/低费',
  D: '环境优美',
};

export const TRAFFIC = {
  A: '公交',
  B: '步行',
  C: '自行车',
  D: '自驾',
};

export const PRICE_LEVELS = {
  free: '免费',
  low: '50元以下',
  medium: '50-200元',
  high: '200元以上',
  unknown: '价格待定',
};

export const DISTRICTS = [
  '新城区', '碑林区', '莲湖区', '雁塔区', '灞桥区', '未央区',
  '长安区', '临潼区', '阎良区', '高陵区', '鄠邑区', '蓝田县',
  '周至县', '西咸新区', '曲江新区', '高新区', '浐灞生态区', '经开区',
];

// 交通便利度较高的核心城区（无坐标时用于估算步行/骑行可达性）
export const CENTRAL_DISTRICTS = new Set([
  '新城区', '碑林区', '莲湖区', '雁塔区', '曲江新区', '高新区', '经开区',
]);

export const DIMENSION_LABELS = {
  type: '兴趣类型',
  demand: '核心需求',
  comfort: '舒适物偏好',
  focus: '关注因素',
  age: '年龄适配',
  time: '时间可达',
  price: '预算匹配',
  transport: '交通便利',
  culture: '文化含量',
  environment: '环境品质',
  quality: '信息质量',
  personal: '你的反馈',
  query: '需求描述',
};

export function labelOf(table, code) {
  return table[code] || code || '未填写';
}

export function labelsOf(table, codes) {
  return (codes || []).map((code) => labelOf(table, code)).filter(Boolean);
}
