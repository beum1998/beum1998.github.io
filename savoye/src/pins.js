// ─────────────────────────────────────────────────────────────────────────────
// 핀 (작업 시점 표시)
//
// 핀은 두 곳에서 생긴다.
//   1) Revit 리본 [기록 › 핀 찍기] — 작업하던 그 순간에 찍는 핀.
//      전처리가 저장된 핀을 ./src/finalLogs/pins.json 으로 내보낸다:
//      [{ Id, Timestamp(yyyy_MM_dd_HH_mm_ss), Title, Note, Stage, Author, Document, Saved }]
//   2) 뷰어 — 타임라인을 돌려 보다가 "이 시점"에 뒤늦게 찍는 핀(회고 핀).
//      애드인 서버가 살아 있으면 Revit 쪽 핀 파일에도 함께 저장되고(다음 전처리에도 남는다),
//      그렇지 않으면 이 브라우저에만 남는다.
//
// 뷰어에서 고친 제목·메모·단계는 `abl_pin_edits` 에 덮어쓰기로 쌓이고, 서버가 있으면
// Revit 핀 파일에도 반영된다(PATCH). 서버가 없어도 뷰어에서는 고친 내용이 보인다.
//
// 각 핀은 "그 시각 이하의 가장 최근 타임라인 키"에 붙는다(로그는 변경이 있을 때만 키가 생기므로).
//
//   · 타임라인 위 마커 (호버 = 제목, 클릭 = 이동), `[` `]` 로 이전/다음 핀 이동
//   · 핀 탭: 검색·단계 필터, 카드에서 이동 · 비교 · AI 요약 · 수정 · 삭제
//     카드는 3단 — (1) 사진 · 시각 · 제목 · 한 줄 변화  (2) 작업 흐름 수치 · 층×카테고리
//     (3) AI 요약(접힌 미리보기 → 근거 · 평가). 내용은 pinView.js 와 이력 화면이 함께 쓴다.
// ─────────────────────────────────────────────────────────────────────────────

import { store, emit, on, keyToMs, indexAtOrBefore, formatKey, escapeHtml, showTip, hideTip, fetchJsonRetry } from "./store.js";
import { icon, pinStamp } from "./icons.js";
import { mountPinSummary, getPinSummary, clearPinSummary } from "./aiSummary.js";
import { expand, collapse, stagger } from "./motion.js";
import { pinFacts, factsLine, statsHtml, chipsHtml, pinThumb, modsHtml } from "./pinView.js";

const LOCAL_KEY = "abl_viewer_pins";    // 뷰어에서 찍은 핀
const HIDDEN_KEY = "abl_hidden_pins";   // 숨긴(삭제한) 핀의 id
const EDIT_KEY = "abl_pin_edits";       // 뷰어에서 고친 제목·메모·단계
const STAGES = ["기획", "계획설계", "기본설계", "실시설계", "검토"];

let filePins = [];        // pins.json 에서 읽은 원본

// ?pins=commits — 사람이 찍은 핀(Design Commit)만. tools/demo-pins.js 가 형상 마디마다 자동으로 찍은
// 핀(pins.json 의 Generated)을 빼서, 핀 요약의 구간이 "직전 사람 핀 → 이 핀"이 되게 한다(논문 분석용).
// 데이터는 바꾸지 않고 이 주소로 연 동안만 적용된다.
const COMMITS_ONLY = (() => {
    try { return new URLSearchParams(location.search).get("pins") === "commits"; } catch { return false; }
})();
let lastRemoved = null;   // 되돌리기용 { raw, wasLocal, title }

// ── 저장소 ──────────────────────────────────────────────────────────────────
function readJson(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
}
const readLocal = () => readJson(LOCAL_KEY, []);
const readHidden = () => readJson(HIDDEN_KEY, []);
const readEdits = () => readJson(EDIT_KEY, {});

export async function loadPinsAuto(baseUrl) {
    try {
        const json = await fetchJsonRetry(baseUrl + "pins.json");
        if (!json) { setPins([]); return; }
        const list = Array.isArray(json) ? json : (json?.Pins || []);
        // 문서 이름: 핀 파일에 적힌 것(보고서 제목 · 파일 이름에 쓴다)
        if (!store.docTitle) store.docTitle = (json?.Document || list.find((p) => p?.Document)?.Document || "").trim() || null;
        setPins(list);
    } catch {
        setPins([]);
    }
}

export function setPins(raw) {
    filePins = Array.isArray(raw) ? raw : [];
    applyPins();
}

/** 저장소만 바뀌었을 때(백업 복원 등) 다시 세운다. */
export function refreshPins() { applyPins(); }

/** 파일 핀 + 뷰어 핀을 합치고, 고친 내용을 덮고, 숨긴 건 빼고, 시간순으로 세운다. */
function applyPins() {
    const hidden = new Set(readHidden());
    const edits = readEdits();
    const seen = new Set();
    const out = [];
    for (const raw of [...filePins, ...readLocal()]) {
        const id = raw?.Id || raw?.Timestamp;
        if (COMMITS_ONLY && raw?.Generated) continue;
        const p = normalize(raw, edits[id]);
        if (!p || !Number.isFinite(p.ms) || hidden.has(p.id) || seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
    }
    store.pins = out.sort((a, b) => a.ms - b.ms);
    reindex();
    emit("pins", store.pins);
}

function normalize(p, edit) {
    if (!p) return null;
    const ts = p.Timestamp || p.timestamp || "";
    const src = { ...p, ...(edit || {}) };
    return {
        id: p.Id || ts,
        ts,
        ms: keyToMs(ts),
        title: (src.Title || "").trim() || "제목 없는 핀",
        note: (src.Note || "").trim(),
        stage: (src.Stage || "").trim(),
        author: p.Author || "",
        source: p.Source === "viewer" ? "viewer" : "revit",
        edited: Boolean(edit),
        index: 0,
    };
}

function reindex() {
    if (!store.timeKeys.length) return;
    for (const p of store.pins) p.index = indexAtOrBefore(p.ms);
}

// ── 회고 핀: 지나간 시점에 뒤늦게 찍기 ───────────────────────────────────────
/** 타임라인 인덱스에 핀을 만든다. 애드인 서버가 있으면 Revit 쪽에도 같이 저장. */
export function createPinAt(index, { title, note, stage }) {
    const ts = store.timeKeys[index];
    if (!ts) return null;
    const raw = {
        Id: "vpin_" + ts + "_" + Math.random().toString(36).slice(2, 6),
        Timestamp: ts,
        Title: (title || "").trim(),
        Note: (note || "").trim(),
        Stage: stage || "",
        Author: "뷰어",
        Document: store.docTitle || "",
        Saved: true,
        Source: "viewer",
    };
    const local = readLocal();
    local.push(raw);
    writeJson(LOCAL_KEY, local);
    applyPins();
    pushToAddin(raw);
    return raw;
}

/** 제목·메모·단계를 고친다. 뷰어에 바로 반영되고, 서버가 있으면 Revit 핀 파일에도 반영된다. */
export function updatePin(pin, { title, note, stage }) {
    const patch = { Title: (title || "").trim(), Note: (note || "").trim(), Stage: stage || "" };

    const edits = readEdits();
    edits[pin.id] = patch;
    writeJson(EDIT_KEY, edits);

    // 뷰어에서 만든 핀은 원본 자체를 고쳐 둔다
    if (pin.source === "viewer") {
        writeJson(LOCAL_KEY, readLocal().map((p) => ((p.Id || p.Timestamp) === pin.id ? { ...p, ...patch } : p)));
    }

    fetch("api/pins/" + encodeURIComponent(pin.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    }).catch(() => { });

    applyPins();
}

/** 애드인 로컬 서버가 있으면 Revit 핀 파일에도 남긴다(없으면 조용히 넘어간다). */
function pushToAddin(raw) {
    fetch("api/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
    }).catch(() => { });
}

/** 핀을 지운다. 뷰어 핀은 실제로 지우고, Revit 핀은 이 브라우저에서 숨긴다. */
export function removePin(pin) {
    if (!pin) return;
    const raw = findRaw(pin.id);
    if (pin.source === "viewer") {
        writeJson(LOCAL_KEY, readLocal().filter((p) => (p.Id || p.Timestamp) !== pin.id));
        fetch("api/pins/" + encodeURIComponent(pin.id), { method: "DELETE" }).catch(() => { });
    }
    // 뷰어 핀이라도 이미 pins.json 에 실려 돌아왔을 수 있으므로, 숨김 목록에도 넣어 둔다
    const hidden = readHidden();
    if (!hidden.includes(pin.id)) hidden.push(pin.id);
    writeJson(HIDDEN_KEY, hidden);

    clearPinSummary(pin.id);
    lastRemoved = { raw, wasLocal: pin.source === "viewer", title: pin.title };
    applyPins();
}

/** 방금 지운 핀을 되돌린다. */
export function undoRemove() {
    if (!lastRemoved) return;
    const { raw, wasLocal } = lastRemoved;
    if (raw) {
        const id = raw.Id || raw.Timestamp;
        writeJson(HIDDEN_KEY, readHidden().filter((x) => x !== id));
        if (wasLocal) {
            const local = readLocal();
            if (!local.some((p) => (p.Id || p.Timestamp) === id)) local.push(raw);
            writeJson(LOCAL_KEY, local);
            pushToAddin(raw);
        }
    }
    lastRemoved = null;
    applyPins();
}

function findRaw(id) {
    return [...filePins, ...readLocal()].find((p) => (p.Id || p.Timestamp) === id) || null;
}

/** 정확히 그 인덱스에 붙은 마지막 핀 */
export function pinAtIndex(i) {
    let hit = null;
    for (const p of store.pins) if (p.index === i) hit = p;
    return hit;
}

/** 인덱스보다 앞선 마지막 핀 */
export function prevPinBefore(i) {
    let hit = null;
    for (const p of store.pins) if (p.index < i) hit = p;
    return hit;
}

/** 인덱스 시점까지 찍힌 마지막 핀(현재 작업이 속한 핀) */
function currentPin(i) {
    let hit = null;
    for (const p of store.pins) if (p.index <= i) hit = p;
    return hit;
}

/** 타임라인 마커를 그린다. 같은 키에 붙은 핀은 하나로 묶고 개수를 표시. */
export function renderMarkers(container, activeIndex, onPick) {
    if (!container) return;
    const n = Math.max(1, store.timeKeys.length - 1);
    const groups = new Map();
    for (const p of store.pins) {
        if (!groups.has(p.index)) groups.set(p.index, []);
        groups.get(p.index).push(p);
    }
    container.innerHTML = [...groups.entries()].map(([index, pins]) => `
        <button class="pin-marker${index === activeIndex ? " is-active" : ""}" type="button"
                style="--x:${(index / n).toFixed(5)}" data-index="${index}" aria-label="${escapeHtml(pins[pins.length - 1].title)}">
            ${icon("pinSolid", 16)}${pins.length > 1 ? `<i>${pins.length}</i>` : ""}
        </button>`).join("");

    container.onmouseover = (e) => {
        const b = e.target.closest(".pin-marker");
        if (!b) return;
        const pins = groups.get(+b.dataset.index) || [];
        showTip(b, pins.map((p) => `
            <div class="tip-pin"><b>${escapeHtml(p.title)}</b><span>${formatKey(p.ts).short}${p.stage ? ` · ${escapeHtml(p.stage)}` : ""}</span></div>`).join(""));
    };
    container.onmouseout = (e) => { if (e.target.closest(".pin-marker")) hideTip(); };
    container.onclick = (e) => {
        const b = e.target.closest(".pin-marker");
        if (b) onPick(+b.dataset.index);
    };
}

export function initPins() {
    if (window.__ablPinsInit) return;
    window.__ablPinsInit = true;

    const list = document.getElementById("pins-target");
    const tlPins = document.getElementById("tl-pins");
    const mainPin = document.getElementById("main-pin");
    const tabCount = document.getElementById("pins-count");

    // 작성 중인 내용 — 목록을 다시 그려도 쓰던 내용이 날아가지 않게 여기에 둔다
    const compose = { open: false, editId: null, title: "", note: "", stage: "" };
    const filter = { q: "", stage: "" };
    const openDetails = new Set();   // 펼쳐 둔 "작업 흐름" — 다시 그려도 유지
    const openMods = new Map();      // 핀 id → 펼친 수정 항목
    let thumbObserver = null;

    const refreshTimeline = () => renderMarkers(tlPins, store.mainIndex, (i) => store.setMainIndex?.(i));

    on("data", () => { reindex(); renderList(); refreshTimeline(); });
    on("pins", () => { renderList(); refreshTimeline(); });
    on("time:main", () => {
        refreshTimeline();
        markCurrent();
        updateComposeTime();
        const p = pinAtIndex(store.mainIndex);
        if (mainPin) {
            mainPin.hidden = !p;
            if (p) mainPin.innerHTML = `${icon("pinSolid", 13)}<span>${escapeHtml(p.title)}</span>`;
        }
    });

    // 타임라인 옆 [핀 찍기] — 지금 보고 있는 시점에 바로 찍는다
    const stampHost = document.querySelector("#pin-here [data-pin-stamp]");
    if (stampHost) stampHost.outerHTML = pinStamp(22);
    document.getElementById("pin-here")?.addEventListener("click", () => openCompose());

    /** 다른 화면(타임라인 · 이력)에서도 부를 수 있게 */
    store.newPinHere = openCompose;

    // `[` `]` — 이전/다음 핀으로 이동 (입력 중일 때는 넘긴다)
    window.addEventListener("keydown", (e) => {
        if (e.key !== "[" && e.key !== "]") return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
        if (!store.pins.length) return;
        e.preventDefault();
        const cur = store.mainIndex;
        const target = e.key === "["
            ? [...store.pins].reverse().find((p) => p.index < cur)
            : store.pins.find((p) => p.index > cur);
        if (target) store.setMainIndex?.(target.index);
    });

    list?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        const act = btn?.dataset.act;

        if (act === "history") { store.openHistory?.(); return; }
        if (act === "new") { (compose.open && !compose.editId) ? closeCompose() : openCompose(); return; }
        if (act === "compose-save") { saveCompose(); return; }
        if (act === "compose-cancel") { closeCompose(); return; }
        if (act === "stage") {
            compose.stage = compose.stage === btn.dataset.stage ? "" : btn.dataset.stage;
            list.querySelectorAll(".pin-new__stages .chip-s").forEach((c) => {
                c.classList.toggle("is-on", c.dataset.stage === compose.stage);
            });
            return;
        }
        if (act === "undo") { undoRemove(); return; }
        if (act === "filter-stage") {
            filter.stage = filter.stage === btn.dataset.stage ? "" : btn.dataset.stage;
            renderList();
            return;
        }
        if (act === "filter-clear") { filter.q = ""; filter.stage = ""; renderList(); return; }

        const card = e.target.closest(".pin-card");
        if (!card) return;
        const pin = store.pins.find((p) => p.id === card.dataset.id);
        if (!pin) return;

        if (act === "mod-group") {
            const g = btn.dataset.group;
            if (openMods.get(pin.id) === g) openMods.delete(pin.id); else openMods.set(pin.id, g);
            renderList();
            return;
        }
        if (act === "mod-element") {
            store.selectElement?.(btn.dataset.base, pin.index);
            return;
        }
        if (act === "compare") {
            const prev = prevPinBefore(pin.index);
            store.openSplit?.({ beforeIndex: prev ? prev.index : 0, afterIndex: pin.index });
        } else if (act === "view") {
            store.openCommitView?.(pin);
        } else if (act === "ai") {
            const box = card.querySelector(".pin-card__ai");
            if (!box) return;
            if (!box.hidden && !getPinSummary(pin.id)) { collapse(box); return; }
            mountPinSummary(box, pin, { compact: true, onChange: () => emit("pins", store.pins) });
        } else if (act === "edit") {
            openCompose(pin);
        } else if (act === "del") {
            removePin(pin);
        } else if (act === "go" || (!act && !e.target.closest(".pin-card__ai, .pinx"))) {
            store.setMainIndex?.(pin.index);
        }
    });

    // "작업 흐름" 펼침 상태 기억 (toggle 은 버블링하지 않으므로 capture 로 받는다)
    list?.addEventListener("toggle", (e) => {
        const det = e.target.closest?.("details[data-details]");
        if (!det) return;
        if (det.open) openDetails.add(det.dataset.details);
        else openDetails.delete(det.dataset.details);
    }, true);

    // 작성 중 입력 보관 + 검색어
    list?.addEventListener("input", (e) => {
        if (e.target.matches(".pin-new__title")) compose.title = e.target.value;
        else if (e.target.matches(".pin-new__note")) compose.note = e.target.value;
        else if (e.target.matches(".pin-filter__q")) {
            filter.q = e.target.value;
            renderList({ keepFocus: ".pin-filter__q" });
        }
    });
    list?.addEventListener("keydown", (e) => {
        if (!e.target.closest(".pin-new")) return;
        if (e.key === "Escape") { closeCompose(); }
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.target.matches(".pin-new__title"))) {
            e.preventDefault();
            saveCompose();
        }
    });

    // ── 새 핀 작성 / 수정 ───────────────────────────────────────────────────
    function openCompose(pin = null) {
        compose.open = true;
        compose.editId = pin?.id || null;
        compose.title = pin?.title || "";
        compose.note = pin?.note || "";
        compose.stage = pin?.stage || "";
        store.setTab?.("pins");
        renderList();
        const box = list?.querySelector(".pin-new");
        if (box) { box.hidden = true; expand(box); }
        const input = list?.querySelector(".pin-new__title");
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }

    function closeCompose() {
        const box = list?.querySelector(".pin-new");
        resetCompose();
        if (box) collapse(box).then(() => renderList());
        else renderList();
    }

    function resetCompose() {
        compose.open = false;
        compose.editId = null;
        compose.title = compose.note = compose.stage = "";
    }

    function saveCompose() {
        const title = (compose.title || "").trim();
        if (!title) { list?.querySelector(".pin-new__title")?.focus(); return; }
        const editing = compose.editId ? store.pins.find((p) => p.id === compose.editId) : null;
        if (editing) updatePin(editing, { title, note: compose.note, stage: compose.stage });
        else createPinAt(store.mainIndex, { title, note: compose.note, stage: compose.stage });
        resetCompose();
        renderList();   // applyPins 의 emit 으로도 다시 그려지지만, 작성창을 바로 닫아 준다
    }

    function updateComposeTime() {
        if (compose.editId) return;   // 수정 중일 땐 그 핀의 시각을 그대로 둔다
        const el = list?.querySelector(".pin-new__when b");
        if (el) el.textContent = whenLabel();
    }

    function whenLabel() {
        if (compose.editId) {
            const p = store.pins.find((x) => x.id === compose.editId);
            if (p) { const f = formatKey(p.ts); return `${f.date} ${f.time}`; }
        }
        const key = store.timeKeys[store.mainIndex];
        if (!key) return "시점 없음";
        const f = formatKey(key);
        return `${f.date} ${f.time}`;
    }

    function composer() {
        if (!compose.open) return "";
        const editing = Boolean(compose.editId);
        return `
            <div class="pin-new card ${editing ? "pin-new--edit tone-accent" : "tone-pin"}">
                <div class="pin-new__when">${icon(editing ? "edit" : "clock", 13)}<span>${editing ? "이 핀을 고쳐요" : "이 시점에 찍어요"}</span><b>${escapeHtml(whenLabel())}</b></div>
                <input class="pin-new__title field field--block" type="text" maxlength="80" placeholder="무슨 작업이었나요? (제목)" value="${escapeHtml(compose.title)}">
                <textarea class="pin-new__note field field--block" rows="2" maxlength="600" placeholder="메모 — 왜 이렇게 바꿨는지 (선택)">${escapeHtml(compose.note)}</textarea>
                <div class="pin-new__stages">
                    ${STAGES.map((s) => `<button class="chip chip--sm chip-s${compose.stage === s ? " is-on" : ""}" type="button" data-act="stage" data-stage="${s}">${s}</button>`).join("")}
                </div>
                <div class="pin-new__acts">
                    <span class="pin-new__hint">${editing ? "시각은 그대로예요. 제목·메모·단계만 고칩니다." : "타임라인을 옮기면 찍히는 시점도 따라가요"}</span>
                    <button class="btn btn--ghost btn--sm" type="button" data-act="compose-cancel">취소</button>
                    <button class="btn btn--primary btn--sm" type="button" data-act="compose-save">${editing ? icon("check", 13) : pinStamp(16)}${editing ? "수정 저장" : "핀 찍기"}</button>
                </div>
            </div>`;
    }

    function undoBar() {
        if (!lastRemoved) return "";
        return `
            <div class="pin-undo notice">
                <span>${escapeHtml(lastRemoved.title)} — 핀을 지웠어요</span>
                <button class="btn btn--ghost btn--xs" type="button" data-act="undo">${icon("refresh", 12)}되돌리기</button>
            </div>`;
    }

    function filterBar() {
        if (store.pins.length < 4 && !filter.q && !filter.stage) return "";
        const stages = STAGES.filter((s) => store.pins.some((p) => p.stage === s));
        return `
            <div class="pin-filter">
                <div class="pin-filter__search field-icon">
                    ${icon("search", 13)}
                    <input class="pin-filter__q field field--sm tone-pin" type="search" placeholder="제목·메모 검색" value="${escapeHtml(filter.q)}">
                </div>
                ${stages.length ? `<div class="pin-filter__stages">
                    ${stages.map((s) => `<button class="chip chip--sm chip-s tone-pin${filter.stage === s ? " is-on" : ""}" type="button" data-act="filter-stage" data-stage="${s}">${s}</button>`).join("")}
                </div>` : ""}
            </div>`;
    }

    function matches(p) {
        if (filter.stage && p.stage !== filter.stage) return false;
        const q = filter.q.trim().toLowerCase();
        if (!q) return true;
        return `${p.title} ${p.note} ${p.stage} ${p.author}`.toLowerCase().includes(q);
    }

    function renderList({ keepFocus = null } = {}) {
        if (!list) return;
        if (tabCount) {
            tabCount.textContent = store.pins.length ? String(store.pins.length) : "";
            tabCount.hidden = !store.pins.length;
        }

        const head = `
            <div class="sec-head">
                <h3>작업 핀</h3>
                <span class="sec-head__hint">카드를 누르면 그 시점으로 이동해요</span>
            </div>`;

        if (!store.pins.length) {
            list.innerHTML = head + composer() + undoBar() + `
                <div class="empty">
                    <div class="empty__icon empty__icon--pin">${icon("pin", 22)}</div>
                    <div class="empty__title">아직 핀이 없어요</div>
                    <p class="empty__text">Revit 리본의 <b>기록 › 핀 찍기</b>로 작업 시점에 제목과 메모를 남기세요.
                    지나간 시점이라면 타임라인을 그때로 옮기고 아래 <b>핀 찍기</b>로 뒤늦게 찍어도 돼요.</p>
                </div>`;
            return;
        }

        const cur = currentPin(store.mainIndex);
        const shown = store.pins.filter(matches);
        const filtered = shown.length !== store.pins.length;

        list.innerHTML = head + composer() + undoBar() + filterBar() + `
            <div class="sec-head sec-head--flush">
                <span class="sec-sub">${filtered ? `${store.pins.length}개 중 ${shown.length}개` : `${store.pins.length}개`} · 오래된 순</span>
                ${filtered ? `<button class="btn btn--ghost btn--xs" type="button" data-act="filter-clear">${icon("x", 12)}필터 해제</button>` : ""}
                <button class="btn btn--ghost btn--xs" type="button" data-act="history">${icon("layers", 13)}전체 이력 보기</button>
            </div>
            ${shown.length ? `<ol class="pin-list">
            ${shown.map((p) => {
            const f = formatKey(p.ts);
            const prev = prevPinBefore(p.index);
            const saved = getPinSummary(p.id);
            const facts = pinFacts(p);
            return `
                <li class="pin-card${p === cur ? " is-current" : ""}${p.source === "viewer" ? " is-viewer" : ""}" data-id="${escapeHtml(p.id)}">
                    <span class="pin-card__dot"></span>
                    <div class="pin-card__body card card--hover reveal-on-hover">
                        <div class="pin-card__head">
                            <button class="pin-card__thumb" type="button" data-act="go" data-thumb="${escapeHtml(p.id)}" title="이 시점으로 이동">${icon("box", 16)}</button>
                            <div class="pin-card__main">
                                <div class="pin-card__top">
                                    ${p.stage ? `<span class="tag tag--md tone-pin">${escapeHtml(p.stage)}</span>` : ""}
                                    ${p.source === "viewer" ? `<span class="tag tag--md tag--line" title="뷰어에서 뒤늦게 찍은 핀">회고</span>` : ""}
                                    ${p.edited ? `<span class="tag tag--md tag--line" title="뷰어에서 고친 핀">수정됨</span>` : ""}
                                    <time title="${f.date} ${f.time}">${f.date.slice(5)} ${f.time.slice(0, 5)}</time>
                                    <button class="pin-card__icon btn btn--ghost btn--icon btn--xs btn--reveal tone-neutral" type="button" data-act="edit" title="제목·메모·단계 고치기" aria-label="제목·메모·단계 고치기">${icon("edit", 12)}</button>
                                    <button class="pin-card__icon btn btn--ghost btn--icon btn--xs btn--reveal tone-del" type="button" data-act="del" title="핀 지우기" aria-label="핀 지우기">${icon("trash", 12)}</button>
                                </div>
                                <div class="pin-card__title" data-act="go" title="이 시점으로 이동">${escapeHtml(p.title)}</div>
                                ${factsLine(facts)}
                            </div>
                        </div>
                        ${p.note ? `<div class="pin-card__note">${escapeHtml(p.note)}</div>` : ""}
                        <details class="pinx disc disc--line"${openDetails.has(p.id) ? " open" : ""} data-details="${escapeHtml(p.id)}">
                            <summary>${icon("chevronRight", 12)}<span>작업 흐름</span><em>${facts.rework.edits.toLocaleString()}회 편집 · 확정 ${facts.rework.settled}</em></summary>
                            <div class="pinx__body">
                                ${statsHtml(facts)}
                                ${modsHtml(facts, { interactive: true, openGroup: openMods.get(p.id) || null })}
                                <div class="hchips">${chipsHtml(facts.rows, 6)}</div>
                            </div>
                        </details>
                        <div class="pin-card__actions tone-pin">
                            <button class="btn btn--ghost btn--xs" data-act="compare" type="button">${icon("compare", 13)}${prev ? "이전 핀과 비교" : "처음과 비교"}</button>
                            <button class="btn btn--ghost btn--xs" data-act="view" type="button" title="AI 에 보낸 모델 · 층별 평면 · 변경 정보와 해석을 한 화면에서 봐요">${icon("doc", 13)}해석 보기</button>
${saved ? "" : `<button class="btn btn--ghost btn--xs" data-act="ai" type="button"
                                    title="${prev ? "이전 핀과 이 핀 사이의 변화를 AI가 요약해요" : "처음부터 이 핀까지의 변화를 AI가 요약해요"}">${icon("sparkle", 13)}AI 요약</button>`}
                        </div>
                        <div class="pin-card__ai aiblk"${saved ? "" : " hidden"}></div>
                    </div>
                </li>`;
        }).join("")}
            </ol>` : `<p class="pin-none">검색·필터에 맞는 핀이 없어요.</p>`}`;

        // 이미 요약해 둔 핀은 카드에 그대로 펼쳐 둔다 — 요약은 핀에 남는다
        list.querySelectorAll(".pin-card").forEach((card) => {
            const pin = store.pins.find((p) => p.id === card.dataset.id);
            if (pin && getPinSummary(pin.id)) {
                mountPinSummary(card.querySelector(".pin-card__ai"), pin, { compact: true, onChange: () => emit("pins", store.pins) });
            }
        });
        observeThumbs();
        stagger(list.querySelectorAll(".pin-card"));

        if (keepFocus) {
            const el = list.querySelector(keepFocus);
            if (el) { el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); }
        }
    }

    function observeThumbs() {
        thumbObserver?.disconnect();
        const paintThumb = (el) => {
            const pin = store.pins.find((p) => p.id === el.dataset.thumb);
            const url = pin && pinThumb(pin, { w: 144, h: 108 });
            if (url) el.innerHTML = `<img src="${url}" alt="">`;
        };
        if (!("IntersectionObserver" in window)) {
            list.querySelectorAll("[data-thumb]").forEach(paintThumb);
            return;
        }
        thumbObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                thumbObserver.unobserve(entry.target);
                requestAnimationFrame(() => paintThumb(entry.target));
            }
        }, { root: list, rootMargin: "160px 0px" });
        list.querySelectorAll("[data-thumb]").forEach((el) => thumbObserver.observe(el));
    }

    function markCurrent() {
        if (!list || !store.pins.length) return;
        const cur = currentPin(store.mainIndex);
        list.querySelectorAll(".pin-card").forEach((el) => {
            el.classList.toggle("is-current", store.pins.find((p) => p.id === el.dataset.id) === cur);
        });
    }
}
