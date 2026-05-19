#!/usr/bin/env python3
"""
Load EARLY session log JSON exports (from iPad → export session log).

Usage:
  python tools/import_session_logs.py path/to/early-session-*.json
  python tools/import_session_logs.py exports/*.json --csv out.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path


def load_export(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def flatten_attempts(data: dict, source: str) -> list[dict]:
    meta = data.get("meta") or {}
    rows: list[dict] = []
    for a in data.get("attempts") or []:
        rows.append(
            {
                "source_file": source,
                "session_id": a.get("sessionId") or meta.get("sessionId"),
                "student_id": a.get("studentId") or meta.get("studentId"),
                "timestamp": a.get("timestamp"),
                "group": a.get("group"),
                "word": a.get("word"),
                "heard": a.get("heard"),
                "asr_pass": a.get("asrPass"),
                "teacher_agrees": a.get("teacherAgrees"),
                "heuristic_flag_count": len(a.get("heuristicFlags") or []),
                "has_mfcc": bool(a.get("nucleusMfcc")),
                "vowel_class_index": a.get("vowelClassIndex"),
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize EARLY session log exports")
    parser.add_argument("files", nargs="+", type=Path, help="JSON export files")
    parser.add_argument("--csv", type=Path, help="Write flattened attempts to CSV")
    args = parser.parse_args()

    all_rows: list[dict] = []
    for path in args.files:
        if not path.is_file():
            print(f"skip (not found): {path}", file=sys.stderr)
            continue
        data = load_export(path)
        all_rows.extend(flatten_attempts(data, path.name))

    if not all_rows:
        print("No attempts found.", file=sys.stderr)
        return 1

    judged = [r for r in all_rows if r["teacher_agrees"] is not None]
    disagreements = [r for r in judged if r["teacher_agrees"] is False]
    with_mfcc = [r for r in all_rows if r["has_mfcc"]]

    print(f"Files:     {len(args.files)}")
    print(f"Attempts:  {len(all_rows)}")
    print(f"Judged:    {len(judged)}")
    print(f"Disagree:  {len(disagreements)}  (high-value labels)")
    print(f"With MFCC: {len(with_mfcc)}")

    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        with args.csv.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
            writer.writeheader()
            writer.writerows(all_rows)
        print(f"Wrote CSV: {args.csv}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
