# -*- coding: utf-8 -*-
"""可选后端：为静态站点补上「跨设备汇总 + AI 顾问」。

站点本身完全可以只用 GitHub Pages 跑（纯前端）；
只有当你想让管理员看到所有人的问卷、或者想用大模型做自然语言推荐时，
才需要启动这个服务。前端会自动探测 /api/health 来决定是否启用云端能力。
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .llm import DeepSeekClient, LLMError
from .settings import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("wenxiang")

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = Path(os.getenv("WEB_DIR", ROOT / "web"))
DATA_FILE = WEB_DIR / "data" / "activities.json"
DB_PATH = Path(os.getenv("WENXIANG_DB", ROOT / "data" / "responses.db"))

app = FastAPI(title="文享智配 · API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()] or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 本地改前端时用 DEV_NO_CACHE=1 启动，避免浏览器缓存旧的 JS/CSS
if os.getenv("DEV_NO_CACHE") == "1":

    @app.middleware("http")
    async def _no_cache(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith(("/assets/", "/data/")):
            response.headers["Cache-Control"] = "no-store"
        return response

_db_lock = threading.Lock()
_dataset_cache: Dict[str, Any] = {"mtime": 0.0, "payload": None}


# --------------------------------------------------------------------- 存储
def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    # 数据库文件被删除/替换后仍能自愈（否则会报 no such table）
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS responses (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            profile TEXT NOT NULL,
            source TEXT,
            received_at TEXT NOT NULL
        )
        """
    )
    return connection


def init_db() -> None:
    with _db_lock, _connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS responses (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                profile TEXT NOT NULL,
                source TEXT,
                received_at TEXT NOT NULL
            )
            """
        )
        connection.commit()


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    logger.info("数据库就绪：%s", DB_PATH)
    logger.info("活动数据：%s（存在=%s）", DATA_FILE, DATA_FILE.exists())


# --------------------------------------------------------------------- 数据
def load_dataset() -> Dict[str, Any]:
    try:
        mtime = DATA_FILE.stat().st_mtime
    except OSError as exc:
        raise HTTPException(status_code=503, detail="活动数据文件不存在，请先运行数据流水线") from exc
    if _dataset_cache["payload"] and _dataset_cache["mtime"] == mtime:
        return _dataset_cache["payload"]
    try:
        payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="活动数据 JSON 解析失败") from exc
    _dataset_cache.update({"mtime": mtime, "payload": payload})
    return payload


# --------------------------------------------------------------------- API
@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {
        "service": "wenxiang",
        "status": "ok",
        "version": app.version,
        "llm": settings.llm_enabled,
        "activities": DATA_FILE.exists(),
        "time": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
    }


@app.get("/api/activities")
def activities() -> Dict[str, Any]:
    return load_dataset()


@app.post("/api/responses")
async def create_response(request: Request) -> Dict[str, Any]:
    payload = await request.json()
    record_id = str(payload.get("id") or "").strip()
    profile = payload.get("profile")
    if not record_id or not isinstance(profile, dict):
        raise HTTPException(status_code=400, detail="缺少 id 或 profile")
    created_at = str(payload.get("created_at") or datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"))
    with _db_lock, _connect() as connection:
        connection.execute(
            "INSERT OR REPLACE INTO responses (id, created_at, profile, source, received_at) VALUES (?, ?, ?, ?, ?)",
            (
                record_id,
                created_at,
                json.dumps(profile, ensure_ascii=False),
                str(payload.get("source") or "web"),
                datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            ),
        )
        connection.commit()
    return {"saved": True, "id": record_id}


@app.get("/api/responses")
def list_responses(limit: int = 2000) -> Dict[str, Any]:
    with _db_lock, _connect() as connection:
        rows = connection.execute(
            "SELECT id, created_at, profile, source FROM responses ORDER BY created_at DESC LIMIT ?",
            (max(1, min(limit, 5000)),),
        ).fetchall()
    responses = []
    for row in rows:
        try:
            profile = json.loads(row["profile"])
        except json.JSONDecodeError:
            continue
        responses.append(
            {
                "id": row["id"],
                "created_at": row["created_at"],
                "profile": profile,
                "source": row["source"] or "cloud",
            }
        )
    return {"count": len(responses), "responses": responses}


@app.get("/api/stats")
def stats() -> Dict[str, Any]:
    payload = list_responses(limit=5000)
    responses = payload["responses"]
    counter: Dict[str, int] = {}
    for record in responses:
        for code in record["profile"].get("actTypes") or []:
            counter[code] = counter.get(code, 0) + 1
    return {"count": len(responses), "activity_types": counter}


@app.post("/api/chat")
async def chat(request: Request) -> Dict[str, Any]:
    """自然语言推荐：把画像 + 一句话需求交给模型，返回活动 id 列表。"""
    if not settings.llm_enabled:
        raise HTTPException(status_code=503, detail="后端未配置 DEEPSEEK_API_KEY")
    body = await request.json()
    messages: List[Dict[str, str]] = body.get("messages") or []
    if not messages:
        raise HTTPException(status_code=400, detail="messages 不能为空")

    dataset = load_dataset()
    catalog = "\n".join(
        f'{item.get("id")} | {item.get("name")} | {item.get("district") or ""} | '
        f'{"/".join((item.get("tags") or {}).get("themes", []))} | '
        f'{item.get("price_level")}'
        for item in dataset.get("activities", [])
    )
    system = (
        "你是西安公共文化服务平台的活动推荐顾问。根据用户画像和一句话需求，从给定活动清单中挑选 3-6 个最合适的，"
        "按推荐优先级排序，只能使用清单里出现过的 id。每条理由要具体到这场活动本身（例如「免费且工作日晚间开放」），"
        '不要空话。只输出 JSON：{"reply":"一句话总体说明","picks":[{"id":"act-...","reason":"..."}]}。'
        f"\n活动清单：\n{catalog}"
    )
    client = DeepSeekClient()
    started = time.time()
    try:
        result = client.chat_json(
            [{"role": "system", "content": system}, *messages],
            temperature=0.3,
            max_tokens=4000,
        )
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    by_id = {item.get("id"): item for item in dataset.get("activities", [])}
    items: List[Dict[str, Any]] = []
    seen = set()
    raw_picks = result.get("picks")
    if not raw_picks:
        # 兼容模型偶尔退回旧格式 {activity_ids: [...]}
        raw_picks = [{"id": item_id, "reason": ""} for item_id in (result.get("activity_ids") or [])]
    for raw in raw_picks:
        if not isinstance(raw, dict):
            continue
        activity = by_id.get(str(raw.get("id") or ""))
        if not activity or activity["id"] in seen:
            continue
        seen.add(activity["id"])
        items.append(
            {
                "id": activity["id"],
                "name": activity.get("name"),
                "district": activity.get("district"),
                "price_level": activity.get("price_level"),
                "reason": str(raw.get("reason") or raw.get("why") or "").strip()[:120],
            }
        )
        if len(items) >= 8:
            break
    return {
        "reply": str(result.get("reply") or ""),
        "activity_ids": [item["id"] for item in items],
        "items": items,
        "latency_ms": int((time.time() - started) * 1000),
    }


# --------------------------------------------------------------------- 静态站
@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
