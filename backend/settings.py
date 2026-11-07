# -*- coding: utf-8 -*-
"""后端配置：环境变量优先，其次读取仓库根目录或 backend/ 下的 .env。"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_dotenv(*paths: Path) -> None:
    for path in paths:
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = value.strip().strip('"').strip("'")


load_dotenv(ROOT / ".env", ROOT / "backend" / ".env")


@dataclass
class Settings:
    api_key: str = field(default_factory=lambda: os.getenv("DEEPSEEK_API_KEY", ""))
    base_url: str = field(default_factory=lambda: os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"))
    model: str = field(default_factory=lambda: os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-flash"))
    timeout: float = field(default_factory=lambda: float(os.getenv("DEEPSEEK_TIMEOUT", "90")))
    cors_origins: str = field(default_factory=lambda: os.getenv("CORS_ORIGINS", "*"))

    @property
    def llm_enabled(self) -> bool:
        return bool(self.api_key)


settings = Settings()
