#!/usr/bin/env python3
"""Collect market data for the morning brief → data/market.json.

Runs in GitHub Actions (open internet). Each source is optional: if one fails or
its API key is missing, the others are still written.
  - 주가: Yahoo Finance chart API (키 불필요)
  - 박스오피스: KOBIS 일별 박스오피스 (env KOBIS_KEY)
  - 공시: OpenDART 공시검색 (env DART_KEY)
"""
import datetime as dt
import io
import json
import os
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KST = dt.timezone(dt.timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0 (jeontongmi brief bot)"}

GROUPS = [
    ("국내 · 전자", [("삼성전자", "005930.KS"), ("SK하이닉스", "000660.KS"), ("LG전자", "066570.KS")]),
    ("국내 · 통신", [("SK텔레콤", "017670.KS"), ("KT", "030200.KS"), ("LG유플러스", "032640.KS")]),
    ("국내 · 미디어·플랫폼", [("CJ ENM", "035760.KQ"), ("스튜디오드래곤", "253450.KQ"), ("NAVER", "035420.KS"), ("카카오", "035720.KS")]),
    ("국내 · 엔터", [("하이브", "352820.KS"), ("JYP Ent.", "035900.KQ"), ("에스엠", "041510.KQ"), ("YG엔터", "122870.KQ")]),
    ("해외 (미국 장 기준)", [("Netflix", "NFLX"), ("Spotify", "SPOT"), ("Disney", "DIS"), ("Sony", "SONY")]),
]

# 공시를 모아볼 기업(종목코드). OpenDART 고유번호는 실행 시 corpCode.xml에서 찾는다.
DART_STOCKS = {
    "CJ ENM": "035760", "스튜디오드래곤": "253450", "하이브": "352820",
    "SK텔레콤": "017670", "KT": "030200", "LG유플러스": "032640",
}


def get(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def quote(sym):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range=5d&interval=1d"
    res = get(url)["chart"]["result"][0]
    closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
    if len(closes) < 2:
        raise ValueError("not enough closes")
    return {"close": round(closes[-1], 2), "chg": round((closes[-1] / closes[-2] - 1) * 100, 2),
            "cur": res["meta"].get("currency", "")}


def stocks():
    groups = []
    for name, rows in GROUPS:
        out = []
        for label, sym in rows:
            try:
                out.append({"name": label, "ticker": sym, **quote(sym)})
            except Exception as e:  # noqa: BLE001 - one bad ticker must not stop the run
                print(f"  ! {sym}: {e}", file=sys.stderr)
        if out:
            groups.append({"name": name, "rows": out})
    return groups


def boxoffice(key):
    day = (dt.datetime.now(KST) - dt.timedelta(days=1)).strftime("%Y%m%d")
    url = ("https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json?"
           + urllib.parse.urlencode({"key": key, "targetDt": day}))
    rows = get(url)["boxOfficeResult"]["dailyBoxOfficeList"]
    return {"date": f"{day[4:6]}.{day[6:]}", "items": [
        {"rank": int(r["rank"]), "name": r["movieNm"], "audi": int(r["audiCnt"]), "acc": int(r["audiAcc"])} for r in rows]}


def corp_codes(key):
    url = "https://opendart.fss.or.kr/api/corpCode.xml?" + urllib.parse.urlencode({"crtfc_key": key})
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        z = zipfile.ZipFile(io.BytesIO(r.read()))
    root = ET.fromstring(z.read(z.namelist()[0]))
    by_stock = {el.findtext("stock_code", "").strip(): el.findtext("corp_code") for el in root.iter("list")}
    return {name: by_stock[s] for name, s in DART_STOCKS.items() if s in by_stock}


def disclosures(key):
    end = dt.datetime.now(KST)
    begin = end - dt.timedelta(days=3)
    out = []
    for corp, code in corp_codes(key).items():
        url = "https://opendart.fss.or.kr/api/list.json?" + urllib.parse.urlencode({
            "crtfc_key": key, "corp_code": code, "bgn_de": begin.strftime("%Y%m%d"),
            "end_de": end.strftime("%Y%m%d"), "page_count": 10})
        data = get(url)
        for r in data.get("list", []):
            out.append({"date": r["rcept_dt"], "corp": corp, "title": r["report_nm"].strip(),
                        "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={r['rcept_no']}"})
    return sorted(out, key=lambda r: r["date"], reverse=True)


def main():
    path = ROOT / "data" / "market.json"
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    data = {"updated": dt.datetime.now(KST).strftime("%m.%d %H:%M"), "groups": [], "boxoffice": None, "disclosures": []}

    try:
        data["groups"] = stocks()
    except Exception as e:  # noqa: BLE001
        print(f"stocks failed: {e}", file=sys.stderr)
    if os.environ.get("KOBIS_KEY"):
        try:
            data["boxoffice"] = boxoffice(os.environ["KOBIS_KEY"])
        except Exception as e:  # noqa: BLE001
            print(f"kobis failed: {e}", file=sys.stderr)
    if os.environ.get("DART_KEY"):
        try:
            data["disclosures"] = disclosures(os.environ["DART_KEY"])
        except Exception as e:  # noqa: BLE001
            print(f"dart failed: {e}", file=sys.stderr)

    if not data["groups"] and not data["boxoffice"] and not data["disclosures"]:
        print("모든 소스 실패: 기존 market.json 유지", file=sys.stderr)
        data = old
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"market.json: {sum(len(g['rows']) for g in data.get('groups', []))} quotes, "
          f"boxoffice={'yes' if data.get('boxoffice') else 'no'}, disclosures={len(data.get('disclosures', []))}")


if __name__ == "__main__":
    main()
