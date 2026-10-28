#!/usr/bin/env python3
"""Validate every data/weekly/*.json and rebuild data/weekly/index.json.

Run before every weekly commit:  python3 scripts/validate_weekly.py
위클리는 새 사실을 쓰지 않는다. 흐름(threads)·숫자(numbers)·지난 예고 확인(checkback)의
근거는 모두 그 주에 발행된 매일 호의 기사(ref = "YYYY-MM-DD#lead|k0|g0")를 가리켜야 한다.
Exits non-zero (and leaves index.json untouched) if any weekly is malformed.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEEKLY = ROOT / "data" / "weekly"
ISSUES = ROOT / "data" / "issues"
AXES = ["전자", "통신", "미디어"]
TERM = re.compile(r"\[\[([a-z0-9_-]+)\|[^\]]+\]\]")
REF = re.compile(r"^(\d{4}-\d{2}-\d{2})#(lead|k\d+|g\d+)$")
STATUS = {"확인", "변경", "대기", "다루지 못함"}

_issue_cache = {}


def load_issue(d):
    if d not in _issue_cache:
        p = ISSUES / f"{d}.json"
        _issue_cache[d] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    return _issue_cache[d]


def check_ref(ref, where, lo, hi, errors):
    m = REF.match(str(ref or ""))
    if not m:
        errors.append(f"{where}: ref 형식은 'YYYY-MM-DD#lead|k0|g0' ({ref})")
        return
    d, anchor = m.groups()
    if not lo <= d <= hi:
        errors.append(f"{where}: ref {ref}가 위클리 기간({lo}~{hi}) 밖의 호를 가리킴")
    issue = load_issue(d)
    if issue is None:
        errors.append(f"{where}: ref {ref}의 호(data/issues/{d}.json)가 없음")
        return
    if anchor == "lead":
        return
    sec, i = ("kr" if anchor[0] == "k" else "global"), int(anchor[1:])
    if i >= len(issue.get(sec) or []):
        errors.append(f"{where}: ref {ref}가 가리키는 기사가 그 호에 없음")


def validate(path, glossary):
    errors = []
    try:
        w = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return None, [f"JSON 문법 오류: {e}"]
    if w.get("id") != path.stem:
        errors.append(f"id({w.get('id')})가 파일명({path.stem})과 다름")
    for k in ("id", "vol", "from", "to", "headline", "summary", "threads", "numbers", "next"):
        if w.get(k) in (None, "", []):
            errors.append(f"'{k}' 없음")
    try:
        f, t, i = (date.fromisoformat(w[k]) for k in ("from", "to", "id"))
        if not f <= t < i:
            errors.append("날짜 순서는 from ≤ to < id(발행일)여야 함")
        if (t - f).days > 7:
            errors.append("기간(from~to)은 최대 8일")
        if i.weekday() != 0:
            print(f"   ! {path.name}: 발행일이 월요일이 아님(경고)")
    except (KeyError, ValueError, TypeError):
        errors.append("from/to/id는 YYYY-MM-DD 형식이어야 함")
        return w, errors
    lo, hi = w["from"], w["to"]
    if not 2 <= len(w.get("summary") or []) <= 4:
        errors.append("summary(이번 주 3줄)는 2~4줄")
    if not 2 <= len(w.get("threads") or []) <= 4:
        errors.append("threads(이번 주의 흐름)는 2~4개")
    for n, th in enumerate(w.get("threads") or []):
        where = f"threads[{n}]"
        for k in ("title", "story", "timeline", "why"):
            if not th.get(k):
                errors.append(f"{where}: '{k}' 없음")
        ax = th.get("axis") or []
        if not ax or not set(ax) <= set(AXES):
            errors.append(f"{where}: axis는 {AXES} 중 하나 이상")
        if len(th.get("timeline") or []) < 2:
            errors.append(f"{where}: timeline은 2개 이상(여러 날에 걸친 흐름만 thread로 쓴다)")
        for m, item in enumerate(th.get("timeline") or []):
            if not (isinstance(item, list) and len(item) == 2 and item[1]):
                errors.append(f"{where}.timeline[{m}]: [ref, 한 줄 요약] 형식")
                continue
            check_ref(item[0], f"{where}.timeline[{m}]", lo, hi, errors)
    for n, x in enumerate(w.get("numbers") or []):
        where = f"numbers[{n}]"
        for k in ("value", "label", "ref"):
            if not x.get(k):
                errors.append(f"{where}: '{k}' 없음")
        if x.get("ref"):
            check_ref(x["ref"], where, lo, hi, errors)
    if not 3 <= len(w.get("numbers") or []) <= 6:
        errors.append("numbers(숫자로 본 한 주)는 3~6개")
    for n, c in enumerate(w.get("checkback") or []):
        where = f"checkback[{n}]"
        for k in ("when", "what", "status", "result"):
            if not c.get(k):
                errors.append(f"{where}: '{k}' 없음")
        if c.get("status") not in STATUS:
            errors.append(f"{where}: status는 {sorted(STATUS)} 중 하나")
        if c.get("status") in ("확인", "변경"):
            if not c.get("ref"):
                errors.append(f"{where}: status가 '{c.get('status')}'이면 근거 ref 필요")
            else:
                check_ref(c["ref"], where, lo, hi, errors)
    for n, x in enumerate(w.get("next") or []):
        if not (isinstance(x, list) and len(x) == 3 and x[0] and x[1] and x[2]):
            errors.append(f"next[{n}]: [언제, 무엇, 관전 포인트] 형식")
    for key in TERM.findall(path.read_text(encoding="utf-8")):
        if key not in glossary:
            errors.append(f"용어 [[{key}|..]]가 data/glossary.json에 없음")
    return w, errors


def main():
    glossary = json.loads((ROOT / "data" / "glossary.json").read_text(encoding="utf-8"))
    WEEKLY.mkdir(parents=True, exist_ok=True)
    entries, failed = [], False
    for path in sorted(WEEKLY.glob("????-??-??.json"), reverse=True):
        w, errors = validate(path, glossary)
        if errors:
            failed = True
            print(f"✗ {path.name}")
            for e in errors:
                print(f"   - {e}")
            continue
        axis = sorted({a for th in w["threads"] for a in th["axis"]}, key=AXES.index)
        entries.append({"id": w["id"], "vol": w["vol"], "from": w["from"], "to": w["to"],
                        "headline": w["headline"], "axis": axis})
        print(f"✓ {path.name}")
    if failed:
        print("\n검증 실패: weekly/index.json을 갱신하지 않았습니다.")
        sys.exit(1)
    out = WEEKLY / "index.json"
    out.write_text(json.dumps({"weeklies": entries}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\nweekly/index.json 갱신: {len(entries)}개 호")


if __name__ == "__main__":
    main()
