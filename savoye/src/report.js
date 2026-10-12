// ─────────────────────────────────────────────────────────────────────────────
// 내보내기 (Report · Backup)
//
//   · 이력 보고서 — 핀 + 그 시점 사진 + 변화 + AI 요약 + 평가를 한 장의 HTML 로.
//     파일 하나만 있으면 어디서나 열리고, 브라우저 인쇄(Ctrl+P) → PDF 로 바로 굳는다.
//   · 백업 — 뷰어에서 만든 것(회고 핀 · 수정 · 요약 · 평가 · 전사)을 json 하나로 묶고 되돌린다.
//     브라우저 저장소는 캐시를 지우면 날아가므로, 중요한 작업 뒤에는 백업을 권한다.
//     API 키는 백업에 넣지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

import { store, catInfo, levelOf, formatKey, escapeHtml } from "./store.js";
import { captureViews, DEFAULT_DIR } from "./shoot.js";
import { getPinSummary, getProjectSummary, sectionize } from "./aiSummary.js";
import { getRating, allRatings, importRatings, download, stamp, plainText, projectName, VERDICTS } from "./rating.js";
import { pinFacts, statsHtml } from "./pinView.js";
import { safeHtml } from "./sanitize.js";
import { analyzeRework } from "./rework.js";

const SHOT = { w: 520, h: 360 };

// 백업에 담는 항목 — API 키(openai_api_key)는 일부러 뺀다
const BACKUP_KEYS = [
    "abl_viewer_pins",
    "abl_hidden_pins",
    "abl_pin_edits",
    "abl_pin_summaries",
    "abl_summary_ratings",
    "abl_project_summary",
    "abl_briefing_summary",
    "abl_last_seen",
    "abl_rec_transcripts",
    "abl_ai_model",
    "abl_ai_stt_model",
];

// ── 이력 보고서 ──────────────────────────────────────────────────────────────
export function buildHistoryReport() {
    const now = new Date();
    const project = store.docTitle || "Augmented BIM Log";
    const proj = getProjectSummary();

    const sections = store.pins.map((pin, i) => {
        const facts = pinFacts(pin);
        const prev = facts.prev;
        const diff = facts.diff;
        const shot = captureViews({ index: pin.index, dirs: [DEFAULT_DIR], size: SHOT, quality: 0.72 })[0];
        const f = formatKey(pin.ts);
        const summary = getPinSummary(pin.id);
        const rating = getRating("pin", pin.id);
        const rows = levelCategoryRows(diff).slice(0, 12);

        return `
        <section class="pin">
            <div class="pin__shot">${shot ? `<img src="${shot}" alt="">` : `<div class="pin__noshot">사진 없음</div>`}</div>
            <div class="pin__body">
                <div class="pin__meta">
                    <span class="n">${i + 1}</span>
                    ${pin.stage ? `<span class="stage">${escapeHtml(pin.stage)}</span>` : ""}
                    ${pin.source === "viewer" ? `<span class="tag">회고</span>` : ""}
                    <time>${f.date} ${f.time}</time>
                </div>
                <h2>${escapeHtml(pin.title)}</h2>
                ${pin.note ? `<p class="note">${escapeHtml(pin.note)}</p>` : ""}
                <p class="counts">
                    <b>${prev ? "이전 핀 대비" : "처음부터"}</b>
                    추가 <b class="add">${diff.addedIds.length}</b> ·
                    삭제 <b class="del">${diff.deletedIds.length}</b> ·
                    수정 <b class="mod">${diff.modified.after.length}</b>
                </p>
                ${statsHtml(facts)}
                ${rows.length ? `
                <table class="rows">
                    <thead><tr><th>층</th><th>카테고리</th><th>추가</th><th>삭제</th><th>수정</th></tr></thead>
                    <tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.level)}</td><td>${escapeHtml(r.cat)}</td><td>${r.added || ""}</td><td>${r.deleted || ""}</td><td>${r.modified || ""}</td></tr>`).join("")}</tbody>
                </table>` : `<p class="muted">변화 없음</p>`}
                ${modsBlock(facts.mods)}
                ${summary ? `
                <div class="ai">
                    <div class="ai__head">AI 요약 <span>${escapeHtml(summary.model || "")}</span></div>
                    <div class="ai__body">${sectionize(safeHtml(summary.html))}</div>
                    ${rating?.verdict ? `<div class="ai__rate">평가: <b>${verdictLabel(rating.verdict)}</b>${rating.comment ? ` — ${escapeHtml(rating.comment)}` : ""}</div>` : ""}
                </div>` : ""}
            </div>
        </section>`;
    }).join("");

    return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${escapeHtml(project)} — 작업 이력</title>
<style>
  .mods { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: #fcfcfd; }
  .mods__head { font-size: 12px; font-weight: 700; } .mods__head span { font-weight: 500; color: var(--sub); margin-left: 6px; }
  .mods__chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0 4px; } .mods__chips span { padding: 1px 8px; border-radius: 999px; background: #fff4e5; color: #8a4b08; font-size: 12px; }
  .mods ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--sub); } .mods li { margin: 2px 0; }
  :root { --ink:#101828; --sub:#475467; --line:#e4e7ec; --pin:#7c5cff; --add:#16a34a; --del:#dc2626; --mod:#d97706; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px; background:#f8f9fc; color:var(--ink);
         font:14px/1.6 -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; }
  .wrap { max-width: 880px; margin: 0 auto; }
  header { border-bottom:2px solid var(--ink); padding-bottom:14px; margin-bottom:22px; }
  header h1 { margin:0 0 4px; font-size:22px; letter-spacing:-.02em; }
  header .sub { color:var(--sub); font-size:12.5px; }
  .proj { background:#fff; border:1px solid var(--line); border-left:3px solid var(--pin);
          border-radius:10px; padding:14px 16px; margin-bottom:22px; }
  .proj h3 { margin:0 0 6px; font-size:13px; color:var(--pin); letter-spacing:.02em; }
  .pin { display:grid; grid-template-columns: 240px 1fr; gap:16px; background:#fff;
         border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:14px;
         break-inside: avoid; page-break-inside: avoid; }
  .pin__shot img { width:100%; border-radius:8px; background:#eef1f6; display:block; }
  .pin__noshot { height:150px; display:grid; place-items:center; color:#98a2b3; background:#eef1f6; border-radius:8px; font-size:12px; }
  .pin__meta { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--sub); }
  .pin__meta .n { width:20px; height:20px; border-radius:50%; background:var(--pin); color:#fff;
                  display:grid; place-items:center; font-size:11px; font-weight:700; }
  .pin__meta .stage { background:#f0ecff; color:#5536d6; padding:2px 8px; border-radius:999px; font-weight:600; }
  .pin__meta .tag { background:#f2f4f7; color:var(--sub); padding:2px 8px; border-radius:999px; }
  .pin__meta time { margin-left:auto; font-family: ui-monospace, Consolas, monospace; }
  .pin h2 { margin:6px 0 2px; font-size:16px; letter-spacing:-.01em; }
  .note { margin:2px 0 8px; color:var(--sub); white-space:pre-wrap; }
  .counts { margin:6px 0; font-size:12.5px; color:var(--sub); }
  .counts .add { color:var(--add); } .counts .del { color:var(--del); } .counts .mod { color:var(--mod); }
  table.rows { width:100%; border-collapse:collapse; font-size:12px; margin:6px 0 0; }
  table.rows th, table.rows td { border-bottom:1px solid var(--line); padding:4px 6px; text-align:left; }
  table.rows th { color:var(--sub); font-weight:600; background:#fafbfd; }
  table.rows td:nth-child(n+3) { text-align:right; font-family: ui-monospace, Consolas, monospace; }
  .muted { color:#98a2b3; font-size:12.5px; }
  .ai { margin-top:10px; padding:10px 12px; background:#fbfaff; border:1px solid #ece8ff; border-radius:8px; }
  .ai__head { font-size:11.5px; font-weight:700; color:var(--pin); margin-bottom:4px; }
  .ai__head span { font-weight:500; color:var(--sub); font-family: ui-monospace, Consolas, monospace; }
  .ai__body { font-size:13px; }
  .aisec { margin-top:8px; padding:7px 10px 8px; border-left:3px solid var(--line); border-radius:6px; background:#f8f9fc; }
  .aisec__head { display:flex; align-items:center; gap:6px; margin-bottom:3px; }
  .aisec__tag { padding:0 7px; border-radius:999px; font-size:11px; font-weight:700; }
  .aisec__title { font-size:12px; font-weight:700; color:var(--sub); }
  .aisec--obs { border-left-color:#2563eb; } .aisec--obs .aisec__tag { background:#e9f0fe; color:#1d4ed8; }
  .aisec--spa { border-left-color:#0d9488; } .aisec--spa .aisec__tag { background:#e3f5f2; color:#0f766e; }
  .aisec--inf { border-left-color:var(--pin); background:#f7f5ff; } .aisec--inf .aisec__tag { background:#ece7ff; color:#5536d6; }
  .ai__rate { margin-top:6px; font-size:12px; color:var(--sub); border-top:1px dashed #ece8ff; padding-top:6px; }
  .kpis { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; margin-bottom:18px; }
  .kpis .k { background:#fff; border:1px solid var(--line); border-radius:10px; padding:9px 11px; }
  .kpis .k span { display:block; font-size:11.5px; color:var(--sub); }
  .kpis .k b { display:block; font-size:19px; letter-spacing:-.02em; margin-top:1px; }
  .kpis .k em { display:block; font-style:normal; font-size:11px; color:#667085; }
  .pinx-stats { display:flex; flex-wrap:wrap; gap:5px; margin:4px 0 6px; }
  .pinx-stat { display:inline-flex; align-items:center; gap:5px; padding:2px 8px; border-radius:999px; background:#f2f4f7; font-size:11.5px; color:var(--sub); }
  .pinx-stat b { color:var(--ink); }
  .pinx-stat em { font-style:normal; color:#667085; }
  .pinx-stat svg { color:#667085; }
  footer { margin-top:20px; padding-top:12px; border-top:1px solid var(--line); color:#98a2b3; font-size:11.5px; }
  @media print { body { background:#fff; padding:0; } .pin { border-color:#d0d5dd; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(project)} — 작업 이력</h1>
    <div class="sub">핀 ${store.pins.length}개 · 기록 시점 ${store.timeKeys.length}개 ·
      ${store.timeKeys.length ? `${formatKey(store.timeKeys[0]).date} ~ ${formatKey(store.timeKeys[store.timeKeys.length - 1]).date}` : ""}
      · 내보낸 시각 ${now.toLocaleString("ko-KR")}</div>
  </header>
  ${reworkBox()}
  ${proj ? `<div class="proj"><h3>프로젝트 진행 (AI 서술 · ${escapeHtml(proj.model || "")})</h3><div>${sectionize(safeHtml(proj.html))}</div></div>` : ""}
  ${sections || `<p class="muted">핀이 없습니다.</p>`}
  <footer>Augmented BIM Log — Revit 작업 로그에서 자동 생성된 보고서입니다. 숫자는 로그에서 계산된 값이며, AI 요약은 해석입니다.</footer>
</div>
</body>
</html>`;
}

/** 보고서 머리의 재작업 지표 — 분석 화면과 같은 값 */
/** 수정 내용 — 항목별 요소 수와 예시 문장 몇 개 */
function modsBlock(m) {
    if (!m || !m.total) return "";
    const groups = m.groups.slice(0, 8);
    return `
                <div class="mods">
                    <div class="mods__head">수정 내용 <span>${m.total}개 중 값 변경 ${m.changed} · 결과값만 ${m.derivedOnly} · 함께 갱신 ${m.quiet}</span></div>
                    ${groups.length ? `<p class="mods__chips">${groups.map((g) => `<span>${escapeHtml(g.group)} <b>${g.count}</b></span>`).join("")}</p>` : ""}
                    ${m.lines.length ? `<ul>${m.lines.slice(0, 6).map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` : ""}
                </div>`;
}

function reworkBox() {
    if (!store.timeKeys.length) return "";
    const t = analyzeRework().totals;
    const cell = (label, value, sub) => `<div class="k"><span>${label}</span><b>${value}</b><em>${sub}</em></div>`;
    return `<div class="kpis">
        ${cell("생성된 요소", t.created, "한 번이라도 있었던 요소")}
        ${cell("최종 요소", t.final, "마지막 시점")}
        ${cell("폐기율", (t.discardRate * 100).toFixed(1) + "%", `${t.discarded}개가 남지 못함`)}
        ${cell("헛수고 편집", (t.wastedRatio * 100).toFixed(1) + "%", `편집 ${t.edits}회 중 ${t.wastedEdits}회`)}
        ${cell("요소당 평균 수정", t.meanModsAlive.toFixed(1) + "회", "남은 요소 기준")}
    </div>`;
}

function verdictLabel(id) {
    return VERDICTS.find((v) => v.id === id)?.label || id;
}

/** 이력 화면과 같은 방식의 층 × 카테고리 집계 */
function levelCategoryRows(diff) {
    const map = new Map();
    const bump = (id, kind) => {
        const g = store.meshDict[id];
        if (!g) return;
        const level = levelOf(g.userData).name;
        const cat = catInfo(g.userData?.Common?.ElementCategory).label;
        const key = `${level}|${cat}`;
        if (!map.has(key)) map.set(key, { level, cat, added: 0, deleted: 0, modified: 0 });
        map.get(key)[kind]++;
    };
    diff.addedIds.forEach((id) => bump(id, "added"));
    diff.deletedIds.forEach((id) => bump(id, "deleted"));
    diff.modified.after.forEach((id) => bump(id, "modified"));
    return [...map.values()].sort((a, b) =>
        (b.added + b.deleted + b.modified) - (a.added + a.deleted + a.modified));
}

export function downloadHistoryReport() {
    const html = buildHistoryReport();
    download(html, `${projectName()}_이력보고서_${stamp()}.html`, "text/html;charset=utf-8");
    return html.length;
}

// ── 백업 · 복원 ─────────────────────────────────────────────────────────────
export function buildBackup() {
    const data = { app: "AugmentedBIMLog", version: 1, at: new Date().toISOString(), store: {} };
    for (const key of BACKUP_KEYS) {
        try {
            const raw = localStorage.getItem(key);
            if (raw !== null) data.store[key] = JSON.parse(raw);
        } catch { }
    }
    // 지운(숨긴) 핀 목록은 "비어 있음"도 뜻이 있다 — 없으면 복원할 때 지금 지운 핀이 그대로 숨겨진다
    if (!Array.isArray(data.store.abl_hidden_pins)) data.store.abl_hidden_pins = [];
    return data;
}

export function downloadBackup() {
    const data = buildBackup();
    download(JSON.stringify(data, null, 2), `${projectName()}_백업_${stamp()}.json`, "application/json");
    return Object.keys(data.store).length;
}

/**
 * 백업을 되돌린다. 지금 것을 지우지 않고 **합친다**(같은 항목은 최신 것을 남긴다).
 * 돌려주는 값은 항목별로 새로 들어온 개수.
 */
export function restoreBackup(json) {
    if (!json || json.app !== "AugmentedBIMLog" || !json.store) throw new Error("이 파일은 Augmented BIM Log 백업이 아니에요.");
    const s = json.store;
    const result = { pins: 0, summaries: 0, ratings: 0, transcripts: 0, hidden: 0, edits: 0, project: false };

    result.pins = mergeArrayById("abl_viewer_pins", s.abl_viewer_pins, (p) => p.Id || p.Timestamp);
    // 숨김(삭제 표시)은 합치지 않고 백업 시점으로 되돌린다 — 복원했는데 지웠던 핀이 안 보이면 이상하니까.
    // 목록이 아예 없는 백업(= 그때는 지운 핀이 없었다)도 "비어 있음"으로 되돌린다.
    const hiddenBack = Array.isArray(s.abl_hidden_pins) ? s.abl_hidden_pins : [];
    writeLS("abl_hidden_pins", hiddenBack);
    result.hidden = hiddenBack.length;
    result.edits = mergeMap("abl_pin_edits", s.abl_pin_edits);
    result.summaries = mergeMap("abl_pin_summaries", s.abl_pin_summaries, (a, b) => (b?.at || 0) > (a?.at || 0));
    result.ratings = importRatings(s.abl_summary_ratings);
    result.transcripts = mergeMap("abl_rec_transcripts", s.abl_rec_transcripts);
    // 마지막 확인은 프로젝트마다 더 최근 것을, 브리핑은 더 최근에 만든 것을 남긴다
    result.lastSeen = mergeMap("abl_last_seen", s.abl_last_seen, (a, b) => (b?.at || 0) > (a?.at || 0));
    if (s.abl_briefing_summary) {
        let cur = null;
        try { cur = JSON.parse(localStorage.getItem("abl_briefing_summary") || "null"); } catch { }
        if (!cur || (s.abl_briefing_summary.at || 0) > (cur.at || 0)) {
            try { localStorage.setItem("abl_briefing_summary", JSON.stringify(s.abl_briefing_summary)); result.briefing = true; } catch { }
        }
    }

    if (s.abl_project_summary) {
        const cur = getProjectSummary();
        if (!cur || (s.abl_project_summary.at || 0) > (cur.at || 0)) {
            try { localStorage.setItem("abl_project_summary", JSON.stringify(s.abl_project_summary)); result.project = true; } catch { }
        }
    }
    return result;
}

export function readBackupFile(file) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error("파일을 읽지 못했어요."));
        fr.onload = () => {
            try { resolve(JSON.parse(String(fr.result))); }
            catch { reject(new Error("json 형식이 아니에요.")); }
        };
        fr.readAsText(file);
    });
}

function readLS(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v ?? fallback; } catch { return fallback; }
}
function writeLS(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
}

function mergeArrayById(key, incoming, idOf) {
    if (!Array.isArray(incoming)) return 0;
    const cur = readLS(key, []);
    const seen = new Set(cur.map(idOf));
    let n = 0;
    for (const item of incoming) {
        if (seen.has(idOf(item))) continue;
        cur.push(item);
        seen.add(idOf(item));
        n++;
    }
    writeLS(key, cur);
    return n;
}

function mergeStringSet(key, incoming) {
    if (!Array.isArray(incoming)) return 0;
    const cur = readLS(key, []);
    let n = 0;
    for (const v of incoming) if (!cur.includes(v)) { cur.push(v); n++; }
    writeLS(key, cur);
    return n;
}

function mergeMap(key, incoming, newer = () => true) {
    if (!incoming || typeof incoming !== "object") return 0;
    const cur = readLS(key, {});
    let n = 0;
    for (const [k, v] of Object.entries(incoming)) {
        if (!(k in cur) || newer(cur[k], v)) { cur[k] = v; n++; }
    }
    writeLS(key, cur);
    return n;
}

/** 평가 통계 한 줄 — 메뉴에 보여준다. */
export function ratingLine() {
    const rows = Object.values(allRatings()).filter((r) => r.verdict);
    if (!rows.length) return "아직 평가 없음";
    const by = { accurate: 0, partial: 0, wrong: 0 };
    for (const r of rows) by[r.verdict] = (by[r.verdict] || 0) + 1;
    return `${rows.length}건 · 정확 ${by.accurate} · 부분 ${by.partial} · 오류 ${by.wrong}`;
}

export { plainText };
