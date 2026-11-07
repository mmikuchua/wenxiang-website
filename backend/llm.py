# -*- coding: utf-8 -*-
"""极简 DeepSeek 客户端（标准库实现，避免额外依赖）。"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List

from .settings import settings


class LLMError(RuntimeError):
    pass


def _parse_json(text: str) -> Dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            raise LLMError(f"模型未返回 JSON：{text[:160]}")
        value = json.loads(cleaned[start : end + 1])
    return value if isinstance(value, dict) else {}


class DeepSeekClient:
    def __init__(self) -> None:
        self.settings = settings

    def _post(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        url = self.settings.base_url.rstrip("/") + "/chat/completions"
        request = urllib.request.Request(
            url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.settings.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                with urllib.request.urlopen(request, timeout=self.settings.timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "ignore")[:300]
                last_error = LLMError(f"HTTP {exc.code}: {detail}")
                if exc.code in (400, 401, 403):
                    raise last_error from exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = LLMError(f"网络异常: {exc}")
            time.sleep(min(2 ** attempt, 6))
        raise last_error or LLMError("未知错误")

    def chat_json(
        self,
        messages: List[Dict[str, str]],
        *,
        temperature: float = 0.3,
        max_tokens: int = 1500,
    ) -> Dict[str, Any]:
        data = self._post(
            {
                "model": self.settings.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "response_format": {"type": "json_object"},
            }
        )
        choices = data.get("choices") or []
        if not choices:
            raise LLMError("模型返回为空")
        content = (choices[0].get("message") or {}).get("content") or ""
        return _parse_json(content)
