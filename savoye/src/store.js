// ─────────────────────────────────────────────────────────────────────────────
// 뷰어 공용 상태 · 이벤트 · 유틸
//
// 타임라인(slider.js) · 요소 선택(clickEvent.js) · 탭(rightPanelButton.js) ·
// 핀(pins.js) · 분할 비교(compare.js) · 녹음(recording.js)이 이 모듈 하나를 통해
// 상태를 공유하고 이벤트로 서로를 갱신한다(서로 직접 import 하지 않아도 되게).
//
// 이벤트
//   data         로그 로드 완료(timeKeys/allGroup/levels 준비됨)
//   time:main    메인(오른쪽) 뷰어 시점 변경 → index
//   filters      층 · 카테고리 필터 변경 → 두 뷰어 가시성 + 비교 재계산
//   visibility   가시성만 다시 적용(비교의 '변경 요소만' 등)
//   tab          우측 탭 변경 → name
//   split        분할 비교 켜짐/꺼짐 → boolean
//   pins         핀 목록 로드 → pins[]
//   recordings   녹음 목록 로드 → recordings[]
// ─────────────────────────────────────────────────────────────────────────────

// ?lab=1 — 연구 · 개발용 실험 기능을 함께 연다(요약 평가 하네스, 프로젝트 진행 서술, 보고서 · 백업,
// 녹음 전사 · 요약, 비교 탭 AI 요약). 평소 화면에서는 숨긴다. 자체 점검(?selftest=ai)은 늘 켠다.
export const LAB = (() => {
    try {
        const p = new URLSearchParams(location.search);
        return p.get("lab") === "1" || p.get("selftest") === "ai";
    } catch { return false; }
})();

export const store = {
    shapeLog: null,
    timeLog: null,
    timeKeys: [],
    keyMs: [],
    allGroup: [],
    meshDict: {},
    viewer: null,          // 메인 뷰어 { renderer, scene, camera, controls, container }

    levels: [],            // [{ key, name, elev }] 낮은 층 → 높은 층
    levelFilter: null,     // 선택한 층 key (null = 전체)
    hiddenCats: new Set(), // 숨긴 카테고리
    isolateMain: null,     // Set<ElementId> | null — 비교의 '변경 요소만'

    mainIndex: 0,
    tab: "quant",
    split: false,
    pins: [],
    recordings: [],

    // 각 모듈이 채우는 동작
    setMainIndex: null,
    setLevelFilter: null,
    setTab: null,
    openSplit: null,
    closeSplit: null,
    playRecording: null,
};

const listeners = new Map();

// ── 다시 불러오기(다른 폴더 열기) ────────────────────────────────────────────
// main() 은 두 번째 호출부터 이전 로드를 정리하고 다시 그린다(main.js 의 __fvCleanup).
// 프로젝트에 매인 것 — 캐시, 그 데이터를 붙잡고 있는 리스너 — 은 여기에 등록해 두면
// 다음 프로젝트를 그리기 직전에 함께 정리된다. 등록은 모듈마다 한 번이면 된다.
const resetHandlers = [];

export function onProjectReset(fn) {
    if (typeof fn === "function") resetHandlers.push(fn);
}

export function resetProject() {
    for (const fn of resetHandlers) {
        try { fn(); } catch (e) { console.warn("[store] 프로젝트 정리 중 오류", e); }
    }
}

export function on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt)?.delete(fn);
}

export function emit(evt, payload) {
    for (const fn of listeners.get(evt) || []) {
        try { fn(payload); } catch (e) { console.error(`[store] ${evt} handler failed`, e); }
    }
}

// ── 카테고리 ─────────────────────────────────────────────────────────────────
export const CATEGORIES = [
    { key: "Walls", label: "벽", id: "wall-select", color: "#3b82f6" },
    { key: "Curtain Walls", label: "커튼월", id: "curtainWall-select", color: "#06b6d4" },
    { key: "Floors", label: "바닥", id: "floor-select", color: "#f59e0b" },
    { key: "Ceilings", label: "천장", id: "ceiling-select", color: "#94a3b8" },
    { key: "Roofs", label: "지붕", id: "roof-select", color: "#ef4444" },
    { key: "Columns", label: "기둥", id: "column-select", color: "#a855f7" },
    { key: "Structural Columns", label: "구조 기둥", id: "structuralColumn-select", color: "#ec4899" },
    { key: "Stairs", label: "계단", id: "stair-select", color: "#10b981" },
    { key: "Railings", label: "난간", id: "railing-select", color: "#84cc16" },
    { key: "Windows", label: "창", id: "window-select", color: "#0ea5e9" },
    { key: "Doors", label: "문", id: "door-select", color: "#f97316" },
    { key: "Furniture", label: "가구", id: "furniture-select", color: "#eab308" },
];
const CAT_BY_KEY = new Map(CATEGORIES.map((c, i) => [c.key, { ...c, order: i }]));

export function catInfo(key) {
    return CAT_BY_KEY.get(key) || { key, label: key || "기타", color: "#9ca3af", order: 999 };
}

// ── 시간 ─────────────────────────────────────────────────────────────────────
// "yyyy_MM_dd_HH_mm_ss" → ms
export function keyToMs(k) {
    const p = String(k || "").split("_");
    if (p.length < 6) return NaN;
    return new Date(+p[0], +p[1] - 1, +p[2], +p[3], +p[4], +p[5]).getTime();
}

export function formatKey(k) {
    const p = String(k || "").split("_");
    if (p.length < 6) return { date: "—", time: "—", short: "—" };
    return {
        date: `${p[0]}.${p[1]}.${p[2]}`,
        time: `${p[3]}:${p[4]}:${p[5]}`,
        short: `${p[1]}.${p[2]} ${p[3]}:${p[4]}`,
    };
}

// ms 이하의 가장 최근 timeKey 인덱스 (첫 키보다 이르면 0)
export function indexAtOrBefore(ms) {
    const a = store.keyMs;
    if (!a.length || !(ms >= a[0])) return 0;
    let lo = 0, hi = a.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (a[mid] <= ms) lo = mid; else hi = mid - 1;
    }
    return lo;
}

// "317173_2" → "317173" (요소 버전 번호를 뗀 기본 ID)
export const baseId = (id) => String(id).split("_")[0];

// ── 층 ───────────────────────────────────────────────────────────────────────
// 새 로그는 Common.LevelId/LevelName/LevelElevation 을 갖고, 예전 로그는
// 카테고리마다 다른 파라미터에 층이 들어 있다 → 둘 다 읽어 하나로 통일.
// 예전 로그의 파라미터 Value 는 층 ID가 아닌 경우가 있어(지붕·구조 기둥 등) 층은 "이름"으로 묶는다.
// (한 프로젝트 안에서 층 이름은 유일하다)
const LEVEL_PARAMS = [
    "WALL_BASE_CONSTRAINT", "LEVEL_PARAM", "FAMILY_LEVEL_PARAM", "SCHEDULE_LEVEL_PARAM",
    "SCHEDULE_BASE_LEVEL_PARAM", "FAMILY_BASE_LEVEL_PARAM", "ROOF_BASE_LEVEL_PARAM",
    "STAIRS_BASE_LEVEL_PARAM", "STAIRS_RAILING_BASE_LEVEL_PARAM", "INSTANCE_REFERENCE_LEVEL_PARAM",
];
const INVALID_LEVEL_NAMES = new Set(["", "None", "Default", "<None>", "없음"]);
const NO_LEVEL = { key: "__none", name: "층 미지정", elev: null };
const levelCache = new WeakMap();

export function levelOf(info) {
    if (!info || typeof info !== "object") return NO_LEVEL;
    const cached = levelCache.get(info);
    if (cached) return cached;

    let lv = NO_LEVEL;
    const c = info.Common || {};
    if (c.LevelName) {
        lv = {
            key: String(c.LevelName),
            name: c.LevelName,
            elev: typeof c.LevelElevation === "number" ? c.LevelElevation : null,
        };
    } else {
        const p = info.Parameter || {};
        for (const k of LEVEL_PARAMS) {
            const v = p[k];
            const name = typeof v?.ValueString === "string" ? v.ValueString.trim() : "";
            if (!INVALID_LEVEL_NAMES.has(name)) {
                lv = { key: name, name, elev: null };
                break;
            }
        }
    }
    levelCache.set(info, lv);
    return lv;
}

export function buildLevels(groups) {
    const map = new Map();
    for (const g of groups) {
        const lv = levelOf(g.userData);
        const prev = map.get(lv.key);
        if (!prev || (prev.elev == null && lv.elev != null)) map.set(lv.key, lv);
    }
    const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
    return [...map.values()].sort((a, b) => {
        if (a.key === "__none") return 1;
        if (b.key === "__none") return -1;
        if (a.elev != null && b.elev != null && a.elev !== b.elev) return a.elev - b.elev;
        return collator.compare(a.name, b.name);
    });
}

// 층 · 카테고리 필터 통과 여부 (두 뷰어와 비교 집계가 같은 기준을 쓴다)
export function passesFilters(group) {
    const info = group?.userData;
    if (store.hiddenCats.has(info?.Common?.ElementCategory)) return false;
    if (store.levelFilter && levelOf(info).key !== store.levelFilter) return false;
    return true;
}

// ── 표시 유틸 ────────────────────────────────────────────────────────────────
export function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (ch) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
    ));
}

const nf2 = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
export function fmtNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? nf2.format(n) : "—";
}

// ── 툴팁 (패널 밖으로 넘어가도 잘리지 않게 body 에 고정 위치로 띄운다) ────────
let tipEl = null;

export function showTip(anchor, html) {
    if (!tipEl) {
        tipEl = document.createElement("div");
        tipEl.className = "abl-tip";
        document.body.appendChild(tipEl);
    }
    tipEl.innerHTML = html;
    tipEl.classList.add("is-on");
    const r = anchor.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    const x = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
    const above = r.top - t.height - 10;
    const y = above > 8 ? above : r.bottom + 10;
    tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function hideTip() {
    tipEl?.classList.remove("is-on");
}

/**
 * 곁다리 파일(핀 · 녹음 매니페스트)을 읽는다. 로그를 보내느라 서버가 바쁠 때 한 번 끊겨도
 * 조용히 "없음"이 되지 않도록 잠깐 쉬고 다시 시도한다. 파일이 없으면(404 등) 바로 null.
 */
export async function fetchJsonRetry(url, { tries = 3, delays = [500, 1500] } = {}) {
    for (let i = 0; i < tries; i++) {
        try {
            const r = await fetch(url, { cache: "no-store" });
            if (r.ok) return await r.json();
            if (r.status < 500) return null;
        } catch { /* 네트워크 끊김 → 다시 */ }
        if (i < tries - 1) await new Promise((res) => setTimeout(res, delays[i] ?? 1500));
    }
    return null;
}
