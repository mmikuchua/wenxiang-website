# backend/import_from_csv.py
import csv
import pandas as pd
import re
import sys
import os
import json
import argparse
from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, Integer, String, JSON, DateTime, Float

# 数据库配置
SQLALCHEMY_DATABASE_URL = "sqlite:///./data/wenxiang.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

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

# ==================== 标签化函数 ====================
def safe_str(val):
    if pd.isna(val) or val is None:
        return ""
    return str(val)

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
    text = (safe_str(name) + " " + safe_str(highlights)).lower()
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
    text = (safe_str(address) + " " + safe_str(name) + " " + safe_str(type_str)).lower()
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
    text = safe_str(highlights).lower()
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
    text = safe_str(highlights).lower()
    factors = set()
    if any(kw in text for kw in focus_keywords["A"]):
        factors.add("A")
    if any(kw in text for kw in focus_keywords["D"]):
        factors.add("D")
    if price_level in ["free", "low"]:
        factors.add("C")
    return list(factors)

def transport_score_by_address(address):
    text = safe_str(address).lower()
    if "地铁" in text:
        return 0.9
    if "公交" in text:
        return 0.7
    if "偏远" in text:
        return 0.3
    return 0.5

def process_row(row, col_mapping):
    name = safe_str(row.get(col_mapping.get("name", "活动名称"), ""))
    type_raw = safe_str(row.get(col_mapping.get("type", "活动类型"), ""))
    time_raw = safe_str(row.get(col_mapping.get("time", "活动时间"), ""))
    address = safe_str(row.get(col_mapping.get("address", "活动地址"), ""))
    price_raw = safe_str(row.get(col_mapping.get("price", "收费信息"), ""))
    highlights = safe_str(row.get(col_mapping.get("highlights", "活动亮点"), ""))
    guide_link = safe_str(row.get(col_mapping.get("guide_link", "攻略链接"), ""))
    source = safe_str(row.get(col_mapping.get("source", "数据来源"), "未知"))
    source_id = safe_str(row.get(col_mapping.get("source_id", "序号"), ""))

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
    now = datetime.now(timezone.utc).replace(tzinfo=None)
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
    parser = argparse.ArgumentParser(description='导入活动数据从 CSV/Excel')
    parser.add_argument('file', help='CSV 或 Excel 文件路径')
    parser.add_argument('--format', choices=['csv', 'excel'], help='文件格式，若不指定则根据扩展名判断')
    parser.add_argument('--sheet', default=0, help='Excel 工作表名或索引，默认第一个')
    parser.add_argument('--col-map', help='列名映射JSON文件，可选')
    args = parser.parse_args()

    # 默认列名映射（根据您飞书表格的实际列名修改）
    default_col_mapping = {
        "source_id": "source_id",
        "name": "activity_name",
        "type": "activity_type",
        "time": "activity_time",
        "address": "address",
        "price": "price_info",
        "highlights": "highlights",
        "guide_link": "guide_link",
        "source": "source"
    }

    col_mapping = default_col_mapping
    if args.col_map:
        with open(args.col_map, 'r', encoding='utf-8') as f:
            col_mapping = json.load(f)

    # 读取文件
    file_path = args.file
    if args.format == 'csv' or (args.format is None and file_path.lower().endswith('.csv')):
        df = pd.read_csv(file_path, encoding='utf-8-sig')
    else:
        df = pd.read_excel(file_path, sheet_name=args.sheet)

    print(f"读取到 {len(df)} 行数据")

    records = df.to_dict(orient='records')
    activities_to_import = []
    for idx, row in enumerate(records):
        try:
            processed = process_row(row, col_mapping)
            activities_to_import.append(processed)
        except Exception as e:
            print(f"第 {idx+1} 行处理失败: {e}")
            continue

    print(f"成功处理 {len(activities_to_import)} 条活动")

    db = SessionLocal()
    try:
        upsert_activities(db, activities_to_import)
        print("导入完成")
    finally:
        db.close()

if __name__ == "__main__":
    main()