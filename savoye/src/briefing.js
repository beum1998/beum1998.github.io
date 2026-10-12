// ─────────────────────────────────────────────────────────────────────────────
// "지난번 이후" 브리핑
//
// 마지막으로 [확인함]을 누른 시점을 기억해 두었다가, 그 뒤로 기록이 늘었거나 핀이 생기면
// 3D 화면 위쪽에 작은 카드로 알린다.
//
//   접힌 카드   지난번 확인 시각 · +추가 −삭제 ~수정 · 새 핀 n   [자세히] [비교] [확인함]
//   펼친 카드   기준 고르기(지난번 확인 / 각 핀 / 처음) → 작업 흐름 · 새 핀 · 층×카테고리 ·
//               수정 내용 · AI 브리핑(검산 · 근거 · 평가)
//
// 처음 여는 프로젝트는 알리지 않고 "지금"을 기억만 한다. 기억은 프로젝트(로그 첫 기록 시각)마다 따로.
// 핀 탭 이력 화면의 ⋯ 메뉴에서 언제든 직접 열 수 있다.
// ─────────────────────────────────────────────────────────────────────────────

import { store, on, formatKey, escapeHtml, indexAtOrBefore, keyToMs, onProjectReset } from "./store.js";
import { icon } from "./icons.js";
import { rangeFacts, statsHtml, chipsHtml, modsHtml } from "./pinView.js";
import { mountBriefingSummary } from "./aiSummary.js";
import { expand, collapse, morph } from "./motion.js";

const SEEN = "abl_last_seen";

const state = {
    host: null,
    decided: false,      // 이 프로젝트에 대해 판단을 마쳤나
    from: null,          // 기준 시점 인덱스
    baseline: "seen",    // "seen" | 핀 id | "start"
    open: false,         // 펼침
    active: false,       // 카드를 보여주는 중
    openGroup: null,     // 펼친 수정 항목
};

// ── 기억 ─────────────────────────────────────────────────────────────────────
// 프로젝트 구분 = 로그의 첫 기록 시각. 문서 이름은 핀 파일이 늦게 오거나 없을 수 있고,
// 같은 이름의 다른 파일도 있을 수 있어서 쓰지 않는다.
function projectKey() { return store.timeKeys.length ? `log:${store.timeKeys[0]}` : "default"; }

export function readSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN) || "{}")[projectKey()] || null; } catch { return null; }
}

function writeSeen(value) {
    try {
        const all = JSON.parse(localStorage.getItem(SEEN) || "{}");
        all[projectKey()] = value;
        localStorage.setItem(SEEN, JSON.stringify(all));
    } catch { }
}

/** 지금까지 본 것으로 기억한다 */
export function markSeen() {
    const last = store.timeKeys.length - 1;
    if (last < 0) return;
    writeSeen({ key: store.timeKeys[last], pinIds: store.pins.map((p) => p.id), at: Date.now() });
}

function seenIndex(seen) {
    if (!seen?.key) return null;
    const i = store.timeKeys.indexOf(seen.key);
    return i >= 0 ? i : indexAtOrBefore(keyToMs(seen.key));
}

/** 지난번 확인 이후 무엇이 새로 생겼나 */
export function sinceSeen() {
    const seen = readSeen();
    if (!seen) return null;
    const from = seenIndex(seen);
    const last = store.timeKeys.length - 1;
    const known = new Set(seen.pinIds || []);
    const newPins = store.pins.filter((p) => p.index > from || (known.size && !known.has(p.id)));
    return { seen, from, to: last, points: last - from, newPins };
}

// ── 시작 ─────────────────────────────────────────────────────────────────────
export function initBriefing() {
    if (state.host) return;
    const pane = document.getElementById("pane-main");
    if (!pane) return;
    const host = document.createElement("section");
    host.className = "brief";
    host.hidden = true;
    host.setAttribute("aria-label", "지난번 이후 브리핑");
    pane.append(host);
    state.host = host;

    host.addEventListener("click", onClick);
    host.addEventListener("change", onChange);
    host.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.open) toggle(false); });

    store.openBriefing = (opts) => openBriefing(opts);

    // 핀은 데이터와 따로 불러오므로 잠깐 기다렸다가 판단한다
    const decide = () => {
        if (state.decided || !store.timeKeys.length) return;
        state.decided = true;
        const seen = readSeen();
        if (!seen) {
            markSeen();
            // 처음 보는 프로젝트: 핀이 늦게 도착해도 "새 핀" 으로 잘못 세지 않게 잠시 따라 기억
            const off = on("pins", markSeen);
            setTimeout(() => off?.(), 4000);
            return;
        }
        const s = sinceSeen();
        if (s && (s.points > 0 || s.newPins.length)) show({ baseline: "seen" });
    };
    on("data", () => setTimeout(decide, 1200));
    if (store.timeKeys.length) setTimeout(decide, 1200);

    // 다른 폴더를 열면: 이전 프로젝트의 카드를 내리고 새 프로젝트로 다시 판단한다
    onProjectReset(() => {
        state.decided = false;
        state.active = false;
        state.open = false;
        state.openGroup = null;
        host.hidden = true;
        host.innerHTML = "";
    });

    on("pins", () => { if (state.active) render(); });
    on("split", (open) => { if (state.active) host.hidden = Boolean(open); });
}

/** 메뉴에서 직접 열기 — 지난번 이후 변화가 없으면 마지막 두 핀 사이를 기준으로 */
export function openBriefing({ baseline } = {}) {
    const s = sinceSeen();
    let base = baseline;
    if (!base) {
        if (s && (s.points > 0 || s.newPins.length)) base = "seen";
        else if (store.pins.length >= 2) base = store.pins[store.pins.length - 2].id;
        else base = "start";
    }
    show({ baseline: base, open: true });
}

function show({ baseline, open = false }) {
    state.baseline = baseline;
    state.active = true;
    state.open = open;
    state.openGroup = null;
    render();
    if (store.split) return;
    if (state.host.hidden) expand(state.host, { fade: true });
}

function hide() {
    state.active = false;
    state.open = false;
    collapse(state.host);
}

// ── 그리기 ───────────────────────────────────────────────────────────────────
function baselineIndex() {
    const last = store.timeKeys.length - 1;
    if (state.baseline === "start") return 0;
    if (state.baseline === "seen") return Math.min(last, seenIndex(readSeen()) ?? 0);
    const pin = store.pins.find((p) => p.id === state.baseline);
    return pin ? pin.index : 0;
}

function render() {
    const host = state.host;
    const to = store.timeKeys.length - 1;
    const from = baselineIndex();
    state.from = from;
    const f = rangeFacts(from, to);
    const seen = readSeen();
    const s = sinceSeen();
    const newPins = store.pins.filter((p) => p.index > from && p.index <= to);
    const fromLabel = short(store.timeKeys[from]);
    const basePin = store.pins.find((p) => p.id === state.baseline);
    const baseName = state.baseline === "seen" ? "지난번 확인" : basePin ? `핀 ${store.pins.indexOf(basePin) + 1}` : "처음";

    const counts = f.total
        ? [f.added ? `<b class="is-add">+${f.added}</b>` : "", f.deleted ? `<b class="is-del">−${f.deleted}</b>` : "", f.modified ? `<b class="is-mod">~${f.modified}</b>` : ""].filter(Boolean).join(" ")
        : `<span class="brief__none">모델 변화 없음</span>`;

    const options = [
        seen ? `<option value="seen"${state.baseline === "seen" ? " selected" : ""}>지난번 확인 · ${escapeHtml(short(seen.key))}</option>` : "",
        ...store.pins.filter((p) => p.index < to).map((p, i) => `<option value="${escapeHtml(p.id)}"${state.baseline === p.id ? " selected" : ""}>핀 ${store.pins.indexOf(p) + 1} · ${escapeHtml(p.title)} (${escapeHtml(short(store.timeKeys[p.index]))})</option>`),
        `<option value="start"${state.baseline === "start" ? " selected" : ""}>처음부터</option>`,
    ].join("");

    const html = `
        <div class="brief__bar">
            <span class="brief__dot" aria-hidden="true"></span>
            <span class="brief__title"><b>${baseName === "지난번 확인" ? "지난번 이후" : `${baseName} 이후`}</b><time>${escapeHtml(fromLabel)}</time></span>
            <span class="brief__nums">${counts}${newPins.length ? `<span class="brief__sep">·</span><span class="brief__pins">${icon("pin", 12)}새 핀 ${newPins.length}</span>` : ""}</span>
            <span class="brief__actions">
                <button class="brief__btn btn btn--sm btn--pill" type="button" data-br="toggle" aria-expanded="${state.open}">${state.open ? "접기" : "자세히"}${icon("chevronDown", 12, state.open ? "ico--flip" : "")}</button>
                <button class="brief__btn btn btn--sm btn--pill" type="button" data-br="compare" title="기준 시점과 지금을 나란히"${f.total ? "" : " disabled"}>${icon("split", 12)}비교</button>
                ${state.baseline === "seen" && s ? `<button class="brief__btn btn btn--sm btn--pill btn--primary" type="button" data-br="seen" title="지금까지 본 것으로 기억 — 다음엔 이후 변화만 알려요">${icon("check", 12)}확인함</button>`
                    : `<button class="brief__btn btn btn--sm btn--pill btn--icon" type="button" data-br="close" title="닫기" aria-label="닫기">${icon("x", 13)}</button>`}
            </span>
        </div>
        ${state.open ? `
        <div class="brief__panel">
            <div class="brief__row">
                <label class="brief__base">
                    <span>기준</span>
                    <select class="field field--sm" data-br="base">${options}</select>
                </label>
                <span class="brief__range">→ 지금 ${escapeHtml(short(store.timeKeys[to]))} · 기록 ${to - from}개 시점</span>
            </div>
            ${f.total || f.rework.edits ? statsHtml(f) : ""}
            ${newPins.length ? `
            <div class="brief__sec">
                <h4>새 핀</h4>
                <ul class="brief__pinlist">${newPins.map((p) => `
                    <li><button type="button" data-br="pin" data-index="${p.index}">
                        <span class="brief__pinno num-dot">${store.pins.indexOf(p) + 1}</span>
                        <span class="brief__pintitle">${escapeHtml(p.title)}</span>
                        ${p.note ? "" : `<em class="brief__nomemo tag tone-mod" title="메모가 없어요">메모 없음</em>`}
                        <time>${escapeHtml(short(store.timeKeys[p.index]))}</time>
                    </button></li>`).join("")}
                </ul>
            </div>` : ""}
            ${f.total ? `
            <div class="brief__sec">
                <h4>어디가 바뀌었나</h4>
                <div class="hchips">${chipsHtml(f.topRows, 8)}</div>
            </div>` : ""}
            ${modsHtml(f, { interactive: true, openGroup: state.openGroup })}
            <div class="brief__sec brief__sec--ai">
                <h4>${icon("sparkle", 12)}AI 브리핑</h4>
                <div class="aiblk brief__ai"></div>
            </div>
        </div>` : ""}`;

    const apply = () => {
        host.classList.toggle("is-open", state.open);
        host.innerHTML = html;
        const ai = host.querySelector(".brief__ai");
        if (ai) mountBriefingSummary(ai, from, to);
    };
    if (host.hidden || !host.childElementCount) apply(); else morph(host, apply);
}

function short(key) {
    if (!key) return "—";
    const f = formatKey(key);
    return `${f.date.slice(5)} ${f.time.slice(0, 5)}`;
}

// ── 동작 ─────────────────────────────────────────────────────────────────────
function toggle(open) {
    state.open = open;
    render();
    if (open) state.host.querySelector("select")?.focus({ preventScroll: true });
}

function onClick(e) {
    const btn = e.target.closest("[data-br], [data-act]");
    if (!btn || !state.host.contains(btn)) return;
    const act = btn.dataset.br || btn.dataset.act;
    if (act === "toggle") toggle(!state.open);
    else if (act === "compare") {
        state.open = false;
        render();
        store.openSplit?.({ beforeIndex: state.from, afterIndex: store.timeKeys.length - 1 });
    } else if (act === "seen") { markSeen(); hide(); }
    else if (act === "close") hide();
    else if (act === "pin") store.setMainIndex?.(Number(btn.dataset.index));
    else if (act === "mod-group") {
        state.openGroup = state.openGroup === btn.dataset.group ? null : btn.dataset.group;
        render();
    } else if (act === "mod-element") {
        store.selectElement?.(btn.dataset.base, store.timeKeys.length - 1);
    }
}

function onChange(e) {
    if (!e.target.matches('[data-br="base"]')) return;
    state.baseline = e.target.value;
    state.openGroup = null;
    render();
}
