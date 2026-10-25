#!/usr/bin/env python3
"""Validate every data/issues/*.json and rebuild data/index.json.

Run before every commit:  python3 scripts/validate_issue.py
Exits non-zero (and leaves index.json untouched) if any issue is malformed.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ISSUES = ROOT / "data" / "issues"
AXES = {"전자", "통신", "미디어"}
TERM = re.compile(r"\[\[([a-z0-9_-]+)\|[^\]]+\]\]")


def check_story(s, where, errors, need_kr=True):
    for k in ("title", "body" if "body" in s or where != "lead" else "dek", "src"):
        if not s.get(k):
            errors.append(f"{where}: '{k}' 없음")
    ax = s.get("axis") or []
    if not ax or not set(ax) <= AXES:
        errors.append(f"{where}: axis는 {sorted(AXES)} 중 하나 이상이어야 함 (현재 {ax})")
    for name, url in s.get("src") or []:
        if not str(url).startswith(("http://", "https://")):
            errors.append(f"{where}: 출처 URL이 이상함 ({name}: {url})")
    if need_kr and not s.get("krline"):
        errors.append(f"{where}: 'krline'(한국 시사점) 없음")


def check_figure(f, where, errors):
    t = f.get("type")
    if t not in ("hbar", "stack", "dots"):
        errors.append(f"{where}: 알 수 없는 차트 type {t}")
        return
    items = f.get("items") or []
    if not items or not all(isinstance(i, list) and len(i) == 2 and isinstance(i[1], (int, float)) for i in items):
        errors.append(f"{where}: items는 [[라벨, 숫자], ...] 형식이어야 함")
    if not f.get("title"):
        errors.append(f"{where}: title 없음")
    if not f.get("note"):
        errors.append(f"{where}: note(출처) 없음")


def validate(path, glossary):
    errors = []
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return None, [f"JSON 문법 오류: {e}"]
    if d.get("date") != path.stem:
        errors.append(f"date({d.get('date')})가 파일명({path.stem})과 다름")
    for k in ("weekday", "headline", "brief60", "lead"):
        if not d.get(k):
            errors.append(f"'{k}' 없음")
    if not 2 <= len(d.get("brief60") or []) <= 4:
        errors.append("brief60은 2~4줄이어야 함")
    lead = d.get("lead") or {}
    check_story(lead, "lead", errors, need_kr=False)
    for k in ("what", "why", "watch"):
        if not lead.get(k):
            errors.append(f"lead: '{k}' 없음")
    if lead.get("figure"):
        check_figure(lead["figure"], "lead.figure", errors)
    for i, s in enumerate(d.get("kr") or []):
        check_story(s, f"kr[{i}]", errors)
    for i, s in enumerate(d.get("global") or []):
        check_story(s, f"global[{i}]", errors)
    for i, f in enumerate(d.get("figures") or []):
        check_figure(f, f"figures[{i}]", errors)
    if len(d.get("kr") or []) < 2:
        errors.append("국내 브리핑은 최소 2건")
    for key in TERM.findall(path.read_text(encoding="utf-8")):
        if key not in glossary:
            errors.append(f"용어 [[{key}|..]]가 data/glossary.json에 없음")
    return d, errors


def main():
    glossary = json.loads((ROOT / "data" / "glossary.json").read_text(encoding="utf-8"))
    entries, failed = [], False
    for path in sorted(ISSUES.glob("*.json"), reverse=True):
        d, errors = validate(path, glossary)
        if errors:
            failed = True
            print(f"✗ {path.name}")
            for e in errors:
                print(f"   - {e}")
            continue
        stories = [d["lead"]] + (d.get("kr") or []) + (d.get("global") or [])
        axis = sorted({a for s in stories for a in s.get("axis", [])}, key=["전자", "통신", "미디어"].index)
        entries.append({
            "date": d["date"], "vol": d.get("vol"), "label": d.get("label", ""),
            "headline": d["headline"], "axis": axis,
            "titles": [s["title"] for s in stories],
        })
        print(f"✓ {path.name}")
    if failed:
        print("\n검증 실패: index.json을 갱신하지 않았습니다.")
        sys.exit(1)
    out = ROOT / "data" / "index.json"
    out.write_text(json.dumps({"issues": entries}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\nindex.json 갱신: {len(entries)}개 호")


if __name__ == "__main__":
    main()
