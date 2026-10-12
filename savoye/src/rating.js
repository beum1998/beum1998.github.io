// ─────────────────────────────────────────────────────────────────────────────
// 요약 평가 (Evaluation harness)
//
// AI 요약이 맞았는지 사람이 바로 채점하고, 그 기록을 CSV 로 모아 내보낸다.
// 논문의 검증 절에서 쓰는 데이터가 여기서 나온다.
//
//   정확 — 숫자와 서술이 모두 맞다
//   부분 — 틀리진 않았지만 빠졌거나 모호하다
//   오류 — 사실과 다른 서술이 있다
//
// 평가는 요약과 같은 자리(핀 카드 · 이력 화면 · 녹음 카드)에 붙고,
// 브라우저에 남으므로 다시 열어도 유지된다. 내보낸 CSV 는 Excel 에서 바로 열린다.
// ─────────────────────────────────────────────────────────────────────────────

import { store, escapeHtml } from "./store.js";
import { icon } from "./icons.js";
import { textOf } from "./sanitize.js";

const STORAGE = "abl_summary_ratings";

// 판정마다 역할 색 — 정확 = 추가(초록), 부분 = 수정(주황), 오류 = 삭제(빨강)
export const VERDICT_TONE = { accurate: "tone-add", partial: "tone-mod", wrong: "tone-del" };

export const VERDICTS = [
    { id: "accurate", label: "정확", tip: "숫자와 서술이 모두 맞아요" },
    { id: "partial", label: "부분", tip: "틀리진 않았지만 빠졌거나 모호해요" },
    { id: "wrong", label: "오류", tip: "사실과 다른 서술이 있어요" },
];

function all() {
    try { return JSON.parse(localStorage.getItem(STORAGE) || "{}"); } catch { return {}; }
}
function writeAll(map) {
    try { localStorage.setItem(STORAGE, JSON.stringify(map)); } catch { }
}
const keyOf = (kind, id) => `${kind}:${id}`;

export function getRating(kind, id) {
    return all()[keyOf(kind, id)] || null;
}

export function saveRating(kind, id, patch) {
    const map = all();
    const key = keyOf(kind, id);
    map[key] = { ...(map[key] || {}), ...patch, kind, id, at: Date.now() };
    writeAll(map);
    return map[key];
}

export function clearRating(kind, id) {
    const map = all();
    delete map[keyOf(kind, id)];
    writeAll(map);
}

export function allRatings() { return all(); }

export function ratingStats() {
    const rows = Object.values(all()).filter((r) => r.verdict);
    const by = { accurate: 0, partial: 0, wrong: 0 };
    for (const r of rows) if (by[r.verdict] !== undefined) by[r.verdict]++;
    return { total: rows.length, ...by };
}

/** 백업/복원용 — 통째로 넣고 뺀다. */
export function importRatings(map) {
    if (!map || typeof map !== "object") return 0;
    const cur = all();
    let n = 0;
    for (const [k, v] of Object.entries(map)) {
        if (!cur[k] || (v?.at || 0) > (cur[k].at || 0)) { cur[k] = v; n++; }
    }
    writeAll(cur);
    return n;
}

// ── 평가 UI ─────────────────────────────────────────────────────────────────
/**
 * 요약 블록 안에 평가 줄을 붙인다.
 * meta 는 CSV 로 나갈 때 함께 적히는 맥락(제목 · 시각 · 모델 · 구간 · 요약 본문).
 */
export function mountRating(host, { kind, id, meta = {} }) {
    if (!host) return;
    const cur = getRating(kind, id) || {};
    // 평가할 때 필요한 맥락은 평가 시점에 한 번 적어 둔다(나중에 요약이 바뀌어도 기록은 남게)
    host.dataset.ratingKey = keyOf(kind, id);
    host.innerHTML = render(cur);

    host.onclick = (e) => {
        const btn = e.target.closest("[data-rate]");
        if (btn) {
            e.stopPropagation();
            const verdict = btn.dataset.rate;
            const next = verdict === cur.verdict ? null : verdict;
            if (next) saveRating(kind, id, { verdict: next, meta });
            else saveRating(kind, id, { verdict: null });
            mountRating(host, { kind, id, meta });
            return;
        }
        if (e.target.closest("[data-rate-note]")) {
            e.stopPropagation();
            const box = host.querySelector(".rate__note");
            if (box) {
                box.hidden = !box.hidden;
                if (!box.hidden) box.querySelector("textarea")?.focus();
            }
        }
    };

    host.oninput = (e) => {
        if (!e.target.matches(".rate__note textarea")) return;
        saveRating(kind, id, { comment: e.target.value, meta });
    };

    function render(r) {
        const chips = VERDICTS.map((v) => `
            <button class="rate__btn chip chip--sm ${VERDICT_TONE[v.id] || ""} rate__btn--${v.id}${r.verdict === v.id ? " is-on" : ""}" type="button"
                    data-rate="${v.id}" title="${v.tip}">${v.label}</button>`).join("");
        const hasNote = Boolean(r.comment);
        return `
            <div class="rate__row">
                <span class="rate__label">${icon("check", 12)}이 요약, 맞았나요?</span>
                ${chips}
                <button class="rate__note-btn btn btn--ghost btn--xs tone-neutral${hasNote ? " is-on" : ""}" type="button" data-rate-note
                        title="평가 메모">${icon("edit", 12)}메모</button>
            </div>
            <div class="rate__note"${hasNote ? "" : " hidden"}>
                <textarea class="field field--block" rows="2" placeholder="무엇이 틀렸는지 / 무엇이 빠졌는지 적어두면 CSV 로 함께 나가요">${escapeHtml(r.comment || "")}</textarea>
            </div>`;
    }
}

// ── 내보내기 ────────────────────────────────────────────────────────────────
const CSV_HEADER = [
    "kind", "target_id", "title", "timestamp", "range_from", "range_to",
    "model", "summarized_at", "verdict", "rated_at", "comment",
    "numbers_matched", "numbers_unverified", "numbers_mismatched", "summary_text",
];

export function ratingsCsv() {
    const rows = Object.values(all())
        .filter((r) => r.verdict || r.comment)
        .sort((a, b) => (a.meta?.timestamp || "").localeCompare(b.meta?.timestamp || ""));

    const lines = [CSV_HEADER.join(",")];
    for (const r of rows) {
        const m = r.meta || {};
        lines.push([
            r.kind, r.id, m.title, m.timestamp, m.from, m.to,
            m.model, m.summarizedAt ? new Date(m.summarizedAt).toISOString() : "",
            r.verdict || "", r.at ? new Date(r.at).toISOString() : "",
            r.comment || "",
            m.check?.ok ?? "", m.check?.unv ?? "", m.check?.bad ?? "",
            m.summary || "",
        ].map(csvCell).join(","));
    }
    return lines.join("\r\n");
}

function csvCell(v) {
    const s = v === undefined || v === null ? "" : String(v).replace(/\r?\n/g, " ");
    return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadRatings() {
    const rows = Object.values(all()).filter((r) => r.verdict || r.comment);
    if (!rows.length) return 0;
    // BOM 을 붙여야 Excel 이 한글을 깨지 않고 연다
    download("﻿" + ratingsCsv(), `abl_summary_ratings_${stamp()}.csv`, "text/csv;charset=utf-8");
    return rows.length;
}

export function download(text, filename, type = "text/plain;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 요약 HTML 에서 CSV 에 넣을 평문만 뽑는다. */
export function plainText(html) {
    // 실행되지 않는 문서에서 읽는다(일반 div 에 넣으면 <img onerror> 가 실행될 수 있다)
    return textOf(html || "");
}

/** 프로젝트 이름(문서명) — 파일 이름과 보고서 제목에 쓴다. */
export function projectName() {
    return (store.docTitle || "Augmented BIM Log").replace(/[\\/:*?"<>|]/g, "_");
}
