#!/usr/bin/env python3
"""Collect market data for the morning brief → data/market.json.

Runs in GitHub Actions (open internet). Each source is optional: if one fails or
its API key is missing, the others are still written.
  - 주가: Yahoo Finance chart API (키 불필요)
    env MODE: close(기본, 직전 종가) / open(오늘 개장가) / intraday(현재가, 지연 시세)
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


WEEKDAY = "월화수목금토일"
def _auto_mode(now):
    """KST 시각으로 모드를 정한다: 12시 전 개장가, 12:00~15:39 장중, 그 외 종가."""
    hm = now.hour * 100 + now.minute
    if 900 <= hm < 1200:
        return "open"
    if 1200 <= hm < 1540:
        return "intraday"
    return "close"


MODE = os.environ.get("MODE", "auto") or "auto"
# 요청 모드가 시각과 맞지 않으면(예: 오후에 개장가 요청) 시각 기준 모드를 따른다. 종가 요청은 그대로 둔다.
if MODE == "auto" or (MODE in ("open", "intraday") and MODE != _auto_mode(dt.datetime.now(KST))):
    MODE = _auto_mode(dt.datetime.now(KST))


def quote(sym):
    """가격과 '무엇 기준인지'를 함께 돌려준다. 등락률은 항상 직전 거래일 종가 대비."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range=5d&interval=1d"
    res = get(url)["chart"]["result"][0]
    meta, q = res["meta"], res["indicators"]["quote"][0]
    tz = dt.timezone(dt.timedelta(seconds=meta.get("gmtoffset", 0)))
    bars = [(dt.datetime.fromtimestamp(t, tz).date(), o, c)
            for t, o, c in zip(res["timestamp"], q["open"], q["close"]) if c is not None]
    if len(bars) < 2:
        raise ValueError("not enough bars")
    mtime = dt.datetime.fromtimestamp(meta["regularMarketTime"], tz)
    session_end = dt.datetime.fromtimestamp(meta["currentTradingPeriod"]["regular"]["end"], tz)
    # 최신 시세는 있는데 그날 일봉이 아직 안 올라온 경우(미국 종목에서 자주 생김): 최신 시세로 그날 봉을 채운다
    if mtime.date() > bars[-1][0]:
        bars.append((mtime.date(), None, meta["regularMarketPrice"]))
    today_bar = bars[-1][0] == mtime.date()
    prev_close = bars[-2][2] if today_bar else bars[-1][2]
    day = f"{mtime:%m.%d}({WEEKDAY[mtime.weekday()]})"

    # 장이 끝났거나, 아직 오늘 장이 열리지 않아 마지막 시세가 이전 거래일 것이면 → 종가
    if not today_bar or mtime >= session_end or mtime.date() < session_end.date():
        price = bars[-1][2]
        prev_close = bars[-2][2]
        d = bars[-1][0]
        basis = f"{d:%m.%d}({WEEKDAY[d.weekday()]}) 종가"
    elif MODE == "open" and bars[-1][1] is not None:  # 개장가
        price, basis = bars[-1][1], f"{day} 개장가"
    else:                                              # 장중 현재가(지연 시세)
        price, basis = meta["regularMarketPrice"], f"{day} {mtime:%H:%M} 장중"
    return {"close": round(price, 2), "chg": round((price / prev_close - 1) * 100, 2),
            "cur": meta.get("currency", ""), "basis": basis,
            "as_of": mtime.isoformat(timespec="minutes"), "last_bar": bars[-1][0].isoformat()}


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
            # 그룹 기준 표시는 가장 많은 종목이 따르는 기준으로
            basis = max({r["basis"] for r in out}, key=[r["basis"] for r in out].count)
            groups.append({"name": name, "basis": basis, "rows": out})
    return groups


def boxoffice(key):
    day = (dt.datetime.now(KST) - dt.timedelta(days=1)).strftime("%Y%m%d")
    url = ("https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json?"
           + urllib.parse.urlencode({"key": key, "targetDt": day}))
    rows = get(url)["boxOfficeResult"]["dailyBoxOfficeList"]
    if not rows:
        raise ValueError(f"{day} 박스오피스가 아직 집계되지 않음")
    d = dt.date(int(day[:4]), int(day[4:6]), int(day[6:]))
    return {"date": f"{day[4:6]}.{day[6:]}({WEEKDAY[d.weekday()]})", "items": [
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
    now = dt.datetime.now(KST)
    data = {"updated": now.strftime("%m.%d %H:%M"), "updated_at": now.isoformat(timespec="minutes"),
            "groups": [], "boxoffice": None, "disclosures": []}

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

    # 실패한 소스는 직전 값을 유지한다(날짜가 함께 표시되므로 오래된 값인지 독자가 알 수 있다)
    for k in ("groups", "boxoffice"):
        if not data[k] and old.get(k):
            print(f"{k}: 이번 수집 실패, 직전 값 유지", file=sys.stderr)
            data[k] = old[k]
    data["mode"] = MODE
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"market.json: {sum(len(g['rows']) for g in data.get('groups', []))} quotes, "
          f"boxoffice={'yes' if data.get('boxoffice') else 'no'}, disclosures={len(data.get('disclosures', []))}")


if __name__ == "__main__":
    main()
