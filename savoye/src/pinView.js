// ─────────────────────────────────────────────────────────────────────────────
// 핀 보기 조각 (Pin view)
//
// 같은 핀을 핀 탭 · 이력 화면 · 보고서가 모두 같은 내용으로 보여주도록,
// "핀 하나에 대해 무엇을 말할지"를 한 곳에 모았다. 화면마다 밀도만 다르다.
//
//   1단 (항상)  단계 · 시각 · 제목 · 한 줄 변화 요약   예) +56 −1 ~0 · 1층 벽 15 · 기둥 11
//   2단 (펼침)  작업 시간 · 편집 · 되돌림 · 확정 · 녹음 + 층 × 카테고리 칩
//   3단 (요청)  AI 요약 → 근거 → 평가            (aiSummary.mountPinSummary)
//
// 숫자는 diffBetween(핀 사이 순변화)과 segmentRework(구간 안의 편집 흐름)에서만 온다.
// ─────────────────────────────────────────────────────────────────────────────

import { store, catInfo, levelOf, escapeHtml, onProjectReset } from "./store.js";
import { icon } from "./icons.js";
import { diffBetween } from "./aiSummary.js";
import { segmentRework } from "./rework.js";
import { summarizeModifications, catsText } from "./changeDiff.js";

const PATTERNS = 6;
import { captureViews, DEFAULT_DIR } from "./shoot.js";

const factsCache = new Map();
const thumbCache = new Map();

/** 핀 하나에 대한 사실들(캐시). */
export function pinFacts(pin) {
    const prev = prevOf(pin);
    const from = prev ? prev.index : 0;
    const key = `${pin.id}|${from}|${pin.index}|${store.timeKeys.length}|${store.recordings.length}`;
    const hit = factsCache.get(pin.id);
    if (hit && hit.key === key) return hit.facts;

    const diff = diffBetween(from, pin.index);
    const rows = levelCategoryRows(diff);
    const prevMs = prev ? prev.ms : store.keyMs[0];
    const facts = {
        prev,
        from,
        diff,
        added: diff.addedIds.length,
        deleted: diff.deletedIds.length,
        modified: diff.modified.after.length,
        total: diff.addedIds.length + diff.deletedIds.length + diff.modified.after.length,
        rows,
        topRows: [...rows].sort((a, b) => weight(b) - weight(a)),
        rework: segmentRework(from, pin.index),
        mods: summarizeModifications(diff),
        recs: store.recordings.filter((r) => r.startMs > prevMs && r.startMs <= pin.ms),
        gapMs: pin.ms - prevMs,
    };
    factsCache.set(pin.id, { key, facts });
    return facts;
}

/** 임의 구간(from → to)의 사실 — 브리핑처럼 핀에 묶이지 않은 구간용. pinFacts 와 같은 모양. */
export function rangeFacts(from, to) {
    const diff = diffBetween(from, to);
    const rows = levelCategoryRows(diff);
    const fromMs = store.keyMs[from] ?? 0, toMs = store.keyMs[to] ?? 0;
    return {
        prev: null,
        from,
        to,
        diff,
        added: diff.addedIds.length,
        deleted: diff.deletedIds.length,
        modified: diff.modified.after.length,
        total: diff.addedIds.length + diff.deletedIds.length + diff.modified.after.length,
        rows,
        topRows: [...rows].sort((a, b) => weight(b) - weight(a)),
        rework: segmentRework(from, to),
        mods: summarizeModifications(diff),
        recs: store.recordings.filter((r) => r.startMs > fromMs && r.startMs <= toMs),
        gapMs: toMs - fromMs,
    };
}

function prevOf(pin) {
    let hit = null;
    for (const p of store.pins) if (p.index < pin.index) hit = p;
    return hit;
}

function weight(r) { return r.added + r.deleted + r.modified; }

/** 층 × 카테고리 × 변화 유형 (위층 먼저, 카테고리 순) */
export function levelCategoryRows(diff) {
    const map = new Map();
    const bump = (id, kind) => {
        const g = store.meshDict[id];
        if (!g) return;
        const level = levelOf(g.userData);
        const cat = g.userData?.Common?.ElementCategory || "기타";
        const key = `${level.key}|${cat}`;
        if (!map.has(key)) map.set(key, { level, cat, added: 0, deleted: 0, modified: 0 });
        map.get(key)[kind]++;
    };
    diff.addedIds.forEach((id) => bump(id, "added"));
    diff.deletedIds.forEach((id) => bump(id, "deleted"));
    diff.modified.after.forEach((id) => bump(id, "modified"));

    const levelOrder = new Map(store.levels.map((lv, i) => [lv.key, i]));
    return [...map.values()].sort((a, b) => {
        const la = levelOrder.get(a.level.key) ?? 99;
        const lb = levelOrder.get(b.level.key) ?? 99;
        if (la !== lb) return lb - la;
        return catInfo(a.cat).order - catInfo(b.cat).order;
    });
}

// ── 1단: 한 줄 변화 요약 ─────────────────────────────────────────────────────
export function factsLine(f, { top = 2 } = {}) {
    if (!f.total) return `<div class="pinx-line pinx-line--none">모델 변화 없음</div>`;
    const counts = [
        f.added ? `<b class="is-add">+${f.added}</b>` : "",
        f.deleted ? `<b class="is-del">−${f.deleted}</b>` : "",
        f.modified ? `<b class="is-mod">~${f.modified}</b>` : "",
    ].filter(Boolean).join(" ");
    const parts = f.topRows.slice(0, top).map((r) =>
        `<span class="pinx-line__part"><i class="dot" style="--c:${catInfo(r.cat).color}"></i>${escapeHtml(shortLevel(r.level.name))} ${escapeHtml(catInfo(r.cat).label)} ${weight(r)}</span>`);
    const more = f.topRows.length > top ? `<span class="pinx-line__more">외 ${f.topRows.length - top}</span>` : "";
    return `<div class="pinx-line">${counts}${parts.length ? `<span class="pinx-line__sep">·</span>${parts.join("")}${more}` : ""}</div>`;
}

/** "03. First Floor" → "First Floor", "1층" 은 그대로 */
export function shortLevel(name) {
    return String(name || "").replace(/^\s*\d+\s*[.)]\s*/, "");
}

// ── 2단: 작업 흐름 수치 ──────────────────────────────────────────────────────
export function statsHtml(f) {
    const r = f.rework;
    const items = [
        stat("clock", fmtDuration(f.gapMs), r.activeMs ? `실작업 ${fmtDuration(r.activeMs)}` : "", "이전 핀부터 걸린 시간 · 10분 넘게 비운 시간을 뺀 실작업 시간"),
        stat("edit", `편집 ${r.edits.toLocaleString()}`, r.del ? `삭제 ${r.del}` : "", "구간 안에서 요소를 추가·수정한 횟수"),
        stat("refresh", `되돌림 ${r.reverted}`, r.revertedEdits ? `편집 ${r.revertedEdits}` : "", "구간 안에서 손댔지만 이 핀 시점에는 남지 않은 요소", r.reverted ? "warn" : ""),
        stat("check", `확정 ${r.settled}`, "", "마지막 편집이 이 구간이고, 끝까지 그대로 남은 요소"),
    ];
    if (f.recs.length) items.push(stat("mic", `녹음 ${f.recs.length}`, "", "이 구간에 녹음된 파일"));
    return `<div class="pinx-stats">${items.join("")}</div>`;
}

function stat(ic, main, sub, tip, tone = "") {
    return `<span class="pinx-stat tag tag--md${tone ? ` pinx-stat--${tone} tone-accent` : ""}" title="${escapeHtml(tip)}">${icon(ic, 12)}<b>${escapeHtml(main)}</b>${sub ? `<em>${escapeHtml(sub)}</em>` : ""}</span>`;
}

/**
 * 2단의 "수정 내용" — 항목별 요소 수 칩. interactive 면 칩을 눌러 예시 문장을 펼친다.
 * openGroup: 펼칠 항목 이름(핀 탭이 상태를 가진다)
 */
export function modsHtml(f, { interactive = false, openGroup = null, limit = 6 } = {}) {
    const m = f.mods;
    if (!m || !m.total) return "";
    const groups = m.groups.slice(0, limit);
    const rest = m.groups.length - groups.length;
    const chip = (g) => interactive
        ? `<button class="mchip chip chip--sm tone-mod${openGroup === g.group ? " is-on" : ""}" type="button" data-act="mod-group" data-group="${escapeHtml(g.group)}" aria-expanded="${openGroup === g.group}">${escapeHtml(g.group)}<b class="chip__n">${g.count}</b></button>`
        : `<span class="mchip chip chip--sm tone-mod">${escapeHtml(g.group)}<b class="chip__n">${g.count}</b></span>`;
    const open = interactive && openGroup ? m.groups.find((g) => g.group === openGroup) : null;
    return `
        <div class="pinx-mods card card--flat">
            <div class="pinx-mods__head">
                <span>수정 내용</span>
                <em>${m.total}개 중 값 변경 ${m.changed}${m.derivedOnly ? ` · 결과값만 ${m.derivedOnly}` : ""}${m.quiet ? ` · 함께 갱신 ${m.quiet}` : ""}</em>
            </div>
            ${groups.length ? `<div class="pinx-mods__chips">${groups.map(chip).join("")}${rest > 0 ? `<span class="mchip chip chip--sm chip--more">외 ${rest}</span>` : ""}</div>`
                : `<p class="pinx-mods__none">값이 바뀐 수정은 없어요 — 함께 갱신 · 결과값 변화만 있어요.</p>`}
            ${open ? `<ul class="pinx-mods__examples">${open.patterns.slice(0, PATTERNS).map((p) => `
                <li><button type="button" data-act="mod-element" data-base="${escapeHtml(p.bases[0])}" title="${p.count > 1 ? `같은 변화 ${p.count}개 중 첫 요소의 이력 보기` : "요소 이력 보기"}">
                    <span class="pinx-mods__el">${escapeHtml(p.count > 1 ? catsText(p.cats) : elementShort(p.ids[0]))}</span>
                    <span class="pinx-mods__line">${changeHtml(p.item)}${p.count > 1 ? `<b class="pinx-mods__n">×${p.count}</b>` : ""}</span>
                </button></li>`).join("")}${open.patterns.length > PATTERNS ? `<li class="pinx-mods__rest">외 ${open.patterns.length - PATTERNS}가지 변화 · ${open.patterns.slice(PATTERNS).reduce((n, p) => n + p.count, 0)}개 요소</li>` : ""}</ul>` : ""}
        </div>`;
}

function elementShort(versionId) {
    const ud = store.meshDict[versionId]?.userData;
    const c = ud?.Common || {};
    return `${catInfo(c.ElementCategory).label} · ${shortLevel(levelOf(ud).name)}`;
}

/** 항목 · 이전 → 이후 · 증감 (요소 이력과 같은 모양) */
export function changeHtml(item) {
    if (item.before == null || item.after == null) return `<span class="chg"><b class="chg__label">${escapeHtml(item.text)}</b></span>`;
    const d = item.delta != null && item.delta !== 0
        ? `<i class="chg__d">${item.delta > 0 ? "+" : "−"}${escapeHtml(new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(Math.abs(item.delta)))}${item.unit ? ` ${escapeHtml(item.unit)}` : ""}</i>`
        : "";
    return `<span class="chg" title="${escapeHtml(item.text)}"><b class="chg__label">${escapeHtml(item.label)}</b><span class="chg__before">${escapeHtml(item.before)}</span><span class="chg__arrow">→</span><span class="chg__after">${escapeHtml(item.after)}</span>${d}</span>`;
}

/** 층 × 카테고리 칩 (이력 화면 · 핀 탭 공용) */
export function chipsHtml(rows, limit = 8) {
    if (!rows.length) return `<span class="hchip chip chip--sm chip--more">변화 없음</span>`;
    const chips = rows.slice(0, limit).map((row) => {
        const ci = catInfo(row.cat);
        const parts = [];
        if (row.added) parts.push(`<b class="is-add">+${row.added}</b>`);
        if (row.deleted) parts.push(`<b class="is-del">−${row.deleted}</b>`);
        if (row.modified) parts.push(`<b class="is-mod">~${row.modified}</b>`);
        return `<span class="hchip chip chip--sm chip--quiet"><i class="dot" style="--c:${ci.color}"></i>${parts.join(" ")} ${escapeHtml(row.level.name)} ${escapeHtml(ci.label)}</span>`;
    }).join("");
    return chips + (rows.length > limit ? `<span class="hchip chip chip--sm chip--more">+${rows.length - limit}</span>` : "");
}

export function fmtDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    const m = Math.round(ms / 60000);
    if (m < 1) return "1분 미만";
    if (m < 60) return `${m}분`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (h < 24) return rest ? `${h}시간 ${rest}분` : `${h}시간`;
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? `${d}일 ${rh}시간` : `${d}일`;
}

// ── 썸네일 (핀 탭 · 보고서) ───────────────────────────────────────────────────
/** 핀 시점의 모델 사진. 같은 크기는 캐시한다. */
export function pinThumb(pin, { w = 128, h = 96, quality = 0.8 } = {}) {
    const key = `${pin.index}|${w}x${h}`;
    if (thumbCache.has(key)) return thumbCache.get(key);
    if (!store.viewer) return null;
    const url = captureViews({ index: pin.index, dirs: [DEFAULT_DIR], size: { w, h }, quality })[0] || null;
    if (url) thumbCache.set(key, url);
    return url;
}

export function clearPinViewCache() {
    factsCache.clear();
    thumbCache.clear();
}

// 썸네일은 핀 순서(index)로 캐시하므로 다른 프로젝트의 사진이 남으면 안 된다.
onProjectReset(clearPinViewCache);
