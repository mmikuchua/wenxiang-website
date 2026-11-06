# backend/database.py
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.models import Base

# 获取当前文件所在目录的绝对路径
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# 拼接出 data 目录的绝对路径
DATA_DIR = os.path.join(os.path.dirname(BASE_DIR), "data")
# 确保 data 目录存在
os.makedirs(DATA_DIR, exist_ok=True)

# 数据库文件的完整路径
DB_PATH = os.path.join(DATA_DIR, "wenxiang.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

print(f"数据库将创建于: {DB_PATH}")  # 添加打印以便确认

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    Base.metadata.create_all(bind=engine)