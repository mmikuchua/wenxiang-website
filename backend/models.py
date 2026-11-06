from sqlalchemy import Column, Integer, String, JSON, DateTime, Float
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()

class UserResponse(Base):
    """存储用户每次填写的问卷数据"""
    __tablename__ = 'user_responses'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)  # 用户标识（例如会话ID）
    created_at = Column(DateTime, default=datetime.utcnow)

    # 问卷各字段
    age_group = Column(String, nullable=True)
    education = Column(String, nullable=True)
    living_years = Column(String, nullable=True)
    occupation = Column(String, nullable=True)
    income = Column(String, nullable=True)
    available_time = Column(String, nullable=True)
    activity_type = Column(String, nullable=True)
    core_demand = Column(String, nullable=True)
    comfort_type = Column(String, nullable=True)
    focus_factor = Column(String, nullable=True)
    traffic_type = Column(String, nullable=True)
    supplementary_1 = Column(String, nullable=True)
    supplementary_2 = Column(String, nullable=True)

    # 完整回答标志（是否完成了所有必答题）
    is_complete = Column(Integer, default=0)

class Activity(Base):
    __tablename__ = 'activities'

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(String, nullable=True)          # 爬虫来源的原始ID，如本地宝的 'id' 字段
    name = Column(String)
    type = Column(String)
    time = Column(String)
    address = Column(String)
    price = Column(String)
    highlights = Column(String)
    guide_link = Column(String)
    source = Column(String)                             # 数据来源，如“西安本地宝”

    # 标签化字段（用于匹配）
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

    # 记录创建和更新时间，便于判断数据新鲜度
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)