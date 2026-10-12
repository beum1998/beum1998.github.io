// ─────────────────────────────────────────────────────────────────────────────
// 우측 탭: 수량 · 차트 · 요소 · 녹음 · 핀 · 비교
//
// 비교 탭과 분할 비교는 항상 함께 움직인다:
//   비교 탭 열기 → 분할 켜짐 / 다른 탭으로 이동하거나 비교 탭을 다시 누름 → 분할 꺼짐
//   분할이 다른 곳(뷰어의 [비교] 버튼, 핀의 "이전 핀과 비교")에서 켜지면 비교 탭이 열린다.
// ─────────────────────────────────────────────────────────────────────────────

import { store, emit, on } from "./store.js";
import { swapIn } from "./motion.js";

const TABS = {
    quant: ["quant-button", "info-divs"],
    chart: ["chart-button", "chart-divs"],
    info: ["info-button", "element-divs"],
    record: ["record-button", "record-divs"],
    pins: ["pins-button", "pins-divs"],
    compare: ["compare-button", "compare-divs"],
};

let prevTab = "quant";

export function rightPanelButtonClick() {
    if (window.__ablTabsInit) return;
    window.__ablTabsInit = true;

    for (const [name, [btnId]] of Object.entries(TABS)) {
        document.getElementById(btnId)?.addEventListener("click", () => {
            if (name === "compare" && store.tab === "compare") {
                store.closeSplit?.();   // 열린 비교 탭을 다시 누르면 닫기
                return;
            }
            setTab(name);
        });
    }

    store.setTab = setTab;

    on("split", (open) => {
        if (open && store.tab !== "compare") setTab("compare");
        else if (!open && store.tab === "compare") setTab(prevTab);
    });

    setTab(store.tab || "quant", true);
}

export function setTab(name, force = false) {
    if (!TABS[name]) return;
    if (!force && store.tab === name) return;
    if (store.tab && store.tab !== name && store.tab !== "compare") prevTab = store.tab;
    store.tab = name;

    for (const [n, [btnId, divId]] of Object.entries(TABS)) {
        const on = n === name;
        const btn = document.getElementById(btnId);
        btn?.classList.toggle("active", on);
        btn?.setAttribute("aria-selected", String(on));
        const div = document.getElementById(divId);
        div?.classList.toggle("hide", !on);
        if (on && !force) swapIn(div);
    }
    emit("tab", name);

    if (name === "compare" && !store.split) store.openSplit?.();
    else if (name !== "compare" && store.split) store.closeSplit?.();
}
