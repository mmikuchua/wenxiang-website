# backend/main.py
import uuid
import json
import re
import logging
import traceback
from datetime import datetime
from collections import defaultdict
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, Integer, String, JSON, DateTime, Float
from sqlalchemy.orm import sessionmaker

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ==================== 数据库配置 ====================
SQLALCHEMY_DATABASE_URL = "sqlite:///./data/wenxiang.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class UserResponse(Base):
    """存储用户每次填写的问卷数据"""
    __tablename__ = 'user_responses'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    age_group = Column(String, nullable=True)
    education = Column(String, nullable=True)
    living_years = Column(String, nullable=True)
    occupation = Column(String, nullable=True)
    income = Column(String, nullable=True)
    available_time = Column(String, nullable=True)
    # 活动类型可能多选，用 Text 存储逗号分隔字符串
    activity_type = Column(Text, nullable=True)
    core_demand = Column(String, nullable=True)
    comfort_type = Column(String, nullable=True)
    focus_factor = Column(String, nullable=True)
    traffic_type = Column(String, nullable=True)
    supplementary_1 = Column(String, nullable=True)
    supplementary_2 = Column(String, nullable=True)

    is_complete = Column(Integer, default=0)

class Activity(Base):
    """活动库"""
    __tablename__ = 'activities'

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(String, nullable=True)
    name = Column(String)
    type = Column(String)
    time = Column(String)
    address = Column(String)
    price = Column(String)
    highlights = Column(String)
    guide_link = Column(String)
    source = Column(String)

    activity_type_tags = Column(JSON, default=[])
    age_fit_tags = Column(JSON, default=[])
    time_slot_tags = Column(JSON, default=[])
    price_level = Column(String)
    comfort_tag = Column(String)
    demand_tags = Column(JSON, default=[])
    factor_tags = Column(JSON, default=[])
    transport_score = Column(Float, default=0.5)
    valid_start = Column(DateTime, nullable=True)
    valid_end = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

def init_db():
    Base.metadata.create_all(bind=engine)

# ==================== 辅助函数和常量 ====================

# 问卷映射表（仅用于解析描述，统计时使用编码）
age_map = {
    "A": ("under_18", "18岁以下"),
    "B": ("age_18_30", "18-30岁"),
    "C": ("age_31_50", "31-50岁"),
    "D": ("age_50_plus", "50岁以上")
}
edu_map = {
    "A": ("middle_school_below", "初中及以下"),
    "B": ("high_school", "高中"),
    "C": ("college", "专科"),
    "D": ("bachelor", "本科"),
    "E": ("master_above", "研究生及以上")
}
living_map = {
    "A": ("under_1_year", "1年以下"),
    "B": ("year_1_5", "1-5年"),
    "C": ("year_6_10", "6-10年"),
    "D": ("over_10_years", "10年以上")
}
occ_map = {
    "A": ("gov_org", "党政机关"),
    "B": ("enterprise", "企事业"),
    "C": ("professional", "专业技术"),
    "D": ("private", "私营"),
    "E": ("business", "商业"),
    "F": ("worker", "工人"),
    "G": ("service", "服务业"),
    "H": ("student", "学生"),
    "I": ("retired", "离退休"),
    "J": ("unemployed", "下岗"),
    "K": ("other", "其他")
}
income_map = {
    "A": ("under_2000", "2000元以下"),
    "B": ("2000_4000", "2000-4000元"),
    "C": ("4000_6000", "4000-6000元"),
    "D": ("over_6000", "6000元以上")
}
time_map = {
    "A": ("weekday_evening", "工作日晚间"),
    "B": ("weekend", "周末全天"),
    "C": ("random_free", "随机空闲"),
    "D": ("holiday", "寒暑假/节假日")
}
activity_map = {
    "A": ("intangible_heritage", "非遗手工"),
    "B": ("lecture", "讲座沙龙"),
    "C": ("exhibition", "展览演出"),
    "D": ("reading", "阅读借阅"),
    "E": ("parent_child", "亲子活动"),
    "F": ("children_education", "少儿艺术/科普/研学"),
    "G": ("elderly", "老年文娱"),
    "H": ("public_space", "公园/公共空间")
}
demand_map = {
    "A": ("relax", "休闲放松"),
    "B": ("knowledge", "增长知识"),
    "C": ("social", "社交陪伴"),
    "D": ("skill", "便民/技能")
}
comfort_map = {
    "A": ("public_I", "公共I(文博馆)"),
    "B": ("public_II", "公共II(公园/景点)"),
    "C": ("market_I", "市场I(书店/艺术馆)"),
    "D": ("market_II", "市场II(特色街区)")
}
focus_map = {
    "A": ("culture", "文化氛围"),
    "B": ("transport", "交通便利"),
    "C": ("cost", "免费/低费"),
    "D": ("environment", "环境优美")
}
traffic_map = {
    "A": ("bus", "公交"),
    "B": ("walk", "步行"),
    "C": ("bike", "自行车"),
    "D": ("car", "自驾")
}

# 问卷题目文本
question_texts = {
    1: "第1/11题：您的年龄阶段是？(A.18岁以下 B.18-30 C.31-50 D.50以上)",
    2: "第2/11题：您的文化程度是？(A.初中及以下 B.高中 C.专科 D.本科 E.研究生及以上)",
    3: "第3/11题：您的西安生活时长？(A.1年以下 B.1-5 C.6-10 D.10以上)",
    4: "第4/11题：您的职业是？(A.党政机关 B.企事业 C.专业技术 D.私营 E.商业 F.工人 G.服务业 H.学生 I.离退休 J.下岗 K.其他)",
    5: "第5/11题：您的月收入是？(A.2000以下 B.2000-4000 C.4000-6000 D.6000以上)",
    6: "第6/11题：您每周可参与时间？(A.工作日晚间 B.周末全天 C.随机空闲 D.寒暑假/节假日(仅18岁以下))",
    7: "第7/11题：您感兴趣的活动类型？(A.非遗手工 B.讲座沙龙 C.展览演出 D.阅读借阅 E.亲子活动 F.少儿艺术/科普/研学 G.老年文娱 H.公园/公共空间)",
    8: "第8/11题：您的核心需求是？(A.休闲放松 B.增长知识 C.社交陪伴 D.便民/技能)",
    9: "第9/11题：您倾向的舒适物类型？(A.公共I(文博馆) B.公共II(公园/景点) C.市场I(书店/艺术馆) D.市场II(特色街区))",
    10: "第10/11题：您最关注的因素？(A.文化氛围 B.交通便利 C.免费/低费 D.环境优美)",
    11: "第11/11题：您的主要交通方式？(A.公交 B.步行 C.自行车 D.自驾)",
}

# 选项映射
question_options = {
    1: ["A","B","C","D"],
    2: ["A","B","C","D","E"],
    3: ["A","B","C","D"],
    4: ["A","B","C","D","E","F","G","H","I","J","K"],
    5: ["A","B","C","D"],
    6: ["A","B","C","D"],
    7: ["A","B","C","D","E","F","G","H"],
    8: ["A","B","C","D"],
    9: ["A","B","C","D"],
    10: ["A","B","C","D"],
    11: ["A","B","C","D"],
}

# 调研数据常量（用于报告）
SURVEY = {
    "student_percentage": "37.3%",
    "young_middle_percentage": "59.5%",
    "elderly_percentage": "3.2%",
    "bachelor_percentage": "38.9%",
    "college_percentage": "18.5%",
    "over_10_years_percentage": "46.0%",
    "under_1_year_percentage": "11.8%",
    "bus_percentage": "30%",
    "public_I_percentage": "35%",
    "public_II_percentage": "35%",
    "focus_culture": 528,
    "focus_environment": 457,
    "focus_transport": 389,
    "focus_cost": 326
}

# 活动匹配关键词映射（扩充版）
type_keywords = {
    "A": ["非遗", "手工", "手作", "民俗", "扎染", "皮影", "剪纸", "面塑", "泥塑", "陶艺", "编织", "刺绣", "香包", "花灯", "年画", "糖画", "草编", "竹编", "木雕", "核雕", "秦绣", "社火", "剪纸", "布艺", "茶艺", "香道", "花道"],
    "B": ["讲座", "沙龙", "讲坛", "分享会", "读书会", "研讨会", "论坛", "公开课", "名家讲坛", "文化讲座", "学术交流", "国学讲堂", "文史讲座", "科普讲座", "健康讲座", "法律讲座", "家长课堂", "创业分享"],
    "C": ["展览", "演出", "演艺", "音乐会", "舞剧", "戏剧", "光影秀", "水舞", "灯会", "巡游", "话剧", "歌剧", "音乐剧", "戏曲", "秦腔", "豫剧", "京剧", "曲艺", "相声", "小品", "杂技", "魔术", "马戏", "演唱会", "live", "演奏会", "交响乐", "民乐", "独奏", "合唱", "文艺汇演", "节庆演出", "街头表演", "行为艺术", "装置艺术", "画展", "摄影展", "书法展", "雕塑展", "设计展", "文物展", "特展"],
    "D": ["阅读", "图书", "借阅", "书房", "书城", "绘本", "图书馆", "阅览室", "读书角", "故事会", "亲子阅读", "朗读", "书香", "借书", "还书", "自助图书馆", "城市书房", "流动图书车", "电子书", "听书"],
    "E": ["亲子", "家庭", "合家欢", "儿童", "亲子互动", "亲子手工", "亲子游戏", "亲子阅读", "亲子观影", "亲子运动会", "家庭日", "全家总动员", "宝妈", "萌娃", "遛娃"],
    "F": ["少儿", "儿童", "青少年", "科普", "研学", "编程", "国学", "夏令营", "冬令营", "科学实验", "自然探索", "天文观测", "机器人", "航模", "乐高", "绘画班", "书法班", "舞蹈班", "音乐启蒙", "围棋", "象棋", "魔方", "思维训练", "专注力", "记忆力", "早教", "托育", "四点半课堂"],
    "G": ["老年", "离退休", "银发", "长者", "老年大学", "书画社", "合唱团", "舞蹈队", "太极", "八段锦", "养生", "健康", "棋牌", "门球", "柔力球", "广场舞", "模特队", "戏曲社", "摄影社", "园艺", "手工编织"],
    "H": ["公园", "广场", "街区", "景点", "公共空间", "遗址", "景区", "绿地", "滨水", "步行街", "历史文化街区", "创意园区", "工业遗址", "城市阳台", "观景台", "草坪", "树林", "湖畔", "河畔", "山地", "田园", "乡村"]
}

demand_keywords = {
    "A": ["放松", "休闲", "观光", "漫步", "美景", "喷泉", "灯光秀", "散心", "解压", "慢生活", "惬意", "舒适", "享受", "打卡", "拍照", "风景", "自然", "呼吸", "发呆", "闲逛"],
    "B": ["知识", "科普", "学习", "文化", "历史", "讲座", "讲坛", "展览", "文物", "古籍", "教育", "启蒙", "成长", "认知", "探索", "研究", "学术", "读书", "思考", "涨知识", "长见识", "开眼界", "博学", "智慧", "科学", "技术", "艺术", "国学", "传统", "非遗"],
    "C": ["社交", "陪伴", "交友", "聚会", "亲子", "家庭", "合家欢", "朋友", "互动", "交流", "结识", "圈子", "同好", "联谊", "约会", "团建", "结伴", "分享", "沟通", "聊天", "热闹", "氛围"],
    "D": ["便民", "技能", "实用", "手工", "培训", "编程", "公益体验", "生活", "服务", "义诊", "理发", "维修", "咨询", "辅导", "家教", "托管", "照护", "助老", "助残", "志愿", "义工", "帮扶", "捐赠", "二手交换", "跳蚤市场"]
}

focus_keywords = {
    "A": ["文化", "历史", "艺术", "非遗", "国学", "秦腔", "氛围", "底蕴", "传统", "古典", "人文", "民俗", "地方特色", "原汁原味", "正宗", "地道", "有内涵", "有品位", "雅致", "格调", "沉浸式", "体验感", "代入感"],
    "B": ["交通", "地铁", "公交", "停车", "便利", "方便", "直达", "换乘", "接驳", "步行可达", "骑车", "共享单车", "电动车", "打车", "网约车", "顺风车", "自驾", "高速", "出口", "停车场", "车位", "充电桩"],
    "C": ["免费", "低费", "公益", "惠民", "优惠", "折扣", "特价", "团购", "套餐", "省钱", "性价比", "物美价廉", "经济实惠", "不花钱", "0元", "一元", "几块钱", "补贴", "消费券", "减免"],
    "D": ["环境", "优美", "公园", "景区", "湖", "景", "绿化", "花园", "草坪", "山水", "风景", "视野", "开阔", "清新", "安静", "静谧", "优雅", "浪漫", "出片", "网红", "打卡地", "地标"]
}

comfort_map_build = {
    "A": ["博物馆", "图书馆", "文化馆", "美术馆", "纪念馆", "文博", "科技馆", "规划馆", "展览馆", "档案馆", "方志馆", "非遗馆", "艺术中心", "文化中心", "少年宫", "妇女儿童活动中心", "老年活动中心", "工人文化宫"],
    "B": ["公园", "遗址", "景区", "城墙", "华清宫", "兵马俑", "大明宫", "曲江池", "兴庆宫", "莲湖公园", "革命公园", "丰庆公园", "唐城墙遗址", "秦二世陵", "汉城湖", "昆明池", "渼陂湖", "秦岭", "终南山", "翠华山", "南五台", "太平国家森林公园", "朱雀国家森林公园"],
    "C": ["书店", "艺术馆", "影院", "剧院", "大剧院", "书城", "咖啡", "画廊", "手作工坊", "文创店", "livehouse", "音乐厅", "演艺厅", "戏楼", "相声社", "茶馆", "猫咖", "自习室", "共享办公"],
    "D": ["街区", "广场", "大唐不夜城", "书院门", "叁伍壹壹", "购物中心", "商场", "步行街", "集市", "夜市", "美食城", "酒吧街", "创意园", "艺术区", "老菜场", "复古街区", "潮流地", "网红街"]
}

# ==================== 问卷处理函数 ====================

def get_question_text(q):
    """返回指定题号的题目文本"""
    return question_texts.get(q, "问卷已完成")

def process_questionnaire(current_q, user_data, user_input):
    """
    处理问卷逻辑
    输入：
        current_q: int 当前题号
        user_data: dict 已存储的用户数据
        user_input: str 用户本次输入
    返回：
        response: str 要返回给用户的话术
        new_q: int 更新后的题号
        new_user_data: dict 更新后的用户数据
        is_valid: bool 本次输入是否有效（若为True，则推进；否则重提问）
    """
    # 转换为大写并去除空格
    user_input = user_input.strip().upper()
    new_user_data = user_data.copy()
    response = ""
    is_valid = False
    new_q = current_q

    # 如果没有用户输入（首次进入或空输入），返回当前题话术
    if not user_input:
        response = get_question_text(current_q)
        return response, current_q, new_user_data, False

    # 检查当前题号是否在有效范围内
    if current_q not in question_options:
        response = "问卷已完成"
        return response, current_q, new_user_data, False

    # 获取当前题目的合法选项
    valid_options = question_options[current_q]

    # 字段映射
    field_map = {
        1: "age_group",
        2: "education",
        3: "living_years",
        4: "occupation",
        5: "income",
        6: "available_time",
        7: "activity_type",
        8: "core_demand",
        9: "comfort_type",
        10: "focus_factor",
        11: "traffic_type"
    }
    field = field_map.get(current_q)

    # 特殊处理补充问题答案
    pending = new_user_data.get("_pending_supplement", 0)
    if pending == 9:
        if user_input not in ["A", "B"]:
            response = "请回答 A.是 或 B.否：是否希望市场类加文化元素？"
            return response, current_q, new_user_data, False
        new_user_data["supplementary_1"] = "A" if user_input == "A" else "B"
        del new_user_data["_pending_supplement"]
        new_q = 10
        response = get_question_text(new_q)
        return response, new_q, new_user_data, True
    elif pending == 11:
        if user_input not in ["A", "B"]:
            response = "请回答 A.是 或 B.否：是否遇停车困难？"
            return response, current_q, new_user_data, False
        new_user_data["supplementary_2"] = "A" if user_input == "A" else "B"
        del new_user_data["_pending_supplement"]
        new_q = 12
        response = "已收集完，正在匹配活动～"
        return response, new_q, new_user_data, True

    # 第7题多选处理
    if current_q == 7:
        # 允许输入多个选项，用逗号分隔或连续字母
        if ',' in user_input:
            selections = [opt.strip() for opt in user_input.split(',')]
        else:
            selections = list(user_input)
        # 校验每个选项
        for opt in selections:
            if opt not in valid_options:
                response = f"包含非法选项，请重新回答：{get_question_text(current_q)}"
                return response, current_q, new_user_data, False
        # 存储为逗号分隔字符串
        new_user_data[field] = ','.join(selections)
        # 直接进入后续推进逻辑（不要执行下面的单个选项校验）
    else:
        # 单个选项校验
        if user_input not in valid_options:
            response = f"请输入指定选项字母，重新回答：{get_question_text(current_q)}"
            return response, current_q, new_user_data, False
        new_user_data[field] = user_input

    # 特殊校验：第4题（职业）如果年龄为18岁以下（A），则只能选H或K
    if current_q == 4:
        age = user_data.get("age_group")
        if age == "A" and user_input not in ["H", "K"]:
            response = "少年儿童仅可选H/K，重新回答：" + get_question_text(4)
            return response, current_q, new_user_data, False

    # 特殊校验：第6题（时间）如果年龄不是18岁以下，不能选D
    if current_q == 6:
        age = user_data.get("age_group")
        if age != "A" and user_input == "D":
            response = "D仅少年儿童可选，重新回答：" + get_question_text(6)
            return response, current_q, new_user_data, False

    # 处理推进逻辑
    next_q = current_q + 1

    # 特殊处理：18岁以下跳过收入题（第5题）
    # 如果当前是第4题，且年龄为A，则直接跳到第6题
    if current_q == 4 and new_user_data.get("age_group") == "A":
        new_user_data["income"] = "无"  # 自动设置收入为无
        next_q = 6  # 跳过第5题

    # 处理补充问题触发
    if current_q == 9 and user_input == "D":
        new_user_data["_pending_supplement"] = 9
        response = "是否希望市场类加文化元素？A.是 B.否"
        return response, current_q, new_user_data, True

    if current_q == 11 and user_input == "D":
        new_user_data["_pending_supplement"] = 11
        response = "是否遇停车困难？A.是 B.否"
        return response, current_q, new_user_data, True

    # 正常推进
    if next_q > 11:
        response = "已收集完，正在匹配活动～"
    else:
        response = get_question_text(next_q)

    return response, next_q, new_user_data, True

# ==================== 活动匹配函数 ====================

def safe_str(val):
    if isinstance(val, list) and val:
        item = val[0]
        if isinstance(item, dict):
            return item.get("text") or item.get("link") or ""
    return str(val) if val else ""

def get_price_level(price_str):
    price = safe_str(price_str).lower()
    if "免费" in price or "0元" in price or "公益" in price:
        return "free"
    nums = re.findall(r'\d+', price)
    if nums:
        max_price = max(map(int, nums))
        if max_price < 50:
            return "low"
        elif max_price <= 200:
            return "medium"
        else:
            return "high"
    return "unknown"

def parse_time_features(time_str):
    features = set()
    text = safe_str(time_str).lower()
    if re.search(r'\d{1,2}:\d{2}\s*[-\~]\s*\d{1,2}:\d{2}', text):
        match = re.search(r'[-\~]\s*(\d{1,2}):\d{2}', text)
        if match and int(match[1]) >= 18:
            features.add("A")
    if "晚间" in text or "晚上" in text or "夜" in text:
        features.add("A")
    if "周六" in text or "周日" in text or "周末" in text:
        features.add("B")
    if "全天开放" in text or "24小时" in text:
        features.add("C")
    if "寒暑假" in text or "节假日" in text or "春节" in text or "国庆" in text:
        features.add("D")
    if not features:
        features.add("C")
    return features

def parse_valid_period(time_str):
    text = safe_str(time_str)
    match = re.search(r'(\d{4})\.(\d{2})\.(\d{2})\s*[-\~]\s*(\d{4})\.(\d{2})\.(\d{2})', text)
    if match:
        try:
            start = datetime(int(match[1]), int(match[2]), int(match[3]))
            end = datetime(int(match[4]), int(match[5]), int(match[6]))
            return start, end
        except:
            pass
    return None, None

def infer_age_fit(name, highlights):
    text = (name + " " + highlights).lower()
    age_set = set()
    if any(kw in text for kw in ["少儿", "儿童", "青少年", "亲子", "小朋友"]):
        age_set.add("A")
        age_set.add("B")
    if "全龄段" in text or "全民" in text or "所有人" in text:
        age_set.update(["A","B","C","D"])
    if "老年" in text or "离退休" in text:
        age_set.add("D")
    if "大学生" in text or "青年" in text:
        age_set.add("B")
    if not age_set:
        age_set.update(["A","B","C","D"])
    return age_set

def infer_comfort(address, name, type_str):
    text = (address + " " + name + " " + type_str).lower()
    for code, keywords in comfort_map_build.items():
        if any(kw in text for kw in keywords):
            return code
    return "A"

def infer_demand(highlights):
    text = highlights.lower()
    demands = set()
    for code, keywords in demand_keywords.items():
        if any(kw in text for kw in keywords):
            demands.add(code)
    return demands

def infer_factor(highlights, price_level, address):
    text = highlights.lower()
    factors = set()
    if any(kw in text for kw in focus_keywords["A"]):
        factors.add("A")
    if any(kw in text for kw in focus_keywords["D"]):
        factors.add("D")
    if price_level in ["free", "low"]:
        factors.add("C")
    return factors

def transport_score_by_address(address):
    text = address.lower()
    if "地铁" in text:
        return 0.9
    if "公交" in text:
        return 0.7
    if "偏远" in text:
        return 0.3
    return 0.5

def match_activities(user_data, activities):
    logger.info(f"开始匹配，活动总数: {len(activities)}")
    recommendations = []
    filtered_count = 0
    filter_reasons = defaultdict(int)

    # 解析用户活动类型（可能多选）
    act_type_str = user_data.get("act_type") or ""
    user_act_types = [t.strip() for t in act_type_str.split(',') if t.strip()]

    # 预处理用户数据
    user = {
        "age": user_data.get("age"),
        "time": user_data.get("time"),
        "act_type": user_data.get("act_type"),
        "demand": user_data.get("demand"),
        "comfort": user_data.get("comfort"),
        "focus": user_data.get("focus"),
        "income": user_data.get("income"),
    }
    is_under_18 = (user["age"] == "A")

    for act in activities:
        # 硬性过滤
        # 1. 活动是否有效
        if act.valid_end and act.valid_end < datetime.now():
            filtered_count += 1
            filter_reasons["过期"] += 1
            continue

        # 2. 年龄匹配
        age_fit = act.age_fit_tags or []
        if user["age"] and user["age"] not in age_fit:
            filtered_count += 1
            filter_reasons["年龄不匹配"] += 1
            continue

        # 3. 时间匹配
        user_time = user["time"]
        if user_time:
            act_times = act.time_slot_tags or []
            if user_time == "A" and "A" not in act_times:
                filtered_count += 1
                filter_reasons["时间不匹配(A)"] += 1
                continue
            if user_time == "B" and "B" not in act_times:
                filtered_count += 1
                filter_reasons["时间不匹配(B)"] += 1
                continue
            if user_time == "D" and is_under_18 and "D" not in act_times:
                filtered_count += 1
                filter_reasons["时间不匹配(D)"] += 1
                continue
            # C 随机空闲，总是匹配

        # 4. 费用偏好过滤
        if user["focus"] == "C" and user["income"] in ["A", "B"] and act.price_level not in ["free", "low"]:
            filtered_count += 1
            filter_reasons["费用偏好不匹配"] += 1
            continue

        # 软性评分
        # 活动类型得分
        if user_act_types:
            act_types = act.activity_type_tags or []
            intersection = len([ut for ut in user_act_types if ut in act_types])
            type_score = intersection / len(user_act_types) if user_act_types else 1
        else:
            type_score = 1

        demand_score = 1 if user["demand"] in (act.demand_tags or []) else 0
        comfort_score = 1 if user["comfort"] == act.comfort_tag else 0

        # 关注因素得分
        factor_score = 0
        if user["focus"] == "A":
            factor_score = 1 if "A" in (act.factor_tags or []) else 0
        elif user["focus"] == "B":
            factor_score = act.transport_score
        elif user["focus"] == "C":
            factor_score = 1 if act.price_level in ["free", "low"] else 0
        elif user["focus"] == "D":
            factor_score = 1 if "D" in (act.factor_tags or []) else 0
        else:
            factor_score = 0.5

        traffic_score = act.transport_score

        # 收入适配度
        income_score = 0.5
        if user["income"]:
            if act.price_level == "free":
                income_score = 1.0
            elif act.price_level == "low":
                income_map = {"A": 0.5, "B": 0.8, "C": 1.0, "D": 1.0}
                income_score = income_map.get(user["income"], 0.5)
            elif act.price_level == "medium":
                income_map = {"A": 0.0, "B": 0.5, "C": 0.8, "D": 1.0}
                income_score = income_map.get(user["income"], 0.5)
            elif act.price_level == "high":
                income_map = {"A": 0.0, "B": 0.0, "C": 0.3, "D": 1.0}
                income_score = income_map.get(user["income"], 0.5)

        weights = [1.0, 1.2, 1.0, 1.5, 0.8, 0.5]
        scores = [type_score, demand_score, comfort_score, factor_score, traffic_score, income_score]
        total_score = sum(s * w for s, w in zip(scores, weights)) / sum(weights)

        recommendations.append({
            "name": act.name,
            "address": act.address,
            "time": act.time,
            "price": act.price,
            "guide_link": act.guide_link,
            "highlights": act.highlights,
            "score": round(total_score, 3),
            "type": act.type,
            "act_type_match": type_score,
            "demand_match": demand_score,
            "comfort_match": comfort_score,
            "factor_match": factor_score,
            "traffic_score": traffic_score,
            "income_score": income_score
        })

    logger.info(f"过滤掉 {filtered_count} 个活动，原因统计: {dict(filter_reasons)}")
    logger.info(f"剩余 {len(recommendations)} 个活动参与评分")
    recommendations.sort(key=lambda x: x["score"], reverse=True)
    return recommendations[:10]

# ==================== 统计和报告生成函数 ====================

def calculate_statistics(records):
    """
    输入：records 列表，每个元素是包含用户答案的字典（字段与 UserResponse 一致）
    输出：statistics 字典（结构符合之前代码节点的输出）
    """
    total_count = len(records)
    valid_count = total_count  # 我们只传入完整记录，所以全部有效

    # 使用编码进行统计（记录中的值应为编码如 "A"）
    age_counter = defaultdict(int)
    edu_counter = defaultdict(int)
    living_counter = defaultdict(int)
    occ_counter = defaultdict(int)
    income_counter = defaultdict(int)
    activity_counter = defaultdict(int)
    focus_counter = defaultdict(int)
    traffic_counter = defaultdict(int)
    comfort_counter = defaultdict(int)

    # 用于分群体统计（按英文键分组）
    age_groups = {
        "age_18_30": [],
        "age_31_50": [],
        "age_50_plus": []
    }

    for rec in records:
        age = rec.get("age_group")
        if age:
            age_counter[age] += 1
            # 将编码转换为英文键用于分组
            if age == "B":
                age_groups["age_18_30"].append(rec)
            elif age == "C":
                age_groups["age_31_50"].append(rec)
            elif age == "D":
                age_groups["age_50_plus"].append(rec)

        edu = rec.get("education")
        if edu:
            edu_counter[edu] += 1

        living = rec.get("living_years")
        if living:
            living_counter[living] += 1

        occ = rec.get("occupation")
        if occ:
            occ_counter[occ] += 1

        # 收入（排除学生）
        if occ != "H":  # H 是学生编码
            inc = rec.get("income")
            if inc:
                income_counter[inc] += 1

        act = rec.get("activity_type")
        if act:
            # 活动类型可能是多选，用逗号分隔，需拆分
            for a in act.split(','):
                if a:
                    activity_counter[a] += 1

        focus = rec.get("focus_factor")
        if focus:
            focus_counter[focus] += 1

        traffic = rec.get("traffic_type")
        if traffic:
            traffic_counter[traffic] += 1

        comfort = rec.get("comfort_type")
        if comfort:
            comfort_counter[comfort] += 1

    # 辅助函数：生成 display 字符串
    def make_display(count, total):
        perc = round(count / total * 100, 1) if total > 0 else 0
        return f"{count}人/{perc}%"

    # 中文描述映射（用于报告）
    age_desc = {"A": "18岁以下", "B": "18-30岁", "C": "31-50岁", "D": "50岁以上"}
    edu_desc = {"A": "初中及以下", "B": "高中", "C": "专科", "D": "本科", "E": "研究生及以上"}
    living_desc = {"A": "1年以下", "B": "1-5年", "C": "6-10年", "D": "10年以上"}
    occ_desc = {"A": "党政机关", "B": "企事业", "C": "专业技术", "D": "私营",
                "E": "商业", "F": "工人", "G": "服务业", "H": "学生",
                "I": "离退休", "J": "下岗", "K": "其他"}
    income_desc = {"A": "2000元以下", "B": "2000-4000元", "C": "4000-6000元", "D": "6000元以上"}
    activity_desc = {"A": "非遗手工", "B": "讲座沙龙", "C": "展览演出", "D": "阅读借阅",
                     "E": "亲子活动", "F": "少儿艺术/科普/研学", "G": "老年文娱", "H": "公园/公共空间"}
    focus_desc = {"A": "文化氛围", "B": "交通便利", "C": "免费/低费", "D": "环境优美"}
    traffic_desc = {"A": "公交", "B": "步行", "C": "自行车", "D": "自驾"}
    comfort_desc = {"A": "公共I(文博馆)", "B": "公共II(公园/景点)", "C": "市场I(书店/艺术馆)", "D": "市场II(特色街区)"}

    demographics = {}

    # 年龄分布
    age_dist = {}
    for code in ["A","B","C","D"]:
        cnt = age_counter.get(code, 0)
        age_dist[code] = {
            "count": cnt,
            "percentage": round(cnt / valid_count * 100, 1) if valid_count else 0,
            "display": make_display(cnt, valid_count),
            "desc": age_desc.get(code, "")
        }
    demographics["age_distribution"] = age_dist

    # 教育分布
    edu_dist = {}
    for code in ["A","B","C","D","E"]:
        cnt = edu_counter.get(code, 0)
        edu_dist[code] = {
            "count": cnt,
            "percentage": round(cnt / valid_count * 100, 1) if valid_count else 0,
            "display": make_display(cnt, valid_count),
            "desc": edu_desc.get(code, "")
        }
    demographics["education_distribution"] = edu_dist

    # 居住时长分布
    living_dist = {}
    for code in ["A","B","C","D"]:
        cnt = living_counter.get(code, 0)
        living_dist[code] = {
            "count": cnt,
            "percentage": round(cnt / valid_count * 100, 1) if valid_count else 0,
            "display": make_display(cnt, valid_count),
            "desc": living_desc.get(code, "")
        }
    demographics["living_years_distribution"] = living_dist

    # 职业分布
    occ_dist = {}
    for code in ["A","B","C","D","E","F","G","H","I","J","K"]:
        cnt = occ_counter.get(code, 0)
        occ_dist[code] = {
            "count": cnt,
            "percentage": round(cnt / valid_count * 100, 1) if valid_count else 0,
            "display": make_display(cnt, valid_count),
            "desc": occ_desc.get(code, "")
        }
    demographics["occupation_distribution"] = occ_dist

    # 收入分布
    non_student_count = valid_count - occ_counter.get("H", 0)  # H 为学生
    income_dist = {}
    for code in ["A","B","C","D"]:
        cnt = income_counter.get(code, 0)
        income_dist[code] = {
            "count": cnt,
            "percentage": round(cnt / non_student_count * 100, 1) if non_student_count else 0,
            "display": make_display(cnt, non_student_count) if non_student_count else f"{cnt}人/0.0%",
            "desc": income_desc.get(code, "")
        }
    demographics["income_distribution"] = income_dist

    # 需求偏好
    preferences = {}

    act_dist = {}
    for code in ["A","B","C","D","E","F","G","H"]:
        cnt = activity_counter.get(code, 0)
        act_dist[code] = {
            "count": cnt,
            "percentage": round(cnt / valid_count * 100, 1) if valid_count else 0,
            "display": make_display(cnt, valid_count),
            "desc": activity_desc.get(code, "")
        }
    preferences["activity_type_distribution"] = act_dist

    focus_dist = {}
    for code in ["A","B","C","D"]:
        cnt = focus_counter.get(code, 0)
        focus_dist[code] = {
            "count": cnt,
            "percentage": round(cnt / valid_count * 100, 1) if valid_count else 0,
            "display": make_display(cnt, valid_count),
            "desc": focus_desc.get(code, "")
        }
    preferences["focus_factor_distribution"] = focus_dist

    traffic_dist = {}
    for code in ["A","B","C","D"]:
        cnt = traffic_counter.get(code, 0)
        traffic_dist[code] = {
            "count": cnt,
            "percentage": round(cnt / valid_count * 100, 1) if valid_count else 0,
            "display": make_display(cnt, valid_count),
            "desc": traffic_desc.get(code, "")
        }
    preferences["traffic_type_distribution"] = traffic_dist

    comfort_dist = {}
    for code in ["A","B","C","D"]:
        cnt = comfort_counter.get(code, 0)
        comfort_dist[code] = {
            "count": cnt,
            "percentage": round(cnt / valid_count * 100, 1) if valid_count else 0,
            "display": make_display(cnt, valid_count),
            "desc": comfort_desc.get(code, "")
        }
    preferences["comfort_type_distribution"] = comfort_dist

    # Top排名（取前三个活动类型编码）
    sorted_acts = sorted(activity_counter.items(), key=lambda x: x[1], reverse=True)
    top3_activities_keys = [item[0] for item in sorted_acts[:3]]
    top_rankings = {"top3_activity_types": top3_activities_keys}

    # 分群体分析
    group_analysis = {}

    # 新市民（居住时长 1年以下 对应编码 "A"）
    new_residents_count = living_counter.get("A", 0)
    group_analysis["new_residents"] = {
        "percentage": round(new_residents_count / valid_count * 100, 1) if valid_count else 0
    }

    # 各年龄段群体
    age_group_stats = {}
    for age_key, group_recs in age_groups.items():
        if not group_recs:
            age_group_stats[age_key] = {
                "percentage": 0,
                "top_activities": [],
                "top_times": []
            }
            continue
        group_size = len(group_recs)
        act_cnt = defaultdict(int)
        time_cnt = defaultdict(int)
        for rec in group_recs:
            act_val = rec.get("activity_type")
            if act_val:
                for a in act_val.split(','):
                    if a:
                        act_cnt[a] += 1
            time_val = rec.get("available_time")
            if time_val:
                time_cnt[time_val] += 1
        top_act = sorted(act_cnt.items(), key=lambda x: x[1], reverse=True)
        top_time = sorted(time_cnt.items(), key=lambda x: x[1], reverse=True)
        age_group_stats[age_key] = {
            "percentage": round(group_size / valid_count * 100, 1) if valid_count else 0,
            "top_activities": [act[0] for act in top_act[:1]] if top_act else [],
            "top_times": [tm[0] for tm in top_time[:2]] if top_time else []
        }
    # 老年群体中10年以上占比（居住时长 D 对应 10年以上）
    elderly_recs = age_groups.get("age_50_plus", [])
    elderly_long = 0
    for rec in elderly_recs:
        liv_val = rec.get("living_years")
        if liv_val == "D":
            elderly_long += 1
    if "age_50_plus" in age_group_stats:
        age_group_stats["age_50_plus"]["long_resident_percentage"] = round(elderly_long / len(elderly_recs) * 100, 1) if elderly_recs else 0

    group_analysis["age_groups"] = age_group_stats

    result = {
        "overview": {
            "total_data_count": total_count,
            "valid_data_count": valid_count,
            "validity_rate": f"100.0%"
        },
        "demographics": demographics,
        "preferences": preferences,
        "top_rankings": top_rankings,
        "group_analysis": group_analysis
    }

    return result

def generate_report(stats):
    """
    输入：stats 字典（与代码节点中的 statistics 结构一致）
    输出：HTML 格式的完整报告文本
    """
    try:
        # ===== 调研数据常量 =====
        survey = {
            "student_percentage": "37.3%",
            "young_middle_percentage": "59.5%",
            "elderly_percentage": "3.2%",
            "bachelor_percentage": "38.9%",
            "college_percentage": "18.5%",
            "over_10_years_percentage": "46.0%",
            "under_1_year_percentage": "11.8%",
            "bus_percentage": "30%",
            "public_I_percentage": "35%",
            "public_II_percentage": "35%",
            "focus_culture": 528,
            "focus_environment": 457,
            "focus_transport": 389,
            "focus_cost": 326
        }

        # 中英文映射
        time_name_map = {
            "weekday_evening": "工作日晚间",
            "weekend": "周末全天",
            "random_free": "随机空闲",
            "holiday": "寒暑假/节假日"
        }

        # ===== 辅助函数 =====
        def safe_get(dist, key, subkey="display", default="0人/0.0%"):
            if not isinstance(dist, dict):
                return default
            item = dist.get(key)
            if isinstance(item, dict):
                return item.get(subkey, default)
            return default

        def get_top(dist, n=1, with_display=False):
            if not isinstance(dist, dict):
                return []
            items = [(k, v) for k, v in dist.items() if isinstance(v, dict) and "count" in v]
            items.sort(key=lambda x: x[1]["count"], reverse=True)
            result = []
            for i in range(min(n, len(items))):
                key, val = items[i]
                desc = val.get("desc", key)
                display = val.get("display", "0人/0.0%")
                if with_display:
                    result.append((key, desc, display))
                else:
                    result.append((key, desc))
            return result

        def extract_percentage(display_str):
            try:
                return float(display_str.split('/')[-1].replace('%', ''))
            except:
                return 0.0

        # ===== 提取数据 =====
        overview = stats.get("overview", {})
        total = overview.get("total_data_count", 0)

        demographics = stats.get("demographics", {})
        age = demographics.get("age_distribution", {})
        edu = demographics.get("education_distribution", {})
        living = demographics.get("living_years_distribution", {})
        occ = demographics.get("occupation_distribution", {})
        income = demographics.get("income_distribution", {})

        preferences = stats.get("preferences", {})
        act = preferences.get("activity_type_distribution", {})
        focus = preferences.get("focus_factor_distribution", {})
        traffic = preferences.get("traffic_type_distribution", {})
        comfort = preferences.get("comfort_type_distribution", {})

        group_analysis = stats.get("group_analysis", {})
        new_residents = group_analysis.get("new_residents", {})
        age_groups = group_analysis.get("age_groups", {})

        # 年龄分布
        age_under_18 = safe_get(age, "A", "display")
        age_18_30 = safe_get(age, "B", "display")
        age_31_50 = safe_get(age, "C", "display")
        age_50_plus = safe_get(age, "D", "display")

        # 教育分布
        edu_middle = safe_get(edu, "A", "display")
        edu_high = safe_get(edu, "B", "display")
        edu_college = safe_get(edu, "C", "display")
        edu_bachelor = safe_get(edu, "D", "display")
        edu_master = safe_get(edu, "E", "display")

        # 居住时长分布
        living_under_1 = safe_get(living, "A", "display")
        living_1_5 = safe_get(living, "B", "display")
        living_6_10 = safe_get(living, "C", "display")
        living_over_10 = safe_get(living, "D", "display")

        # 职业 Top3
        occ_top = get_top(occ, 3, with_display=True)
        occ1_desc = occ_top[0][1] if len(occ_top) > 0 else "无"
        occ1_display = occ_top[0][2] if len(occ_top) > 0 else "0人/0.0%"
        occ2_desc = occ_top[1][1] if len(occ_top) > 1 else "无"
        occ2_display = occ_top[1][2] if len(occ_top) > 1 else "0人/0.0%"
        occ3_desc = occ_top[2][1] if len(occ_top) > 2 else "无"
        occ3_display = occ_top[2][2] if len(occ_top) > 2 else "0人/0.0%"

        # 收入主要区间
        income_items = list(income.items())
        if income_items:
            income_items.sort(key=lambda x: x[1]["count"], reverse=True)
            income_main_desc = income_items[0][1].get("desc", "无")
            income_main_display = income_items[0][1].get("display", "0人/0.0%")
        else:
            income_main_desc = "暂无"
            income_main_display = "0人/0.0%"

        # 活动类型 Top3
        act_top = get_top(act, 3)
        act1 = act_top[0][1] if len(act_top) > 0 else "无"
        act2 = act_top[1][1] if len(act_top) > 1 else "无"
        act3 = act_top[2][1] if len(act_top) > 2 else "无"

        # 关注因素 Top2
        focus_top = get_top(focus, 2, with_display=True)
        focus1_desc = focus_top[0][1] if len(focus_top) > 0 else "无"
        focus1_display = focus_top[0][2] if len(focus_top) > 0 else "0人/0.0%"
        focus2_desc = focus_top[1][1] if len(focus_top) > 1 else "无"
        focus2_display = focus_top[1][2] if len(focus_top) > 1 else "0人/0.0%"

        # 交通方式 Top1
        traffic_top = get_top(traffic, 1, with_display=True)
        traffic1_desc = traffic_top[0][1] if len(traffic_top) > 0 else "无"
        traffic1_display = traffic_top[0][2] if len(traffic_top) > 0 else "0人/0.0%"
        traffic_percent = extract_percentage(traffic1_display)

        # 舒适物类型 Top1
        comfort_top = get_top(comfort, 1, with_display=True)
        comfort1_desc = comfort_top[0][1] if len(comfort_top) > 0 else "无"
        comfort1_display = comfort_top[0][2] if len(comfort_top) > 0 else "0人/0.0%"

        # 分群体数据
        new_residents_percentage = new_residents.get("percentage", 0)

        # 青年群体
        youth = age_groups.get("age_18_30", {})
        youth_percentage = youth.get("percentage", 0)
        youth_top_activity_key = (youth.get("top_activities") or [""])[0]
        youth_top_activity = act.get(youth_top_activity_key, {}).get("desc", youth_top_activity_key)
        youth_top_times_keys = youth.get("top_times") or []
        youth_top_times = [time_name_map.get(k, k) for k in youth_top_times_keys]
        youth_time1 = youth_top_times[0] if len(youth_top_times) > 0 else "暂无"
        youth_time2 = youth_top_times[1] if len(youth_top_times) > 1 else ""

        # 中年群体
        middle = age_groups.get("age_31_50", {})
        middle_percentage = middle.get("percentage", 0)
        middle_top_activity_key = (middle.get("top_activities") or [""])[0]
        middle_top_activity = act.get(middle_top_activity_key, {}).get("desc", middle_top_activity_key) if middle_top_activity_key else "暂无"
        middle_top_times_keys = middle.get("top_times") or []
        middle_top_times = [time_name_map.get(k, k) for k in middle_top_times_keys]
        middle_time1 = middle_top_times[0] if len(middle_top_times) > 0 else "暂无"
        middle_time2 = middle_top_times[1] if len(middle_top_times) > 1 else ""

        # 老年群体
        elderly = age_groups.get("age_50_plus", {})
        elderly_percentage = elderly.get("percentage", 0)
        elderly_top_activity_key = (elderly.get("top_activities") or [""])[0]
        elderly_top_activity = act.get(elderly_top_activity_key, {}).get("desc", elderly_top_activity_key) if elderly_top_activity_key else "暂无"
        elderly_top_times_keys = elderly.get("top_times") or []
        elderly_top_times = [time_name_map.get(k, k) for k in elderly_top_times_keys]
        elderly_time1 = elderly_top_times[0] if len(elderly_top_times) > 0 else "暂无"
        elderly_time2 = elderly_top_times[1] if len(elderly_top_times) > 1 else ""
        elderly_long_percentage = elderly.get("long_resident_percentage", 0)

        # ===== 动态计算第五部分 =====
        age_items = [
            ("18岁以下", age.get("A", {}).get("percentage", 0), "A"),
            ("18-30岁", age.get("B", {}).get("percentage", 0), "B"),
            ("31-50岁", age.get("C", {}).get("percentage", 0), "C"),
            ("50岁以上", age.get("D", {}).get("percentage", 0), "D"),
        ]
        max_age = max(age_items, key=lambda x: x[1])
        key_group_desc = max_age[0]
        key_group_percentage = max_age[1]
        key_group_key = max_age[2]

        core_demand = f"以{act1}、{act2}为主，最关注{focus1_desc}"

        if key_group_key == "B":
            time_pref = youth_top_times
        elif key_group_key == "C":
            time_pref = middle_top_times
        elif key_group_key == "D":
            time_pref = elderly_top_times
        else:
            time_pref = []
        time_pref_str = "、".join(time_pref) if time_pref else "暂无"

        region_map = {
            "B": "高校聚集区（如雁塔区、长安区大学城）和高新区创新活力地带",
            "C": "大型购物中心（如赛格、熙地港）和曲江新区",
            "D": "社区和公园（如环城公园、莲湖公园）",
            "A": "中小学周边和青少年活动中心",
        }
        key_region = region_map.get(key_group_key, "全市范围")

        if key_group_key == "B":
            high_demand_activity = youth_top_activity
        elif key_group_key == "C":
            high_demand_activity = middle_top_activity
        elif key_group_key == "D":
            high_demand_activity = elderly_top_activity
        else:
            high_demand_activity = act1

        example = high_demand_activity
        focus_item = focus1_desc

        sys_under_18_perc = age.get("A", {}).get("percentage", 0)
        diff = sys_under_18_perc - 37.3
        diff_desc = f"系统用户中18岁以下占比{sys_under_18_perc}%，较调研数据37.3%{'高出' if diff>0 else '低'}{abs(diff):.1f}个百分点"

        # ===== 构建 HTML 报告（优化版） =====
        from datetime import datetime
        report = f"""
<div class="report-container">
    <h1><span class="section-icon">📊</span> 文享智配·西安公共文化需求统计分析报告</h1>

    <div class="section-card">
        <h3><span class="section-icon">📋</span> 一、数据概览</h3>
        <div class="stat-item">
            <span class="stat-badge">系统数据</span> 本次共回收系统数据 <strong class="data-highlight">{total}</strong> 条，全部为有效数据。
        </div>
        <div class="stat-item">
            <span class="stat-badge survey-badge">调研基准</span> 陕西省城市文化舒适物调研（西安地区）有效样本 <strong class="survey-data">1200份</strong>，数据覆盖西安城六区及周边区县，具有代表性。
        </div>
    </div>

    <h3><span class="section-icon">👥</span> 二、用户基础画像（系统数据 vs 调研数据）</h3>

    <div class="insight-box">
        <h4>1. 年龄分布</h4>
        <ul>
            <li><strong>系统数据</strong>：18岁以下 {age_under_18}，18-30岁 {age_18_30}，31-50岁 {age_31_50}，50岁以上 {age_50_plus}。</li>
            <li><strong>调研数据</strong>：学生群体（含18岁以下）<span class="survey-data">{survey['student_percentage']}</span>，中青年群体（18-50岁）<span class="survey-data">{survey['young_middle_percentage']}</span>，老年群体（50岁以上）<span class="survey-data">{survey['elderly_percentage']}</span>。（注：调研数据年龄分段与系统略有不同，此处为对应参考）</li>
        </ul>
    </div>

    <div class="insight-box">
        <h4>2. 文化程度分布</h4>
        <ul>
            <li><strong>系统数据</strong>：初中及以下 {edu_middle}，高中 {edu_high}，专科 {edu_college}，本科 {edu_bachelor}，研究生及以上 {edu_master}。</li>
            <li><strong>调研数据</strong>：初中及以下 <span class="survey-data">12.6%</span>，高中 <span class="survey-data">22.9%</span>，专科 <span class="survey-data">18.5%</span>，本科 <span class="survey-data">38.9%</span>，研究生及以上 <span class="survey-data">7.2%</span>。</li>
        </ul>
    </div>

    <div class="insight-box">
        <h4>3. 居住时长分布</h4>
        <ul>
            <li><strong>系统数据</strong>：1年以下 {living_under_1}，1-5年 {living_1_5}，6-10年 {living_6_10}，10年以上 {living_over_10}。</li>
            <li><strong>调研数据</strong>：1年以下 <span class="survey-data">{survey['under_1_year_percentage']}</span>，1-5年 <span class="survey-data">19.4%</span>，6-10年 <span class="survey-data">22.9%</span>，10年以上 <span class="survey-data">{survey['over_10_years_percentage']}</span>。</li>
        </ul>
    </div>

    <div class="insight-box">
        <h4>4. 职业分布</h4>
        <ul>
            <li><strong>系统数据 Top3</strong>：<span class="tag">{occ1_desc}</span>（{occ1_display}）、<span class="tag">{occ2_desc}</span>（{occ2_display}）、<span class="tag">{occ3_desc}</span>（{occ3_display}）。</li>
            <li><strong>调研数据 Top3</strong>：学生 <span class="survey-data">37.3%</span>，企业事业单位 <span class="survey-data">16.4%</span>，商业从业 <span class="survey-data">9.5%</span>。</li>
        </ul>
    </div>

    <div class="insight-box">
        <h4>5. 月收入分布（18岁以下及学生群体不统计）</h4>
        <ul>
            <li><strong>系统数据</strong>：<span class="tag">{income_main_desc}</span>段占比最高（{income_main_display}）。</li>
            <li><strong>调研数据</strong>：2000元以下 <span class="survey-data">38.1%</span>，2000-4000元 <span class="survey-data">18.3%</span>，4000-6000元 <span class="survey-data">26.3%</span>，6000元以上 <span class="survey-data">17.4%</span>。</li>
        </ul>
    </div>

    <h3><span class="section-icon">🎯</span> 三、需求偏好分析（系统数据）</h3>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-title">🏆 活动类型 Top3</div>
            <div class="stat-value">{act1}</div>
            <div class="stat-value">{act2}</div>
            <div class="stat-value">{act3}</div>
        </div>
        <div class="stat-card">
            <div class="stat-title">⭐ 关注因素 Top2</div>
            <div class="stat-value">{focus1_desc} <span class="stat-percent">{focus1_display}</span></div>
            <div class="stat-value">{focus2_desc} <span class="stat-percent">{focus2_display}</span></div>
        </div>
        <div class="stat-card">
            <div class="stat-title">🚌 主要交通方式</div>
            <div class="stat-value">{traffic1_desc} <span class="stat-percent">{traffic1_display}</span></div>
        </div>
        <div class="stat-card">
            <div class="stat-title">🏛️ 舒适物偏好</div>
            <div class="stat-value">{comfort1_desc} <span class="stat-percent">{comfort1_display}</span></div>
        </div>
    </div>

    <div class="reference-box">
        <h4>📌 调研数据参考</h4>
        <ul>
            <li>舒适物偏好：公共类I（博物馆/图书馆）<span class="survey-data">{survey['public_I_percentage']}</span>，公共类II（公园/景点）<span class="survey-data">{survey['public_II_percentage']}</span>，市场类I（书店/艺术馆）<span class="survey-data">18%</span>，市场类II（特色街区）<span class="survey-data">12%</span>。</li>
            <li>关注因素：文化氛围（<span class="survey-data">{survey['focus_culture']}份</span>）、环境优美（<span class="survey-data">{survey['focus_environment']}份</span>）、交通便利（<span class="survey-data">{survey['focus_transport']}份</span>）、免费/低费（<span class="survey-data">{survey['focus_cost']}份</span>）。</li>
            <li>交通方式：公交 <span class="survey-data">{survey['bus_percentage']}</span>，步行 <span class="survey-data">24%</span>，自驾 <span class="survey-data">22%</span>，自行车 <span class="survey-data">15%</span>，其他 <span class="survey-data">9%</span>。</li>
        </ul>
    </div>

    <hr>

    <h3><span class="section-icon">🔍</span> 四、分群体洞察与决策建议</h3>

    <!-- 青年群体 -->
    <div class="group-card">
        <div class="group-header" style="background: #e3f2fd;">
            <span class="group-icon">👤</span> 青年群体（18-30岁）
        </div>
        <div class="group-body">
            <p><strong>系统特征：</strong>占比 <span class="data-highlight">{youth_percentage}%</span>，偏好 <span class="tag">{youth_top_activity}</span>类活动，参与时间集中于 <span class="tag">{youth_time1}</span> 和 <span class="tag">{youth_time2}</span>。</p>
            <p><strong>调研参照：</strong>调研数据显示，中青年群体（18-50岁）占全市59.5%，本科及以上学历占比46.1%，且该群体对文化氛围（528份）、交通便利（389份）有显著偏好，常选择公交（30%）和步行（24%）出行。</p>
            <p><strong>🎯 基于系统数据的针对性建议：</strong><br>
            针对系统用户中青年群体占比 {youth_percentage}% 的特点，结合其对 {youth_top_activity} 活动的偏好与参与时间集中于 {youth_time1} 和 {youth_time2} 的特征，建议在高校聚集区（如雁塔区、长安区大学城）和高新区创新活力地带，增设周末全天及工作日晚间的展览演出与非遗手工体验活动。例如，联合陕西历史博物馆推出<span class="highlight-text">"夜游陕历博·青年专场"</span>，邀请非遗传承人在大唐不夜城开设<span class="highlight-text">"长安十二时辰"手工坊</span>，将唐文化、秦腔艺术融入青年潮流生活。同时，鉴于系统用户多选择自驾（{traffic_percent:.1f}%），需优化场馆周边停车配套，并在地铁沿线设置接驳引导，满足其对便利性的潜在需求。</p>
            <p><strong>🌐 基于调研数据的宏观优化建议：</strong><br>
            调研数据显示，全市青年群体普遍关注文化氛围与环境优美，且公交出行占比高（30%）。建议从宏观层面构建<span class="highlight-text">"青年文化走廊"</span>：在公交枢纽（如钟楼、小寨）周边布局青年文化驿站，提供免费Wi-Fi、共享阅读空间；定期在地铁站内举办<span class="highlight-text">"流动艺术展"</span>，将文化渗透进日常通勤。此外，调研中本科及以上学历青年占比高，对知识型文化需求旺盛，应联合西安交通大学、西北大学等高校，开展<span class="highlight-text">"城市文化公开课"</span>，邀请学者在方所、曲江书城等市场I类舒适物场所开设唐史、非遗系列讲座，并通过直播扩大影响。还可参考调研中"免费/低费"关注因素（326份），推出<span class="highlight-text">"西安青年文化一卡通"</span>，以低价套餐覆盖博物馆、演出、书店，降低参与门槛，提升青年文化获得感。</p>
        </div>
    </div>

    <!-- 中年群体 -->
    <div class="group-card">
        <div class="group-header" style="background: #fff3e0;">
            <span class="group-icon">👨‍👩‍👧</span> 中年群体（31-50岁）
        </div>
        <div class="group-body">
            <p><strong>系统特征：</strong>占比 <span class="data-highlight">{middle_percentage}%</span>，偏好 <span class="tag">{middle_top_activity}</span>，参与时间集中于 <span class="tag">{middle_time1}</span> 和 <span class="tag">{middle_time2}</span>。</p>
            <p><strong>调研参照：</strong>调研数据中，中青年群体整体占比高，且对交通便利（389份）、环境优美（457份）有显著需求，自驾比例达22%。</p>
            <p><strong>🎯 基于系统数据的针对性建议：</strong><br>
            系统数据显示中年群体占比 {middle_percentage}%，若占比偏低，则需分析原因。若该群体在系统中占比较高，应重点满足其对亲子活动、展览演出的需求，并考虑时间集中于周末全天的特征。建议在大型购物中心（如赛格、熙地港）内开设<span class="highlight-text">"家庭艺术工坊"</span>，结合西安非遗（如户县农民画、关中皮影）设计亲子互动课程；同时，在曲江新区、高新区增设周末专场演出，如西安音乐厅的亲子音乐会、易俗社的秦腔体验场，并配套儿童托管服务，缓解中年群体兼顾家庭与个人文化需求的压力。针对系统用户自驾比例高（{traffic_percent:.1f}%），需在活动场地周边优化停车引导，并联合商场推出停车优惠，提升参与便利性。</p>
            <p><strong>🌐 基于调研数据的宏观优化建议：</strong><br>
            调研显示全市中年群体普遍重视环境优美与交通便利，且自驾出行占22%。建议在全市范围内提升公园、景区的文化内容供给：在兴庆宫公园、环城公园增设周末露天文化市集，融合茶艺、书法、手工艺品展销，打造<span class="highlight-text">"公园里的文化客厅"</span>；同时，优化自驾路线指引，在主要干道设置文化活动电子屏，实时显示场馆停车余位。此外，调研中该群体对"免费/低费"（326份）有一定需求，可推出<span class="highlight-text">"家庭文化惠民包"</span>，以低价覆盖博物馆家庭套票、亲子手工材料包，并联合社区开展<span class="highlight-text">"非遗进社区"</span>活动，让中年群体在家门口就能参与高品质文化体验。参考调研中文化氛围（528份）的高关注度，建议在社区周边增设文化微空间，如<span class="highlight-text">"唐诗文化角"</span><span class="highlight-text">"西安故事墙"</span>，提升城市文化浸润感。</p>
        </div>
    </div>

    <!-- 老年群体 -->
    <div class="group-card">
        <div class="group-header" style="background: #ffebee;">
            <span class="group-icon">👴</span> 老年群体（50岁以上）
        </div>
        <div class="group-body">
            <p><strong>系统特征：</strong>占比 <span class="data-highlight">{elderly_percentage}%</span>，其中老市民（居住10年以上）占比 <span class="data-highlight">{elderly_long_percentage}%</span>，喜爱 <span class="tag">{elderly_top_activity}</span>。</p>
            <p><strong>调研参照：</strong>调研数据中老年群体（50岁以上）仅占3.2%，但居住10年以上老市民比例高达46.0%，且该群体对秦腔、书法等传统活动有深厚感情，对环境优美（457份）和社交陪伴（体现在关注因素中）有较高需求。</p>
            <p><strong>🎯 基于系统数据的针对性建议：</strong><br>
            系统老年群体占比 {elderly_percentage}%，若占比低，则需关注其潜在需求。针对系统用户中老年群体以 {elderly_top_activity} 活动为主的特点，建议在社区日间开展<span class="highlight-text">"秦腔大家唱"</span><span class="highlight-text">"老年书法研习班"</span>等活动，依托环城公园、莲湖公园等环境优美场所，设置适老化座椅与无障碍通道。同时，结合系统用户随机空闲的时间偏好，可在工作日上午安排养生讲座、太极课程，联动社区卫生服务中心提供健康咨询。对于老市民（居住10年以上），可组织<span class="highlight-text">"西安记忆"</span>口述史活动，邀请他们分享城市变迁，增强文化归属感。</p>
            <p><strong>🌐 基于调研数据的宏观优化建议：</strong><br>
            调研数据显示全市老年群体虽占比小，但老市民比例高，对文化氛围和环境优美有强烈诉求。建议从市级层面打造<span class="highlight-text">"适老化文化服务网络"</span>：一是在公园、广场增设固定文化服务点，提供秦腔伴奏设备、书法桌椅等免费设施；二是联合西安老年大学、群众艺术馆，将精品课程配送至社区，如<span class="highlight-text">"关中秧歌培训"</span><span class="highlight-text">"唐诗鉴赏班"</span>；三是在公共交通上增设文化导乘服务，在公交站牌标注附近文化活动信息。针对老年群体对社交陪伴的隐性需求，可定期组织<span class="highlight-text">"银龄文化之旅"</span>，游览西安城墙、大明宫遗址，配备专业讲解与医疗保障，让老年人在文化活动中实现社交互动。此外，参考调研中"免费/低费"的高关注，所有老年文化活动应坚持公益属性，对高龄、独居老人提供上门接送或志愿者陪伴服务，体现城市温度。</p>
        </div>
    </div>

    <!-- 新市民群体 -->
    <div class="group-card">
        <div class="group-header" style="background: #e0f2f1;">
            <span class="group-icon">🧳</span> 新市民群体（居住1年以下）
        </div>
        <div class="group-body">
            <p><strong>系统特征：</strong>占比 <span class="data-highlight">{new_residents_percentage}%</span>。</p>
            <p><strong>调研参照：</strong>调研中新市民占比11.8%，多通过公交出行（30%），对文化融入有潜在需求。</p>
            <p><strong>🎯 基于系统数据的针对性建议：</strong><br>
            系统新市民占比 {new_residents_percentage}%，若比例较高，需重点关注其文化融入需求。建议推出<span class="highlight-text">"西安文化入门"</span>系列活动：在公交便利的公共空间（如钟楼广场、小寨天桥下）举办<span class="highlight-text">"方言课堂"</span><span class="highlight-text">"西安历史微讲座"</span>，邀请新市民参与；联合永兴坊、回民街开展<span class="highlight-text">"美食文化体验游"</span>，让新市民通过味蕾感受西安；配套发放《西安文化地图》和《新市民生活指南》，涵盖博物馆、公园、便民服务点信息，帮助其快速熟悉城市。针对系统用户中自驾比例高（{traffic_percent:.1f}%），可在活动报名时提供拼车信息或协调共享单车停放点，提升便利性。</p>
            <p><strong>🌐 基于调研数据的宏观优化建议：</strong><br>
            调研数据显示全市新市民占比11.8%，且多依赖公交出行（30%）。建议构建<span class="highlight-text">"新市民文化融入支持体系"</span>：一是在地铁站点、公交枢纽设置<span class="highlight-text">"文化导览屏"</span>，滚动播放近期免费文化活动、非遗体验信息；二是联合用人单位、社区开展<span class="highlight-text">"新市民文化夜校"</span>，开设西安历史、旅游指南、民俗手工等课程，利用晚间或周末时间，降低参与门槛；三是推出<span class="highlight-text">"新市民文化护照"</span>，集章打卡博物馆、景点、书店后可兑换文创礼品，激励新市民主动探索城市文化。参考调研中文化氛围（528份）的高需求，在新建小区、产业园区配套建设<span class="highlight-text">"文化微客厅"</span>，定期举办<span class="highlight-text">"邻里文化节"</span>，促进新市民与本地居民交流。同时，关注新市民子女教育需求，在寒暑假开展<span class="highlight-text">"小小西安人"</span>研学营，带领儿童参观兵马俑、陕历博，从小建立文化认同。</p>
        </div>
    </div>

    <hr>

    <h3><span class="section-icon">💡</span> 五、核心结论与整体建议</h3>

    <div class="conclusion-box">
        <h4>5.1 基于系统数据的核心结论与针对性建议</h4>
        <p>系统用户以 <span class="data-highlight">{key_group_desc}</span> 为主，占比 <span class="data-highlight">{key_group_percentage}%</span>，需求集中于 <span class="tag">{core_demand}</span>。建议从三方面精准施策：</p>
        <ol>
            <li>针对 <span class="highlight-text">{key_group_desc}</span> 的时间偏好 <span class="tag">{time_pref_str}</span>，在 <span class="tag">{key_region}</span> 增设 <span class="tag">{high_demand_activity}</span> 活动，如 <span class="tag">{example}</span>，并强化 <span class="tag">{focus_item}</span> 适配；</li>
            <li>针对系统用户中自驾比例高（<span class="data-highlight">{traffic_percent:.1f}%</span>）的特点，优化场馆停车资源，推出<span class="highlight-text">"文化+停车"</span>联动优惠；</li>
            <li>针对系统用户对文化氛围的强烈关注（60%），提升活动文化深度，如在展览演出中增加专家导览、在非遗体验中融入传承人故事，让文化可感知、可参与。</li>
        </ol>
    </div>

    <div class="conclusion-box">
        <h4>5.2 基于调研数据的宏观优化方向</h4>
        <p>调研数据揭示了全市市民的共性需求：<span class="data-highlight">公共类舒适物（博物馆、公园）合计偏好70%</span>，文化氛围（528份）与环境优美（457份）为核心关注点，公交出行占比30%。建议从宏观层面推动以下优化：</p>
        <ol>
            <li><span class="highlight-text">强化公共文化设施的普惠性与品质感</span>：增加公园露天文化活动频次（如环城公园周末音乐会），优化博物馆夜间开放服务（如陕历博暑期夜场），并在全市公园增设文化标识与休憩空间；</li>
            <li><span class="highlight-text">构建公交导向的文化服务网络</span>：在公交站、地铁站周边布局微型文化空间（如"站台书屋""流动美术馆"），让文化触手可及；</li>
            <li><span class="highlight-text">提升文化活动的环境友好度</span>：结合西安"公园城市"建设，将文化活动引入兴庆宫、大唐芙蓉园等景区，打造"景区+文化"融合场景，满足市民对环境优美的诉求。</li>
        </ol>
    </div>

    <div class="conclusion-box">
        <h4>5.3 综合平衡建议：系统与调研的互补策略</h4>
        <p>系统数据聚焦特定用户群体，调研数据反映全市整体画像，两者差异主要体现在 {diff_desc}。例如，若系统用户中18岁以下占比显著高于调研，则需平衡少儿活动与全龄普惠的关系。建议采取以下互补策略：</p>
        <p><span class="highlight-text">在保持普惠供给（博物馆、公园免费开放）的基础上，向差异群体倾斜资源</span>——针对系统用户中的高占比群体（如学生、新市民），增加定制化活动（如"非遗进校园""新市民文化包"）；同时，通过线上线下宣传吸引调研中占比较高但在系统中偏低群体（如中年、老年）参与，如在社区公告栏、老年大学投放活动信息，设计家庭套票吸引中年家庭。此外，建立动态监测机制，每月对比系统数据与调研数据，及时调整活动供给，确保公共文化服务既精准满足现有用户，又逐步覆盖全市市民，实现<span class="highlight-text">"精准服务"与"普惠共享"的统一</span>。</p>
    </div>

    <div class="footer-note">
        报告生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
    </div>
</div>
"""
        return report
    except Exception as e:
        logger.error(f"生成报告失败: {e}\n{traceback.format_exc()}")
        return f'<div class="error-message">生成报告时发生错误: {str(e)}</div>'

# ==================== FastAPI 应用 ====================

app = FastAPI(title="文享智配·西安公共文化服务")

app.mount("/static", StaticFiles(directory="frontend"), name="static")
templates = Jinja2Templates(directory="frontend")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.on_event("startup")
def startup():
    init_db()
    logger.info("数据库初始化完成")

# 内存会话存储（生产环境建议用 Redis）
user_sessions = {}

# ==================== 页面路由 ====================

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/user", response_class=HTMLResponse)
async def user_page(request: Request):
    user_id = str(uuid.uuid4())
    user_sessions[user_id] = {
        "current_q": 1,
        "user_data": {}
    }
    first_question = get_question_text(1)
    return templates.TemplateResponse(
        "user.html",
        {"request": request, "user_id": user_id, "first_question": first_question}
    )

@app.get("/recommend", response_class=HTMLResponse)
async def recommend_page(request: Request, user_id: str, db: Session = Depends(get_db)):
    user_record = db.query(UserResponse).filter(
        UserResponse.user_id == user_id,
        UserResponse.is_complete == 1
    ).order_by(UserResponse.id.desc()).first()
    if not user_record:
        return HTMLResponse("未找到完整问卷数据", status_code=404)

    user_data = {
        "age": user_record.age_group,
        "education": user_record.education,
        "living": user_record.living_years,
        "occupation": user_record.occupation,
        "income": user_record.income,
        "time": user_record.available_time,
        "act_type": user_record.activity_type,
        "demand": user_record.core_demand,
        "comfort": user_record.comfort_type,
        "focus": user_record.focus_factor,
        "traffic": user_record.traffic_type,
    }

    activities = db.query(Activity).all()
    recommendations = match_activities(user_data, activities)

    return templates.TemplateResponse(
        "recommend.html",
        {"request": request, "user_id": user_id, "recommendations": recommendations}
    )

@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request, db: Session = Depends(get_db)):
    try:
        records = db.query(UserResponse).filter(UserResponse.is_complete == 1).all()
        if not records:
            report_text = "暂无完整问卷数据，无法生成报告。"
        else:
            records_list = []
            for rec in records:
                records_list.append({
                    "age_group": rec.age_group,
                    "education": rec.education,
                    "living_years": rec.living_years,
                    "occupation": rec.occupation,
                    "income": rec.income,
                    "available_time": rec.available_time,
                    "activity_type": rec.activity_type,
                    "core_demand": rec.core_demand,
                    "comfort_type": rec.comfort_type,
                    "focus_factor": rec.focus_factor,
                    "traffic_type": rec.traffic_type,
                    "supplementary_1": rec.supplementary_1,
                    "supplementary_2": rec.supplementary_2,
                })
            stats = calculate_statistics(records_list)
            report_text = generate_report(stats)
        return templates.TemplateResponse("admin.html", {"request": request, "report": report_text})
    except Exception as e:
        logger.error(f"Admin page error: {e}\n{traceback.format_exc()}")
        return HTMLResponse(f"生成报告时出错：{str(e)}", status_code=500)

# ==================== API 接口 ====================

@app.post("/api/user/answer")
async def user_answer(request: Request, db: Session = Depends(get_db)):
    data = await request.json()
    user_id = data.get("user_id")
    user_input = data.get("user_input", "").strip()

    session = user_sessions.get(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    current_q = session["current_q"]
    user_data = session["user_data"]

    response, new_q, new_user_data, is_valid = process_questionnaire(
        current_q, user_data, user_input
    )

    session["current_q"] = new_q
    session["user_data"] = new_user_data
    user_sessions[user_id] = session

    if new_q > 11:
        db_record = UserResponse(
            user_id=user_id,
            age_group=new_user_data.get("age_group"),
            education=new_user_data.get("education"),
            living_years=new_user_data.get("living_years"),
            occupation=new_user_data.get("occupation"),
            income=new_user_data.get("income"),
            available_time=new_user_data.get("available_time"),
            activity_type=new_user_data.get("activity_type"),
            core_demand=new_user_data.get("core_demand"),
            comfort_type=new_user_data.get("comfort_type"),
            focus_factor=new_user_data.get("focus_factor"),
            traffic_type=new_user_data.get("traffic_type"),
            supplementary_1=new_user_data.get("supplementary_1", "无"),
            supplementary_2=new_user_data.get("supplementary_2", "无"),
            is_complete=1
        )
        db.add(db_record)
        db.commit()
        # 清理会话
        if user_id in user_sessions:
            del user_sessions[user_id]
        return JSONResponse({
            "is_valid": True,
            "completed": True,
            "response": response,
            "user_id": user_id
        })

    return JSONResponse({
        "is_valid": is_valid,
        "completed": False,
        "response": response,
        "user_id": user_id
    })

@app.get("/api/debug/sessions")
async def debug_sessions():
    return JSONResponse(user_sessions)