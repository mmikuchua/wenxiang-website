# -*- coding: utf-8 -*-
"""导出历史试点问卷的聚合统计（不包含任何个人记录）。

管理员页面的「试点基线」区块读取 web/data/pilot.json。
用法：
    python tools/export_pilot.py --db ../wenxiang-website/data/wenxiang.db \
        --out web/data/pilot.json
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

FIELDS = [
    "age_group",
    "education",
    "living_years",
    "occupation",
    "income",
    "available_time",
    "activity_type",
    "core_demand",
    "comfort_type",
    "focus_factor",
    "traffic_type",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--out", default="web/data/pilot.json")
    parser.add_argument("--label", default="2026 年春季试调查")
    args = parser.parse_args()

    connection = sqlite3.connect(Path(args.db))
    connection.row_factory = sqlite3.Row
    rows = [dict(row) for row in connection.execute("select * from user_responses where is_complete = 1")]
    connection.close()

    distributions: dict[str, dict[str, int]] = {}
    for field in FIELDS:
        counter: Counter[str] = Counter()
        for row in rows:
            value = row.get(field)
            if not value:
                continue
            # 活动类型是多选，逗号分隔
            for code in str(value).split(","):
                code = code.strip()
                if code:
                    counter[code] += 1
        distributions[field] = dict(sorted(counter.items()))

    payload = {
        "label": args.label,
        "n": len(rows),
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "note": "仅聚合统计，不含个人记录；用于管理员页面作为历史基线对比。",
        "distributions": distributions,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"已导出 {len(rows)} 份问卷的聚合统计 -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
