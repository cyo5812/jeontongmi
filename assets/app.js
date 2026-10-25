// 전.통.미. renderer: data/index.json → data/issues/<date>.json, data/market.json, data/glossary.json
const AXES = ["전자", "통신", "미디어"];
let GLOSS = {};
let CW = 640; // 차트 폭: 화면 폭에 맞춰 그려서 모바일에서도 글자가 줄어들지 않게 한다

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// [[key|표시어]] → 용어 툴팁
const rich = s => esc(s).replace(/\[\[([a-z0-9_-]+)\|([^\]]+)\]\]/g, (m, k, t) =>
  GLOSS[k] ? `<span class="term" tabindex="0" data-def="${esc(GLOSS[k])}">${t}</span>` : t);
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

/* ---------- sections ---------- */
function brief(b, id) {
  return `<article class="brief" id="${id}">
    ${chips(b)}
    <h3>${esc(b.title)}</h3>
    <p>${rich(b.body)}</p>
    ${b.why ? `<p class="why"><b>왜 중요한가</b>${rich(b.why)}</p>` : ""}
    ${b.krline ? `<div class="krline"><b>한국 시사점</b><span>${rich(b.krline)}</span></div>` : ""}
    ${srcs(b.src)}
  </article>`;
}

function section(id, title, sub, items, prefix) {
  if (!items || !items.length) return "";
  return `<section id="${id}"><div class="section-head"><h2>${title}</h2><p>${sub}</p></div>${items.map((b, i) => brief(b, prefix + i)).join("")}</section>`;
}

function marketPanel(m) {
  if (!m || !m.updated) return "";
  let h = `<div class="market"><h3>시장 · 데이터</h3>`;
  (m.groups || []).forEach(g => {
    h += `<table><caption>${esc(g.name)}</caption><tbody>${g.rows.map(r => {
      const c = Number(r.chg), cls = c > 0 ? "up" : c < 0 ? "down" : "";
      return `<tr><td>${esc(r.name)}</td><td>${fmt(r.close, r.cur === "USD" ? 2 : 0)}</td><td class="${cls}">${c > 0 ? "+" : ""}${c.toFixed(2)}%</td></tr>`;
    }).join("")}</tbody></table>`;
  });
  if (m.boxoffice && m.boxoffice.items && m.boxoffice.items.length) {
    h += `<table><caption>박스오피스 · ${esc(m.boxoffice.date)}</caption><tbody>${m.boxoffice.items.slice(0, 5).map(b => `<tr><td>${esc(b.rank)}. ${esc(b.name)}</td><td>${fmt(b.audi)}</td><td>누적 ${fmt(Math.round(b.acc / 10000))}만</td></tr>`).join("")}</tbody></table>`;
  }
  if (m.disclosures && m.disclosures.length) {
    h += `<table><caption>주요 공시</caption><tbody>${m.disclosures.slice(0, 6).map(d => `<tr><td colspan="3"><a href="${safeUrl(d.url)}" target="_blank" rel="noopener">${esc(d.corp)} · ${esc(d.title)}</a></td></tr>`).join("")}</tbody></table>`;
  }
  return h + `<p class="stamp">${esc(m.updated)} 기준 · 자동 수집</p></div>`;
}

function renderIssue(d, market) {
  const L = d.lead;
  const toc = [["LEAD", "#lead", L.title]]
    .concat((d.kr || []).map((b, i) => ["국내", "#k" + i, b.title]))
    .concat((d.global || []).map((b, i) => ["GLOBAL", "#g" + i, b.title]));
  const dt = d.date.replaceAll("-", ".");
  document.title = `전.통.미. · ${dt}`;
  return `
  <div class="edition">
    <h1>${esc(d.headline)}</h1>
    <div class="meta"><span class="num">${dt} (${esc(d.weekday)})</span><span>${d.label ? esc(d.label) + " " : ""}${esc(d.vol)}호</span><span>${esc(d.readMin)}분 읽기</span></div>
  </div>
  ${d.note ? `<p class="issue-note">${esc(d.note)}</p>` : ""}

  <section class="brief60" aria-label="60초 브리핑">
    <div class="label">60초 브리핑</div>
    <div>
      <ol>${d.brief60.map(t => `<li><span>${rich(t)}</span></li>`).join("")}</ol>
      ${d.lens ? `<p class="lens"><b>오늘의 관점</b>${rich(d.lens)}</p>` : ""}
    </div>
  </section>

  <div class="layout">
    <div>
      <article class="lead" id="lead">
        <div class="section-head"><h2>리드 스토리</h2><p>오늘 가장 깊게 볼 이슈</p></div>
        ${chips(L)}
        <h3>${esc(L.title)}</h3>
        <p class="dek">${rich(L.dek)}</p>
        <h4><span class="label">FACT</span>무슨 일이 있나</h4>
        <ul>${L.what.map(t => `<li>${rich(t)}</li>`).join("")}</ul>
        ${figure(L.figure, true)}
        <h4><span class="label">WHY</span>왜 중요한가</h4>
        <p>${rich(L.why)}</p>
        ${L.planner && L.planner.length ? `<div class="planner"><span class="label">내가 전략기획자라면</span><ol>${L.planner.map(([a, b]) => `<li><b>${esc(a)}</b><span>${rich(b)}</span></li>`).join("")}</ol></div>` : ""}
        <h4><span class="label">WATCH</span>지켜볼 것</h4>
        <p>${rich(L.watch)}</p>
        ${srcs(L.src)}
      </article>
      ${section("kr", "국내 브리핑", `${(d.kr || []).length}건`, d.kr, "k")}
      ${section("global", "글로벌 브리핑", `${(d.global || []).length}건 · 모두 한국 시사점 포함`, d.global, "g")}
      ${d.figures && d.figures.length ? `<section id="numbers"><div class="section-head"><h2>숫자로 보는 산업</h2><p>오늘 기사 속 수치를 한눈에</p></div>${d.figures.map(f => figure(f)).join("")}</section>` : ""}
    </div>
    <aside class="rail">
      <nav class="toc" aria-label="이번 호 목차">${toc.map(([k, h, t]) => `<a href="${h}"><span>${k}</span>${esc(t)}</a>`).join("")}</nav>
      ${marketPanel(market)}
      ${d.calendar && d.calendar.length ? `<div class="cal"><h3>다가오는 일정</h3><ul>${d.calendar.map(([w, t, n]) => `<li><span class="num">${esc(w)}</span><span>${esc(t)}${n ? `<em>${esc(n)}</em>` : ""}</span></li>`).join("")}</ul></div>` : ""}
      <div class="gloss"><h3>용어 도움말</h3><p>점선 밑줄이 있는 용어에 마우스를 올리거나 탭하면 설명이 나옵니다.</p></div>
    </aside>
  </div>`;
}

/* ---------- archive ---------- */
let INDEX = [], FILTER = "전체";
function renderArchive(current) {
  const list = INDEX.filter(e => FILTER === "전체" || (e.axis || []).includes(FILTER));
  document.getElementById("archive-filters").innerHTML = ["전체"].concat(AXES).map(a =>
    `<button type="button" id="f-${a}" aria-pressed="${a === FILTER}" data-f="${a}">${a}</button>`).join("");
  document.getElementById("archive-list").innerHTML = list.length ? list.map(e => `
    <li><a href="?d=${esc(e.date)}"${e.date === current ? ' aria-current="page"' : ""}>
      <span class="num">${esc(e.date.replaceAll("-", "."))}</span>
      <span><h3>${esc(e.headline)}</h3><p>${esc((e.titles || []).slice(0, 3).join(" · "))}</p></span>
    </a></li>`).join("") : `<li class="empty">이 분야를 다룬 호가 아직 없습니다.</li>`;
}

async function main() {
  const app = document.getElementById("app");
  try {
    const [index, gloss, market] = await Promise.all([
      getJSON("data/index.json"), getJSON("data/glossary.json").catch(() => ({})), getJSON("data/market.json").catch(() => null)
    ]);
    GLOSS = gloss; INDEX = index.issues || [];
    const want = new URLSearchParams(location.search).get("d");
    const pick = INDEX.find(e => e.date === want) || INDEX[0];
    if (!pick) { app.innerHTML = `<p class="loading">아직 발행된 호가 없습니다.</p>`; return; }
    const issue = await getJSON(`data/issues/${pick.date}.json`);
    CW = Math.round(Math.max(320, Math.min(640, app.clientWidth)));
    app.innerHTML = renderIssue(issue, pick === INDEX[0] ? market : null);
    renderArchive(pick.date);
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  } catch (e) {
    app.innerHTML = `<p class="loading">브리프를 불러오지 못했습니다. 잠시 후 새로고침해 주세요. (${esc(e.message)})</p>`;
  }
}

document.addEventListener("click", e => {
  const b = e.target.closest("[data-f]");
  if (b) { FILTER = b.dataset.f; renderArchive(new URLSearchParams(location.search).get("d")); }
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
