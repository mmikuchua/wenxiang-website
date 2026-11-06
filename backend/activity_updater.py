# backend/activity_updater.py
from sqlalchemy.orm import Session
from .models import Activity
from datetime import datetime
import json

def upsert_activities(db: Session, activities_data: list):
    """
    activities_data: 每个元素是一个字典，包含 Activity 模型的所有字段（除了 id, created_at, updated_at）
    该函数会根据 (source_id, source) 判断是否存在，若存在则更新，否则插入。
    """
    now = datetime.utcnow()
    for act in activities_data:
        # 检查是否已存在
        existing = db.query(Activity).filter(
            Activity.source_id == act.get("source_id"),
            Activity.source == act.get("source")
        ).first()

        if existing:
            # 更新已有记录
            for key, value in act.items():
                if hasattr(existing, key) and key not in ["id", "created_at"]:
                    setattr(existing, key, value)
            existing.updated_at = now
        else:
            # 创建新记录
            new_act = Activity(**act, created_at=now, updated_at=now)
            db.add(new_act)

    db.commit()