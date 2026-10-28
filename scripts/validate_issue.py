#!/usr/bin/env python3
"""Validate every data/issues/*.json and rebuild data/index.json.

Run before every commit:  python3 scripts/validate_issue.py
Exits non-zero (and leaves index.json untouched) if any issue is malformed.
"""
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ISSUES = ROOT / "data" / "issues"
AXES = {"전자", "통신", "미디어"}
TERM = re.compile(r"\[\[([a-z0-9_-]+)\|[^\]]+\]\]")
QREF = re.compile(r"^(\d{4}-\d{2}-\d{2})#(lead|k\d+|g\d+)$")
QTYPES = {"인과", "연결", "감각"}


COMPANIES = set()


def check_companies(errors):
    """data/companies.json: 관계 대상이 실제 회사인지, 근거가 기사(YYYY-MM-DD#..) 또는 URL인지."""
    p = ROOT / "data" / "companies.json"
    if not p.exists():
        return
    data = json.loads(p.read_text(encoding="utf-8"))
    layers = {l["id"] for l in data.get("layers", [])}
    ids = [c["id"] for c in data.get("companies", [])]
    COMPANIES.update(ids)
    if len(ids) != len(set(ids)):
        errors.append("companies.json: 회사 id 중복")
    for c in data.get("companies", []):
        w = f"companies.json {c.get('id')}"
        for k in ("name", "region", "layer", "axis", "line", "money", "aliases"):
            if not c.get(k):
                errors.append(f"{w}: '{k}' 없음")
        if c.get("layer") not in layers:
            errors.append(f"{w}: layer '{c.get('layer')}' 없음")
        for r in c.get("rel", []):
            if len(r) != 4 or r[0] not in data.get("relTypes", {}) or r[1] not in ids:
                errors.append(f"{w}: 관계 형식 오류 {r}")
            elif not (QREF.match(r[3]) or str(r[3]).startswith("https://")):
                errors.append(f"{w}: 관계 근거는 기사 ref 또는 https URL ({r[3]})")


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
    for cid in s.get("companies") or []:
        if COMPANIES and cid not in COMPANIES:
            errors.append(f"{where}: companies의 '{cid}'가 data/companies.json에 없음")
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


def check_quiz(d, path, errors):
    """오늘의 퀴즈: 3문항, 오늘 기사 1 + 지난 7일 기사 2(지난 호가 없으면 오늘 기사로 대체)."""
    quiz = d.get("quiz")
    if quiz is None:
        return
    if len(quiz) != 3:
        errors.append("quiz는 3문항")
    today = date.fromisoformat(d["date"])
    past_available = any(today - timedelta(days=7) <= date.fromisoformat(p.stem) < today
                         for p in ISSUES.glob("????-??-??.json"))
    n_today = n_past = 0
    answers = []
    for i, q in enumerate(quiz):
        where = f"quiz[{i}]"
        for k in ("q", "options", "explain", "ref"):
            if not q.get(k):
                errors.append(f"{where}: '{k}' 없음")
        if q.get("type") not in QTYPES:
            errors.append(f"{where}: type은 {sorted(QTYPES)} 중 하나")
        opts = q.get("options") or []
        if any(TERM.search(str(o)) for o in opts):
            errors.append(f"{where}: 보기에는 용어 표시([[..]])를 쓰지 않음(정답 힌트가 됨)")
        if not 3 <= len(opts) <= 4 or len(set(opts)) != len(opts):
            errors.append(f"{where}: 보기는 서로 다른 3~4개")
        a = q.get("answer")
        if not isinstance(a, int) or not 0 <= a < len(opts):
            errors.append(f"{where}: answer는 보기 번호(0부터)")
        answers.append(a)
        m = QREF.match(str(q.get("ref") or ""))
        if not m:
            errors.append(f"{where}: ref 형식은 'YYYY-MM-DD#lead|k0|g0'")
            continue
        rd, anchor = m.groups()
        rday = date.fromisoformat(rd)
        if rday == today:
            n_today += 1
            src = d
        elif today - timedelta(days=7) <= rday < today:
            n_past += 1
            p = ISSUES / f"{rd}.json"
            src = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
            if src is None:
                errors.append(f"{where}: ref {rd} 호가 없음")
                continue
        else:
            errors.append(f"{where}: ref는 오늘 또는 지난 7일 안의 호여야 함 ({rd})")
            continue
        if anchor != "lead":
            sec, n = ("kr" if anchor[0] == "k" else "global"), int(anchor[1:])
            if n >= len(src.get(sec) or []):
                errors.append(f"{where}: ref {q['ref']}가 가리키는 기사가 없음")
    if past_available and (n_today != 1 or n_past != 2):
        errors.append(f"quiz는 오늘 기사 1문항 + 지난 7일 기사 2문항 (현재 오늘 {n_today}, 지난 {n_past})")
    if sum(q.get("type") in ("인과", "연결") for q in quiz) < 2:
        errors.append("quiz는 '인과'나 '연결' 문항이 2개 이상이어야 함")
    if len(answers) == 3 and len(set(answers)) == 1:
        errors.append("quiz 정답 위치가 모두 같음: 정답 보기 위치를 섞을 것")


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
    check_quiz(d, path, errors)
    if len(d.get("kr") or []) < 2:
        errors.append("국내 브리핑은 최소 2건")
    for key in TERM.findall(path.read_text(encoding="utf-8")):
        if key not in glossary:
            errors.append(f"용어 [[{key}|..]]가 data/glossary.json에 없음")
    return d, errors


def main():
    glossary = json.loads((ROOT / "data" / "glossary.json").read_text(encoding="utf-8"))
    entries, failed = [], False
    cerr = []
    check_companies(cerr)
    if cerr:
        failed = True
        print("✗ companies.json")
        for e in cerr:
            print(f"   - {e}")
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
