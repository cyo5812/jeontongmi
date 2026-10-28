// 전.통.미. renderer: data/index.json → data/issues/<date>.json, data/market.json, data/glossary.json
const AXES = ["전자", "통신", "미디어"];
let GLOSS = {};
let CW = 640; // 차트 폭: 화면 폭에 맞춰 그려서 모바일에서도 글자가 줄어들지 않게 한다

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// [[key|표시어]] → 용어 툴팁
const rich = s => esc(s).replace(/\[\[([a-z0-9_-]+)\|([^\]]+)\]\]/g, (m, k, t) =>
  GLOSS[k] ? `<span class="term" tabindex="0" data-def="${esc(GLOSS[k])}">${t}</span>` : t);
// 의미 단위 줄바꿈: 쉼표·마침표 뒤에서만 줄이 바뀌도록 구절을 묶는다. 구절이 줄에 다 안 들어가면 통째로 다음 줄로 넘어간다.
const seg = s => String(s ?? "").split(/(?<=[,.!?]) +/).map(p => `<span class="seg">${rich(p)}</span>`).join(" ");
const fmt = (v, d = 0) => Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
const safeUrl = u => /^https?:\/\//.test(u) ? esc(u) : "#";

async function getJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}

const axisBadge = ax => `<span class="axis" aria-label="${esc((ax || []).join("·"))} 관련">${AXES.map(a => `<b class="${(ax || []).includes(a) ? "on" : ""}" title="${a}">${a[0]}</b>`).join("")}</span>`;
const chips = (s) => `<div class="chips">${axisBadge(s.axis)}${(s.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join("")}<span class="num">${esc(s.date)}</span></div>`;
const srcs = list => `<div class="src"><span>출처</span>${(list || []).map(([n, u]) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join("")}</div>`;

/* ---------- charts ---------- */
function hbar(f) {
  const d = f.items, W = CW, rowH = 34, top = 8, left = Math.min(150, W * 0.34), right = 64, H = top + d.length * rowH + 8;
  const max = f.max || Math.max(...d.map(x => x[1])) * 1.05;
  const x = v => left + (W - left - right) * v / max, dec = f.decimals ?? 0, u = f.unit || "";
  const ticks = [0, max / 2, max];
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(f.title)}">`;
  ticks.forEach(t => { s += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${top - 4}" y2="${H - 4}"/>`; });
  d.forEach(([n, v], i) => {
    const y = top + i * rowH, hi = n === f.highlight, w = Math.max(x(v) - left, 6);
    s += `<text x="${left - 12}" y="${y + 18}" text-anchor="end"${hi ? ' style="fill:var(--fg);font-weight:600"' : ""}>${esc(n)}</text>`;
    s += `<path class="mark" data-tip="${esc(n)} · ${fmt(v, dec)}${esc(u)}" d="M${left},${y + 6} h${w - 4} a4,4 0 0 1 4,4 v10 a4,4 0 0 1 -4,4 h-${w - 4} z" fill="${hi ? "var(--accent)" : "var(--accent-3)"}"/>`;
    s += `<text class="v" x="${x(v) + 8}" y="${y + 18}">${fmt(v, dec)}${esc(u)}</text>`;
  });
  return s + `</svg>`;
}

function stack(f) {
  const W = CW, H = 54, total = f.total || f.items.reduce((a, b) => a + b[1], 0), u = f.unit || "";
  const cols = ["var(--ink-strong)", "var(--accent-3)", "var(--accent)", "var(--muted)"];
  const colorOf = (n, i) => n === f.emphasis ? "var(--kr)" : cols[i % cols.length];
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(f.title)}">`, x0 = 0;
  f.items.forEach(([n, v], i) => {
    const last = i === f.items.length - 1, w = Math.max(W * v / total - (last ? 0 : 2), 4);
    s += `<rect class="mark" data-tip="${esc(n)} · ${fmt(v)}${esc(u)} (${(v / total * 100).toFixed(1)}%)" x="${x0}" y="10" width="${w}" height="34" rx="${i === 0 || last ? 4 : 0}" fill="${colorOf(n, i)}"/>`;
    x0 += w + 2;
  });
  s += `</svg>`;
  const legend = `<div class="legend">${f.items.map(([n, v], i) => `<span><i style="background:${colorOf(n, i)}"></i>${esc(n)} <b class="num">${fmt(v)}${esc(u)} · ${(v / total * 100).toFixed(1)}%</b></span>`).join("")}</div>`;
  return s + "\n" + legend;
}

function dots(f) {
  const W = CW, left = Math.min(120, W * 0.3), right = 24, rowH = 28, top = 22, d = f.items;
  const vals = d.map(x => x[1]).concat(f.ref ? [f.ref[1]] : []);
  const [lo, hi] = f.domain || [Math.min(...vals) * 0.97, Math.max(...vals) * 1.03];
  const step = f.step || (hi - lo) / 5, H = top + d.length * rowH + 26;
  const x = v => left + (W - left - right) * (v - lo) / (hi - lo);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(f.title)}">`;
  for (let t = lo; t <= hi + 1e-9; t += step) s += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${top + d.length * rowH - 6}"/><text x="${x(t)}" y="${H - 4}" text-anchor="middle" class="num">${fmt(t)}</text>`;
  if (f.ref) {
    const cx = x(f.ref[1]);
    s += `<line x1="${cx}" x2="${cx}" y1="${top - 12}" y2="${top + d.length * rowH - 2}" stroke="var(--kr)" stroke-width="2" stroke-dasharray="4 3"/>`;
    s += `<text x="${cx + 6}" y="${top - 6}" style="fill:var(--kr);font-weight:600">${esc(f.ref[0])} ${fmt(f.ref[1])}</text>`;
  }
  d.forEach(([n, v], i) => {
    const y = top + 12 + i * rowH, flip = x(v) > W - right - 80;
    s += `<text x="${left - 14}" y="${y + 4}" text-anchor="end">${esc(n)}</text>`;
    s += `<circle class="mark" data-tip="${esc(n)} · ${fmt(v)}" cx="${x(v)}" cy="${y}" r="6" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/>`;
    s += `<text class="v" x="${x(v) + (flip ? -12 : 12)}" y="${y + 4}" text-anchor="${flip ? "end" : "start"}">${fmt(v)}</text>`;
  });
  return s + `</svg>`;
}

const CHARTS = { hbar, stack, dots };
function figure(f, inLead) {
  if (!f || !CHARTS[f.type]) return "";
  const out = CHARTS[f.type](f).split("\n");
  return `<div class="fig">
    ${inLead ? `<h4><span class="label">STRUCTURE</span>${esc(f.title)}</h4>` : `${f.kicker ? `<div class="label">${esc(f.kicker)}</div>` : ""}<h3>${esc(f.title)}</h3>`}
    ${f.caption ? `<p class="cap">${rich(f.caption)}</p>` : ""}
    <div class="chart">${out[0]}</div>${out[1] || ""}
    ${f.note ? `<p class="note">${esc(f.note)}</p>` : ""}
  </div>`;
}

/* ---------- 공유 ---------- */
let CURRENT = ""; // "d=2026-10-28" 또는 "w=2026-11-02"
const SHARE_ICON = `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M8 11.5 12 7.5M7 6.5l1.5-1.5a3.2 3.2 0 0 1 4.5 4.5L11.5 11M13 13.5 11.5 15a3.2 3.2 0 0 1-4.5-4.5L8.5 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const shareBtn = (id, title, label = "링크 공유") =>
  `<button type="button" class="share" data-share="${id}" data-title="${esc(title)}">${SHARE_ICON}<span>${label}</span></button>`;
const shareUrl = id => `${location.origin}${location.pathname}?${CURRENT}${id ? "#" + id : ""}`;

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
async function share(btn) {
  const url = shareUrl(btn.dataset.share), title = `${btn.dataset.title} · 전.통.미.`;
  // 휴대폰은 기기 공유창(카카오톡·메시지 등), 그 외에는 링크 복사
  if (navigator.share && matchMedia("(pointer:coarse)").matches) {
    try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast("링크를 복사했어요"); }
  catch (e) { toast(url); }
}

/* ---------- sections ---------- */
function brief(b, id, kl = "한국 시사점") {
  return `<article class="brief" id="${id}">
    ${chips(b)}
    <h3>${seg(b.title)}</h3>
    <p>${rich(b.body)}</p>
    ${b.why ? `<p class="why"><b>왜 중요한가</b>${rich(b.why)}</p>` : ""}
    ${b.krline ? `<div class="krline"><b>${kl}</b><span>${seg(b.krline)}</span></div>` : ""}
    <div class="foot">${srcs(b.src)}${shareBtn(id, b.title)}</div>
  </article>`;
}

function section(id, title, sub, items, prefix, kl) {
  if (!items || !items.length) return "";
  return `<section id="${id}"><div class="section-head"><h2>${title}</h2><p>${sub}</p></div>${items.map((b, i) => brief(b, prefix + i, kl)).join("")}</section>`;
}

function marketPanel(m) {
  if (!m || !m.updated) return "";
  let h = `<div class="market"><h3>시장 · 데이터</h3>`;
  (m.groups || []).forEach(g => {
    h += `<table><caption>${esc(g.name)}${g.basis ? `<span class="basis">${esc(g.basis)}</span>` : ""}</caption><tbody>${g.rows.map(r => {
      const c = Number(r.chg), cls = c > 0 ? "up" : c < 0 ? "down" : "";
      return `<tr><td>${esc(r.name)}</td><td>${fmt(r.close, r.cur === "USD" ? 2 : 0)}</td><td class="${cls}">${c > 0 ? "+" : ""}${c.toFixed(2)}%</td></tr>`;
    }).join("")}</tbody></table>`;
  });
  if (m.boxoffice && m.boxoffice.items && m.boxoffice.items.length) {
    h += `<table><caption>박스오피스<span class="basis">${esc(m.boxoffice.date)} 관객</span></caption><tbody>${m.boxoffice.items.slice(0, 5).map(b => `<tr><td>${esc(b.rank)}. ${esc(b.name)}</td><td>${fmt(b.audi)}</td><td>누적 ${fmt(Math.round(b.acc / 10000))}만</td></tr>`).join("")}</tbody></table>`;
  }
  if (m.disclosures && m.disclosures.length) {
    h += `<table><caption>주요 공시</caption><tbody>${m.disclosures.slice(0, 6).map(d => `<tr><td colspan="3"><a href="${safeUrl(d.url)}" target="_blank" rel="noopener">${esc(d.corp)} · ${esc(d.title)}</a></td></tr>`).join("")}</tbody></table>`;
  }
  return h + `<p class="stamp">등락률은 직전 거래일 종가 대비 · ${esc(m.updated)} 수집</p></div>`;
}

/* 일정 날짜: "MM.DD"로 시작하면 요일을 코드가 직접 계산해 붙인다(데이터에 적힌 요일은 무시).
   날짜+요일은 한 덩어리로 묶어 줄바꿈되지 않게 하고, 시각 등 나머지는 다음 줄에 둔다. */
const WD = "일월화수목금토";
function calWhen(w, issueDate) {
  const m = String(w ?? "").trim().match(/^(\d{1,2})\.(\d{1,2})\s*(?:\([^)]*\))?\s*(.*)$/);
  if (!m) return `<span class="when">${esc(w)}</span>`;
  const [y0, m0] = issueDate.split("-").map(Number);
  const mo = +m[1], da = +m[2], y = mo < m0 ? y0 + 1 : y0; // 발행월보다 앞선 달이면 다음 해
  const day = new Date(y, mo - 1, da);
  const wd = day.getMonth() === mo - 1 ? `(${WD[day.getDay()]})` : "";
  const md = `${String(mo).padStart(2, "0")}.${String(da).padStart(2, "0")}`;
  return `<span class="when"><span class="nb">${md}${wd}</span>${m[3] ? `<small>${esc(m[3])}</small>` : ""}</span>`;
}

function renderIssue(d, market, older, newer) {
  const L = d.lead;
  const toc = [["LEAD", "#lead", L.title]]
    .concat((d.kr || []).map((b, i) => ["국내", "#k" + i, b.title]))
    .concat((d.global || []).map((b, i) => ["GLOBAL", "#g" + i, b.title]));
  const dt = d.date.replaceAll("-", ".");
  document.title = `전.통.미. · ${dt}`;
  return `
  <div class="edition">
    <h1>${seg(d.headline)}</h1>
    <div class="meta"><span class="num">${dt} (${esc(d.weekday)})</span><span>${d.label ? esc(d.label) + " " : ""}${esc(d.vol)}호</span><span>${esc(d.readMin)}분 읽기</span>${shareBtn("", d.headline, "이번 호 공유")}</div>
  </div>
  <nav class="issue-nav" aria-label="호 이동">
    ${older ? `<a href="?d=${esc(older.date)}" rel="prev"><span>← 이전 호</span><b class="num">${esc(older.date.replaceAll("-", "."))}</b></a>` : `<span class="off">첫 호입니다</span>`}
    ${newer ? `<a href="?d=${esc(newer.date)}" rel="next" class="next"><span>다음 호 →</span><b class="num">${esc(newer.date.replaceAll("-", "."))}</b></a>` : `<span class="off next">최신 호입니다</span>`}
  </nav>
  ${weeklyCard(WEEKLY.find(w => w.id === d.date))}
  ${d.note ? `<p class="issue-note">${String(d.note).split(/(?<=[.!?])\s+/).map(t => `<span class="line">${esc(t)}</span>`).join("")}</p>` : ""}

  <section class="brief60" aria-label="60초 브리핑">
    <div class="label">60초 브리핑</div>
    <div>
      <ol>${d.brief60.map(t => `<li><span>${seg(t)}</span></li>`).join("")}</ol>
      ${d.lens ? `<p class="lens"><b>오늘의 관점</b>${seg(d.lens)}</p>` : ""}
    </div>
  </section>

  <div class="layout">
    <div>
      <article class="lead" id="lead">
        <div class="section-head"><h2>리드 스토리</h2><p>오늘 가장 깊게 볼 이슈</p></div>
        ${chips(L)}
        <h3>${seg(L.title)}</h3>
        <p class="dek">${seg(L.dek)}</p>
        <h4><span class="label">FACT</span>무슨 일이 있나</h4>
        <ul>${L.what.map(t => `<li>${rich(t)}</li>`).join("")}</ul>
        ${figure(L.figure, true)}
        <h4><span class="label">WHY</span>왜 중요한가</h4>
        <p>${rich(L.why)}</p>
        ${L.planner && L.planner.length ? `<div class="planner"><span class="label">내가 전략기획자라면</span><ol>${L.planner.map(([a, b]) => `<li><b>${esc(a)}</b><span>${seg(b)}</span></li>`).join("")}</ol></div>` : ""}
        <h4><span class="label">WATCH</span>지켜볼 것</h4>
        <p class="watch">${seg(L.watch)}</p>
        <div class="foot">${srcs(L.src)}${shareBtn("lead", L.title)}</div>
      </article>
      ${section("kr", "국내 브리핑", `${(d.kr || []).length}건`, d.kr, "k", "산업 시사점")}
      ${section("global", "글로벌 브리핑", `${(d.global || []).length}건 · 모두 한국 시사점 포함`, d.global, "g")}
      ${d.figures && d.figures.length ? `<section id="numbers"><div class="section-head"><h2>숫자로 보는 산업</h2><p>오늘 기사 속 수치를 한눈에</p></div>${d.figures.map(f => figure(f)).join("")}</section>` : ""}
    </div>
    <aside class="rail">
      <nav class="toc" aria-label="이번 호 목차">${toc.map(([k, h, t]) => `<a href="${h}"><span>${k}</span>${esc(t)}</a>`).join("")}</nav>
      ${marketPanel(market)}
      ${d.calendar && d.calendar.length ? `<div class="cal"><h3>다가오는 일정</h3><ul>${d.calendar.map(([w, t, n]) => `<li>${calWhen(w, d.date)}<span>${esc(t)}${n ? `<em>${esc(n)}</em>` : ""}</span></li>`).join("")}</ul></div>` : ""}
      <div class="gloss"><h3>용어 도움말</h3><p>점선 밑줄이 있는 용어에 마우스를 올리거나 탭하면 설명이 나옵니다.</p></div>
    </aside>
  </div>`;
}


/* ---------- 위클리 리포트 ---------- */
let WEEKLY = [];
const md = s => String(s).slice(5).replace("-", ".");          // 2026-10-26 → 10.26
const span = w => `${md(w.from)} – ${md(w.to)}`;
const dayOf = s => WD[new Date(s + "T00:00:00").getDay()];
const refHref = r => { const [d, a] = String(r).split("#"); return `?d=${esc(d)}${a ? "#" + esc(a) : ""}`; };
const lines = s => String(s ?? "").split(/(?<=[.!?])\s+/).map(t => `<span class="line">${esc(t)}</span>`).join("");

// 월요일 호 상단: 그날 발행된 위클리로 가는 카드
const weeklyCard = w => !w ? "" : `
  <a class="weekly-card" href="?w=${esc(w.id)}">
    <span class="label">WEEKLY REPORT</span>
    <span class="wc-span num">${span(w)}</span>
    <b>${seg(w.headline)}</b>
    <span class="wc-go">지난주 정리 읽기 →</span>
  </a>`;

const STATUS_CLS = { "확인": "ok", "변경": "chg", "대기": "wait", "다루지 못함": "none" };

function renderWeekly(w, older, newer, issues) {
  const inWeek = issues.filter(e => e.date >= w.from && e.date <= w.to).sort((a, b) => a.date < b.date ? -1 : 1);
  document.title = `전.통.미. 위클리 · ${span(w)}`;
  const toc = (w.threads || []).map((t, i) => [`흐름 ${i + 1}`, "#t" + i, t.title])
    .concat([["숫자", "#wnum", "숫자로 본 한 주"]])
    .concat(w.checkback && w.checkback.length ? [["확인", "#wcheck", "예고했던 일정, 실제로는"]] : [])
    .concat([["다음 주", "#wnext", "다음 주 볼 것"]]);
  return `
  <div class="edition weekly-edition">
    <div class="w-kicker"><span class="label">WEEKLY REPORT</span><span class="num">${span(w)}</span></div>
    <h1>${seg(w.headline)}</h1>
    <div class="meta"><span>위클리 ${esc(w.vol)}호</span><span>${esc(w.readMin || 5)}분 읽기</span><span>매일 호 ${inWeek.length}개 정리</span>${shareBtn("", w.headline, "이번 위클리 공유")}</div>
  </div>
  <nav class="issue-nav" aria-label="위클리 이동">
    ${older ? `<a href="?w=${esc(older.id)}" rel="prev"><span>← 이전 위클리</span><b class="num">${span(older)}</b></a>` : `<span class="off">첫 위클리입니다</span>`}
    ${newer ? `<a href="?w=${esc(newer.id)}" rel="next" class="next"><span>다음 위클리 →</span><b class="num">${span(newer)}</b></a>` : `<span class="off next">최신 위클리입니다</span>`}
  </nav>
  ${w.note ? `<p class="issue-note">${lines(w.note)}</p>` : ""}

  <section class="brief60" aria-label="이번 주 3줄">
    <div class="label">이번 주 3줄</div>
    <div>
      <ol>${w.summary.map(t => `<li><span>${seg(t)}</span></li>`).join("")}</ol>
      ${w.lens ? `<p class="lens"><b>이번 주의 관점</b>${seg(w.lens)}</p>` : ""}
    </div>
  </section>

  <div class="layout">
    <div>
      <section id="wthreads">
        <div class="section-head"><h2>이번 주의 흐름</h2><p>여러 날에 걸쳐 이어진 이야기 ${w.threads.length}개</p></div>
        ${w.threads.map((t, i) => `
        <article class="thread" id="t${i}">
          <div class="chips">${axisBadge(t.axis)}<span class="num">${t.timeline.length}건 · ${md(t.timeline[0][0].slice(0, 10))}–${md(t.timeline[t.timeline.length - 1][0].slice(0, 10))}</span></div>
          <h3>${seg(t.title)}</h3>
          <p class="story">${rich(t.story)}</p>
          <ol class="timeline">${t.timeline.map(([r, txt]) => `<li><a href="${refHref(r)}"><span class="num">${md(r.slice(0, 10))}(${dayOf(r.slice(0, 10))})</span><span>${rich(txt)}</span></a></li>`).join("")}</ol>
          <p class="why"><b>왜 중요한가</b>${rich(t.why)}</p>
          ${t.next ? `<p class="t-next"><b>다음에 볼 것</b>${seg(t.next)}</p>` : ""}
          <div class="foot"><span></span>${shareBtn("t" + i, t.title)}</div>
        </article>`).join("")}
      </section>

      <section id="wnum">
        <div class="section-head"><h2>숫자로 본 한 주</h2><p>숫자를 누르면 원래 기사로 갑니다</p></div>
        <div class="wnums">${w.numbers.map(x => `
          <a class="wnum" href="${refHref(x.ref)}">
            <b class="num">${esc(x.value)}</b>
            <span class="wn-label">${seg(x.label)}</span>
            ${x.note ? `<span class="wn-note">${seg(x.note)}</span>` : ""}
            <span class="wn-ref num">${md(x.ref.slice(0, 10))}호 →</span>
          </a>`).join("")}</div>
      </section>

      ${w.checkback && w.checkback.length ? `<section id="wcheck">
        <div class="section-head"><h2>예고했던 일정, 실제로는</h2><p>매일 호 '다가오는 일정'에 적었던 것</p></div>
        <ul class="checkback">${w.checkback.map(c => `
          <li>
            ${calWhen(c.when, w.from)}
            <div><b>${esc(c.what)}</b><span class="st st-${STATUS_CLS[c.status] || "none"}">${esc(c.status)}</span>
              <p>${seg(c.result)}${c.ref ? ` <a href="${refHref(c.ref)}" class="cb-ref">${md(c.ref.slice(0, 10))}호 →</a>` : ""}</p></div>
          </li>`).join("")}</ul>
      </section>` : ""}

      <section id="wnext">
        <div class="section-head"><h2>다음 주 볼 것</h2><p>일정과 관전 포인트</p></div>
        <ul class="wnext">${w.next.map(([when, what, pt]) => `
          <li>${calWhen(when, w.id)}<div><b>${esc(what)}</b><p>${seg(pt)}</p></div></li>`).join("")}</ul>
      </section>
    </div>
    <aside class="rail">
      <nav class="toc" aria-label="위클리 목차">${toc.map(([k, h, t]) => `<a href="${h}"><span>${k}</span>${esc(t)}</a>`).join("")}</nav>
      <div class="week-issues"><h3>이번 주 매일 호</h3><ul>${inWeek.map(e => `<li><a href="?d=${esc(e.date)}"><span class="num">${md(e.date)}(${dayOf(e.date)})</span><span>${esc(e.headline)}</span></a></li>`).join("")}</ul></div>
      <div class="gloss"><h3>위클리는 이렇게 만듭니다</h3><p>${lines("그 주에 발행된 매일 호만 다시 읽어 정리합니다. 새로운 사실은 넣지 않고, 모든 숫자와 흐름은 원래 기사로 연결됩니다.")}</p></div>
    </aside>
  </div>`;
}

/* ---------- archive ---------- */
let INDEX = [], FILTER = "전체";
function renderArchive(current) {
  const all = INDEX.map(e => ({ ...e, sort: e.date }))
    .concat(WEEKLY.map(w => ({ ...w, weekly: true, sort: w.id + "w" })))   // 같은 날이면 위클리를 위에
    .sort((a, b) => a.sort < b.sort ? 1 : -1);
  const list = all.filter(e => FILTER === "전체" || (FILTER === "위클리" ? e.weekly : !e.weekly && (e.axis || []).includes(FILTER)));
  const filters = ["전체"].concat(AXES).concat(WEEKLY.length ? ["위클리"] : []);
  document.getElementById("archive-filters").innerHTML = filters.map(a =>
    `<button type="button" id="f-${a}" aria-pressed="${a === FILTER}" data-f="${a}">${a}</button>`).join("");
  document.getElementById("archive-list").innerHTML = list.length ? list.map(e => e.weekly ? `
    <li class="is-weekly"><a href="?w=${esc(e.id)}"${"w=" + e.id === current ? ' aria-current="page"' : ""}>
      <span><span class="wtag">WEEKLY</span><span class="num">${span(e)}</span></span>
      <span><h3>${esc(e.headline)}</h3></span>
    </a></li>` : `
    <li><a href="?d=${esc(e.date)}"${"d=" + e.date === current ? ' aria-current="page"' : ""}>
      <span class="num">${esc(e.date.replaceAll("-", "."))}</span>
      <span><h3>${esc(e.headline)}</h3></span>
    </a></li>`).join("") : `<li class="empty">이 분야를 다룬 호가 아직 없습니다.</li>`;
}

async function main() {
  const app = document.getElementById("app");
  try {
    const [index, gloss, market, weekly] = await Promise.all([
      getJSON("data/index.json"), getJSON("data/glossary.json").catch(() => ({})), getJSON("data/market.json").catch(() => null),
      getJSON("data/weekly/index.json").catch(() => ({}))
    ]);
    GLOSS = gloss; INDEX = index.issues || []; WEEKLY = weekly.weeklies || [];
    const nav = document.getElementById("nav-weekly");
    if (nav && WEEKLY.length) nav.hidden = false;
    CW = Math.round(Math.max(320, Math.min(640, app.clientWidth)));
    const q = new URLSearchParams(location.search);
    if (q.has("w") && WEEKLY.length) {
      // 위클리 화면: 매일 호 전용 메뉴(#lead 등)는 최신 호로 보낸다
      document.querySelectorAll('.mast nav a[href^="#"]').forEach(a => { if (a.getAttribute("href") !== "#archive") a.href = "./" + a.getAttribute("href"); });
      const wp = WEEKLY.find(x => x.id === q.get("w")) || WEEKLY[0];
      const wd = await getJSON(`data/weekly/${wp.id}.json`);
      const wi = WEEKLY.indexOf(wp); // 최신순
      CURRENT = "w=" + wp.id;
      app.innerHTML = renderWeekly(wd, WEEKLY[wi + 1], WEEKLY[wi - 1], INDEX);
      renderArchive(CURRENT);
      if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
      return;
    }
    const want = q.get("d");
    const pick = INDEX.find(e => e.date === want) || INDEX[0];
    if (!pick) { app.innerHTML = `<p class="loading">아직 발행된 호가 없습니다.</p>`; return; }
    const issue = await getJSON(`data/issues/${pick.date}.json`);
    const at = INDEX.indexOf(pick); // INDEX는 최신순
    CURRENT = "d=" + pick.date;
    app.innerHTML = renderIssue(issue, pick === INDEX[0] ? market : null, INDEX[at + 1], INDEX[at - 1]);
    renderArchive(CURRENT);
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  } catch (e) {
    app.innerHTML = `<p class="loading">브리프를 불러오지 못했습니다. 잠시 후 새로고침해 주세요. (${esc(e.message)})</p>`;
  }
}

/* ---------- 글꼴 모드 (Plex / 산돌) ---------- */
const PRETENDARD = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";
function setFont(f) {
  const root = document.documentElement;
  if (f === "sandol") {
    root.dataset.font = "sandol";
    if (!document.getElementById("pretendard")) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.id = "pretendard"; l.href = PRETENDARD;
      document.head.appendChild(l);
    }
  } else {
    delete root.dataset.font;
  }
  document.querySelectorAll(".fontswitch button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.font === f)));
  try { localStorage.setItem("jtm-font", f); } catch (e) { /* 저장이 막혀도 이번 화면에는 적용된다 */ }
}
setFont(document.documentElement.dataset.font === "sandol" ? "sandol" : "plex");

/* ---------- 화면 모드 (라이트 / 다크) ---------- */
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light")) === "dark";
function syncThemeButton() {
  const b = document.getElementById("theme-toggle"), dark = isDark();
  b.setAttribute("aria-label", dark ? "라이트 모드로 바꾸기" : "다크 모드로 바꾸기");
  b.title = b.getAttribute("aria-label");
  b.dataset.mode = dark ? "dark" : "light";
}
function toggleTheme() {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("jtm-theme", next); } catch (e) { /* 저장이 막혀도 이번 화면에는 적용된다 */ }
  syncThemeButton();
}
darkQuery.addEventListener("change", syncThemeButton);
syncThemeButton();

document.addEventListener("click", e => {
  if (e.target.closest("#theme-toggle")) { toggleTheme(); return; }
  const sb = e.target.closest("[data-share]");
  if (sb) { share(sb); return; }
  const fb = e.target.closest(".fontswitch button");
  if (fb) { setFont(fb.dataset.font); return; }
  const b = e.target.closest("[data-f]");
  if (b) { FILTER = b.dataset.f; renderArchive(CURRENT); }
});
const tip = document.getElementById("tip");
document.addEventListener("pointerover", e => {
  const m = e.target.closest("[data-tip]");
  if (!m) { tip.hidden = true; return; }
  tip.textContent = m.dataset.tip; tip.hidden = false;
});
document.addEventListener("pointermove", e => {
  if (tip.hidden) return;
  tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + "px";
  tip.style.top = (e.clientY + 14) + "px";
});
main();
