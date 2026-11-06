# backend/init_db.py
import sys
import os
from pathlib import Path

# 打印当前工作目录，确认位置
print("当前工作目录:", os.getcwd())

# 确保 data 目录存在
data_dir = Path("./data")
data_dir.mkdir(exist_ok=True)
print(f"data 目录已确认: {data_dir.absolute()}")

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import init_db

if __name__ == "__main__":
    print("正在初始化数据库...")
    init_db()
    print("数据库初始化完成！")