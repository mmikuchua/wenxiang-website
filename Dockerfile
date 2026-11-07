# 可选：把站点 + API 一起跑起来（GitHub Pages 部署不需要这个文件）
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY web web

# 问卷数据落在 /app/data，生产环境请挂载持久卷
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8000
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
