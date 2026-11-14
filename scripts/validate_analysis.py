#!/usr/bin/env python3
"""Validate every data/analysis/*.json and rebuild data/analysis/index.json.

Run before every 월요 콘텐츠 분석회 commit:  python3 scripts/validate_analysis.py
편집장 노트(note.text)가 비어 있으면 실패한다. 이 코너는 편집장의 시선이 들어가야 발행된다.
Exits non-zero (and leaves index.json untouched) if any file is malformed.
"""
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANALYSIS = ROOT / "data" / "analysis"
KINDS = {"드라마", "영화", "예능", "음악", "공연", "게임", "웹툰", "애니메이션", "책", "유튜브", "기타"}
VERDICTS = {"지지", "상당 부분 지지", "약하게 지지", "판단 보류", "반대"}
REQUIRED = ("id", "vol", "kind", "work", "maker", "headline", "short", "question",
            "summary", "tests", "conclusion", "planner", "note", "src")


def validate(path):
    errors = []
    try:
        f = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return None, [f"JSON 문법 오류: {e}"]
    for k in REQUIRED:
        if not f.get(k):
            errors.append(f"필수 칸 '{k}'가 비어 있음")
    if errors:
        return f, errors
    if f["id"] != path.stem:
        errors.append(f"id({f['id']})가 파일명({path.stem})과 다름")
    try:
        if date.fromisoformat(f["id"]).weekday() != 0:
            errors.append(f"id({f['id']})가 월요일이 아님")
    except ValueError:
        errors.append(f"id({f['id']})가 YYYY-MM-DD 형식이 아님")
    if f["kind"] not in KINDS:
        errors.append(f"kind는 {sorted(KINDS)} 중 하나 ({f['kind']})")
    if len(f["short"]) > 22:
        errors.append(f"short는 22자 이내 ({len(f['short'])}자)")
    if len(f["summary"]) != 3:
        errors.append(f"summary는 3줄 ({len(f['summary'])}줄)")
    if not 1 <= len(f["tests"]) <= 4:
        errors.append("tests는 1~4개")
    for i, t in enumerate(f["tests"]):
        where = f"tests[{i}]"
        for k in ("title", "verdict", "pro", "con", "judge"):
            if not t.get(k):
                errors.append(f"{where}: '{k}'가 비어 있음")
        if t.get("verdict") and t["verdict"] not in VERDICTS:
            errors.append(f"{where}: verdict는 {sorted(VERDICTS)} 중 하나 ({t['verdict']})")
    for i, p in enumerate(f["planner"]):
        if not (isinstance(p, list) and len(p) == 2 and all(p)):
            errors.append(f"planner[{i}]는 [대상, 다음 수]")
    note = f["note"] if isinstance(f["note"], dict) else {}
    if not (note.get("by") and note.get("text")):
        errors.append("note.by와 note.text(편집장 노트)가 모두 있어야 발행할 수 있음")
    for i, row in enumerate((f.get("money") or {}).get("rows") or []):
        if not (isinstance(row, list) and len(row) == 3):
            errors.append(f"money.rows[{i}]는 [권리·수익, 누구에게, 확인 수준]")
    for i, s in enumerate(f["src"]):
        if not (isinstance(s, list) and len(s) == 2 and str(s[1]).startswith(("http://", "https://"))):
            errors.append(f"src[{i}]는 [이름, http(s) 주소]")
    return f, errors


def main():
    files = sorted(ANALYSIS.glob("2*.json"))
    entries, failed = [], False
    for p in files:
        f, errors = validate(p)
        if errors:
            failed = True
            print(f"✗ {p.name}")
            for e in errors:
                print(f"   - {e}")
            continue
        print(f"✓ {p.name}")
        entries.append({k: f[k] for k in ("id", "vol", "kind", "work", "maker", "headline", "short")})
    vols = [e["vol"] for e in sorted(entries, key=lambda e: e["id"])]
    if vols != list(range(1, len(vols) + 1)):
        failed = True
        print(f"✗ vol은 1부터 날짜순으로 1씩 늘어야 함 ({vols})")
    if failed:
        sys.exit(1)
    entries.sort(key=lambda e: e["id"], reverse=True)
    (ANALYSIS / "index.json").write_text(
        json.dumps({"items": entries}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"data/analysis/index.json: {len(entries)}개")


if __name__ == "__main__":
    main()
