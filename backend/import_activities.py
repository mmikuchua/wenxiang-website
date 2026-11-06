# backend/import_activities.py
import json
import re
import sys
import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, JSON, DateTime, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# 数据库配置
SQLALCHEMY_DATABASE_URL = "sqlite:///./data/wenxiang.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# 定义活动模型（与 main.py 一致）
class Activity(Base):
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

# ==================== 辅助函数 ====================
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
    return list(features)

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
    return list(age_set)

def infer_comfort(address, name, type_str):
    comfort_map_build = {
        "A": ["博物馆", "图书馆", "文化馆", "美术馆", "纪念馆", "文博"],
        "B": ["公园", "遗址", "景区", "城墙", "华清宫", "兵马俑", "大明宫", "曲江池"],
        "C": ["书店", "艺术馆", "影院", "剧院", "大剧院", "书城", "咖啡"],
        "D": ["街区", "广场", "大唐不夜城", "书院门", "叁伍壹壹", "购物中心", "商场"]
    }
    text = (address + " " + name + " " + type_str).lower()
    for code, keywords in comfort_map_build.items():
        if any(kw in text for kw in keywords):
            return code
    return "A"

def infer_demand(highlights):
    demand_keywords = {
        "A": ["放松", "休闲", "观光", "漫步", "美景", "喷泉", "灯光秀"],
        "B": ["知识", "科普", "学习", "文化", "历史", "讲座", "讲坛", "展览", "文物", "古籍"],
        "C": ["社交", "陪伴", "交友", "聚会", "亲子", "家庭", "合家欢"],
        "D": ["便民", "技能", "实用", "手工", "培训", "编程", "公益体验"]
    }
    text = highlights.lower()
    demands = set()
    for code, keywords in demand_keywords.items():
        if any(kw in text for kw in keywords):
            demands.add(code)
    return list(demands)

def infer_factor(highlights, price_level, address):
    focus_keywords = {
        "A": ["文化", "历史", "艺术", "非遗", "国学", "秦腔", "氛围"],
        "B": ["交通", "地铁", "公交", "停车", "便利"],
        "C": ["免费", "低费", "公益", "惠民"],
        "D": ["环境", "优美", "公园", "景区", "湖", "景"]
    }
    text = highlights.lower()
    factors = set()
    if any(kw in text for kw in focus_keywords["A"]):
        factors.add("A")
    if any(kw in text for kw in focus_keywords["D"]):
        factors.add("D")
    if price_level in ["free", "low"]:
        factors.add("C")
    return list(factors)

def transport_score_by_address(address):
    text = address.lower()
    if "地铁" in text:
        return 0.9
    if "公交" in text:
        return 0.7
    if "偏远" in text:
        return 0.3
    return 0.5

def process_raw_activity(act):
    """将原始活动字典转换为数据库模型字典"""
    if isinstance(act, dict) and "fields" in act:
        fields_str = act["fields"]
        try:
            fields = json.loads(fields_str) if isinstance(fields_str, str) else fields_str
        except:
            fields = act
    else:
        fields = act

    name = safe_str(fields.get("activity_name", ""))
    type_raw = safe_str(fields.get("activity_type", ""))
    time_raw = safe_str(fields.get("activity_time", ""))
    address = safe_str(fields.get("address", ""))
    price_raw = safe_str(fields.get("price_info", ""))
    highlights = safe_str(fields.get("highlights", ""))
    guide_link = safe_str(fields.get("guide_link", ""))
    source = safe_str(fields.get("source", "未知"))
    source_id = safe_str(fields.get("id", "")) or safe_str(act.get("id", ""))

    price_level = get_price_level(price_raw)
    start, end = parse_valid_period(time_raw)

    return {
        "source_id": source_id,
        "name": name,
        "type": type_raw,
        "time": time_raw,
        "address": address,
        "price": price_raw,
        "highlights": highlights,
        "guide_link": guide_link,
        "source": source,
        "activity_type_tags": [],
        "age_fit_tags": infer_age_fit(name, highlights),
        "time_slot_tags": parse_time_features(time_raw),
        "price_level": price_level,
        "comfort_tag": infer_comfort(address, name, type_raw),
        "demand_tags": infer_demand(highlights),
        "factor_tags": infer_factor(highlights, price_level, address),
        "transport_score": transport_score_by_address(address),
        "valid_start": start,
        "valid_end": end
    }

def upsert_activities(db, activities_data):
    now = datetime.utcnow()
    for act in activities_data:
        existing = db.query(Activity).filter(
            Activity.source_id == act.get("source_id"),
            Activity.source == act.get("source")
        ).first()
        if existing:
            for key, value in act.items():
                if hasattr(existing, key) and key not in ["id", "created_at"]:
                    setattr(existing, key, value)
            existing.updated_at = now
        else:
            new_act = Activity(**act, created_at=now, updated_at=now)
            db.add(new_act)
    db.commit()

def main():
    # 创建表（如果不存在）
    Base.metadata.create_all(bind=engine)

    # 内置示例数据
    sample_activities = [
        {
            "activity_name": "智编牛",
            "activity_type": "少儿数字编程公益体验",
            "activity_time": "随对应馆区开放时间",
            "address": "陕西省图书馆（长安路馆区、高新馆区）",
            "price_info": "免费（馆内数字资源，公益开放）",
            "highlights": "智编牛课程面向青少年儿童，根据不同年龄身心发展自主研发不同阶段的编程创作平台，提供线上、线下及双师的活动平台及全流程的大赛服务。",
            "guide_link": "https://zhibianniu.com/",
            "source": "西安本地宝",
            "id": "1"
        },
        {
            "activity_name": "非遗体验",
            "activity_type": "非遗文化展示与公益体验",
            "activity_time": "周二至周日 9:00–17:00，周一闭馆",
            "address": "陕西省文化馆（曲江馆区二楼非遗体验中心）",
            "price_info": "免费（体验中心及公益活动）",
            "highlights": "陕西省非遗体验中心主题展览分为“秦蕴、秦艺、秦工、秦风”四大部分和“秦创区”“精品区”“文创区”“研学区”“临展区”五个功能版块，近2000件展品精彩呈现了陕西非遗的厚重底蕴与时代风华。",
            "guide_link": "",
            "source": "西安本地宝",
            "id": "6"
        },
        {
            "activity_name": "陕西历史博物馆",
            "activity_type": "历史文物收藏与公益展览",
            "activity_time": "9:00-17:30（16:00 止入），周一闭馆",
            "address": "雁塔区小寨东路 91 号",
            "price_info": "免费（需预约），专题展另收费",
            "highlights": "馆藏 37 万 + 文物，商周青铜器、唐金银器等精品荟萃，系统展现华夏文明脉络。",
            "guide_link": "",
            "source": "西安本地宝",
            "id": "18"
        },
        {
            "activity_name": "大唐不夜城",
            "activity_type": "盛唐沉浸式文化休闲观光体验",
            "activity_time": "全天开放",
            "address": "雁塔区慈恩路 46 号",
            "price_info": "免费",
            "highlights": "盛唐沉浸式街区，有灯光秀、非遗表演、文化市集，夜间文化体验与休闲胜地。",
            "guide_link": "",
            "source": "西安本地宝",
            "id": "31"
        },
        {
            "activity_name": "博纳国际影城（朱雀店）",
            "activity_type": "商业沉浸式电影观影体验",
            "activity_time": "10:00-24:00",
            "address": "雁塔区小寨西路26号安南城6层",
            "price_info": "自主消费",
            "highlights": "配备4DX动感厅与杜比全景声，小寨商圈核心，观影体验沉浸，热门影片排期充足。",
            "guide_link": "",
            "source": "西安本地宝",
            "id": "37"
        }
    ]

    import_file = None
    if len(sys.argv) > 1:
        import_file = sys.argv[1]

    activities_to_import = []

    if import_file and os.path.exists(import_file):
        print(f"从文件 {import_file} 导入数据...")
        with open(import_file, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)
        if isinstance(raw_data, list):
            for item in raw_data:
                processed = process_raw_activity(item)
                activities_to_import.append(processed)
        else:
            print("文件格式错误，应为活动列表")
            return
    else:
        print("未指定导入文件，使用内置示例数据...")
        for item in sample_activities:
            processed = process_raw_activity(item)
            activities_to_import.append(processed)

    db = SessionLocal()
    try:
        upsert_activities(db, activities_to_import)
        print(f"成功导入 {len(activities_to_import)} 条活动")
    finally:
        db.close()

if __name__ == "__main__":
    main()