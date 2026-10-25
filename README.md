# 전.통.미. SEASON 2

전자·통신·미디어, 연결된 고리를 읽는 아침 브리프. 매일 오전 7시 30분까지 자동으로 발행됩니다.

## 매일 어떻게 만들어지나

| 시각(KST) | 무엇이 | 하는 일 |
|---|---|---|
| 06:07 | GitHub Actions (`data.yml`) | 주가·박스오피스·공시를 모아 `data/market.json`에 커밋 |
| 06:37 | Claude 예약 작업 | `EDITORIAL.md`대로 뉴스를 검색·선별·분석해 `data/issues/<날짜>.json` 작성, 검증 후 푸시 |
| 푸시 직후 | GitHub Pages | 사이트 자동 갱신 |

## 폴더 구조

```
index.html              사이트 껍데기
assets/app.js           JSON → 화면 렌더러(차트·보관함·용어 도움말)
assets/style.css
data/issues/*.json      하루 한 호
data/index.json         보관함 목록 (validate_issue.py가 자동 생성)
data/glossary.json      용어 도움말
data/market.json        시장 데이터 (Actions가 자동 갱신)
scripts/validate_issue.py   발행 전 검증 + index.json 재생성
scripts/fetch_market.py     시장 데이터 수집
EDITORIAL.md            편집 지침 (발행 세션이 매일 읽음)
```

## 처음 설정

1. **GitHub Pages**: Settings → Pages → Source를 `Deploy from a branch`, 브랜치 `main` / `/ (root)`로 설정
2. **API 키(선택)**: Settings → Secrets and variables → Actions → New repository secret
   - `KOBIS_KEY`: [KOBIS 오픈API](https://www.kobis.or.kr/kobisopenapi/homepg/main/main.do)에서 발급 (박스오피스)
   - `DART_KEY`: [OpenDART](https://opendart.fss.or.kr/)에서 발급 (공시)
   - 키가 없어도 주가 데이터는 수집되고, 해당 패널만 비어 있습니다.
3. **Actions 권한**: Settings → Actions → General → Workflow permissions를 `Read and write`로

## 편집 기준을 바꾸고 싶을 때

`EDITORIAL.md`를 고치면 다음 날 아침부터 반영됩니다. 기사 개수, 출처, 섹션 구성, 문체 모두 여기서 정합니다.

## 로컬에서 보기

```
python3 -m http.server 8000
# http://localhost:8000
```
