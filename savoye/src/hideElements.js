// ─────────────────────────────────────────────────────────────────────────────
// 요소 숨기기 — 고른 요소 하나만 껐다 켠다
//
//   · 선택 칩의 [숨기기] · H 키 · Ctrl+Alt+클릭 으로 숨긴다
//   · 숨긴 요소는 기본 ID(요소ID_n 에서 _n 을 뗀 값) 단위라, 시점을 옮겨도 모든 버전이 함께 숨는다
//   · 3D 위 머리줄의 [숨김 n] 에서 하나씩 다시 켜거나 모두 켠다
//   · 보이는 것만 바꾼다. 수량 · 변경 집계 · AI 에 보내는 숫자와 화면은 그대로다
// ─────────────────────────────────────────────────────────────────────────────
import { store, emit, catInfo, levelOf, baseId, escapeHtml, onProjectReset } from "./store.js";
import { icon } from "./icons.js";

const hidden = new Set();   // 숨긴 요소의 기본 ID
let ui = null;
let off = [];

onProjectReset(() => {
    hidden.clear();
    off.forEach((f) => f());
    off = [];
    ui = null;
});

export function isHidden(base) { return hidden.has(String(base)); }
export function hiddenCount() { return hidden.size; }

function versionsOf(base) {
    return store.allGroup.filter((g) => baseId(g.name) === String(base));
}

function apply(base, hide) {
    for (const g of versionsOf(base)) {
        if (!g.userData) g.userData = {};
        g.userData.visible = hide ? false : undefined;
    }
    if (hide) hidden.add(String(base)); else hidden.delete(String(base));
}

function finish() {
    emit("visibility");
    renderUi();
}

export function hideElement(base) {
    if (base == null) return;
    apply(base, true);
    finish();
}

export function showElement(base) {
    apply(base, false);
    finish();
}

export function toggleElement(base) {
    if (isHidden(base)) showElement(base); else hideElement(base);
}

export function showAll() {
    for (const base of [...hidden]) apply(base, false);
    finish();
}

function describe(base) {
    // 가장 최근 버전의 정보로 이름표를 만든다
    const g = versionsOf(base).slice(-1)[0];
    const c = g?.userData?.Common || {};
    return {
        cat: catInfo(c.ElementCategory),
        type: c.ElementType || c.ElementFamily || "",
        level: g ? levelOf(g.userData).name : "",
    };
}

function renderUi() {
    if (!ui) return;
    const n = hidden.size;
    ui.btn.hidden = n === 0;
    ui.count.textContent = String(n);
    if (n === 0) ui.pop.hidden = true;
    if (ui.pop.hidden) return;
    const rows = [...hidden].map((base) => {
        const d = describe(base);
        return `<li class="hide-pop__row">
            <i class="dot" style="--c:${d.cat.color}"></i>
            <span class="hide-pop__text"><b>${escapeHtml(d.cat.label)}<span>${escapeHtml(d.type)}</span></b><em>${escapeHtml(d.level)} · #${escapeHtml(base)}</em></span>
            <button class="btn btn--ghost btn--icon btn--sm" type="button" data-show="${escapeHtml(base)}" title="다시 보이기" aria-label="다시 보이기">${icon("eye", 15)}</button>
        </li>`;
    }).join("");
    ui.list.innerHTML = rows;
}

/** 머리줄 버튼 · 목록 창 · H 키를 붙인다(뷰어를 다시 불러올 때마다 한 번) */
export function initHideElements(getSelectedBase) {
    off.forEach((f) => f());
    off = [];
    const btn = document.getElementById("hide-toggle");
    const pop = document.getElementById("hide-pop");
    if (!btn || !pop) return;
    ui = { btn, pop, count: btn.querySelector("[data-hide-count]"), list: pop.querySelector("[data-hide-list]") };

    const onBtn = () => { pop.hidden = !pop.hidden; btn.setAttribute("aria-expanded", String(!pop.hidden)); renderUi(); };
    const onPop = (e) => {
        const one = e.target.closest("[data-show]");
        if (one) showElement(one.dataset.show);
        else if (e.target.closest("[data-show-all]")) showAll();
        else if (e.target.closest("[data-close]")) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    };
    const onKey = (e) => {
        if (e.key !== "h" && e.key !== "H") return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const t = e.target;
        if (t?.closest?.("input, textarea, select, [contenteditable]")) return;
        const base = getSelectedBase?.();
        if (base == null) return;
        e.preventDefault();
        hideElement(base);
    };
    btn.addEventListener("click", onBtn);
    pop.addEventListener("click", onPop);
    window.addEventListener("keydown", onKey);
    off.push(() => btn.removeEventListener("click", onBtn));
    off.push(() => pop.removeEventListener("click", onPop));
    off.push(() => window.removeEventListener("keydown", onKey));
    renderUi();
}
