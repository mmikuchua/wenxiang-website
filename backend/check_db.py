import sqlite3
conn = sqlite3.connect('data/wenxiang.db')
cursor = conn.cursor()
cursor.execute("SELECT COUNT(*) FROM activities")
count = cursor.fetchone()[0]
print(f"activities 表中共有 {count} 条记录")
conn.close()