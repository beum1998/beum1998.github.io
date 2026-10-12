// ─────────────────────────────────────────────────────────────────────────────
// 카테고리 물량을 요소 목록에서 직접 계산 (층별 물량)
//
// 전처리(애드인 postprocessing.cs)는 시점마다 모델 전체의 카테고리 물량을 미리 계산해
// timeLog[key].Quantity 로 넘긴다. 층 하나의 물량은 거기에 없으므로, 같은 규칙으로
// 요소마다 더해 만든다 — 규칙이 같아야 층별 물량을 모두 더한 값이 전처리 물량과 맞는다.
//
//   벽 · 바닥 · 천장   Layers[] 의 재료 체적 합(재료별로도) · 바닥 · 천장은 개수도
//   커튼월 · 창 · 문   개수(창 · 문은 패밀리+타입별로도)
//   기둥              개수 · Column Length · Column Volume
//   구조 기둥          개수 · 길이(재료별로도)
//   계단              개수 · 길이 · 경사부 길이 · 계단참 길이
//   난간              개수 · 길이
// 지붕 · 가구는 전처리에도 물량이 없다.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = {
    "Walls": ["All Volume"],
    "Curtain Walls": ["All Numbers"],
    "Floors": ["All Numbers", "All Volume"],
    "Ceilings": ["All Numbers", "All Volume"],
    "Columns": ["All Numbers", "Column Length", "Column Volume"],
    "Structural Columns": ["All Numbers", "All Length"],
    "Stairs": ["All Numbers", "Stair Length", "Stair Run Length", "Stair Landing Length"],
    "Railings": ["All Numbers", "Railing Length"],
    "Windows": ["All Numbers"],
    "Doors": ["All Numbers"],
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * 요소(userData) 목록의 카테고리 물량. 전처리 Quantity 와 같은 모양
 * ({ 카테고리: { 지표 | 재료 | 패밀리+타입: 값 } }, 큰 값부터)이며,
 * 요소가 하나도 없는 카테고리와 0 인 재료 · 타입 항목은 뺀다.
 * @param {Iterable<object>} infos  요소 userData (Common · Layers)
 */
export function quantityOf(infos) {
    const q = {};
    const add = (cat, key, v) => { q[cat][key] = (q[cat][key] || 0) + v; };

    for (const info of infos) {
        const cat = info?.Common?.ElementCategory;
        if (!BASE[cat]) continue;
        if (!q[cat]) q[cat] = Object.fromEntries(BASE[cat].map((k) => [k, 0]));
        const L = info.Layers;

        switch (cat) {
            case "Walls":
            case "Floors":
            case "Ceilings":
                if (cat !== "Walls") add(cat, "All Numbers", 1);
                for (const layer of Array.isArray(L) ? L : []) {
                    const v = num(layer?.["Material Volume"]);
                    add(cat, "All Volume", v);
                    if (layer?.["Material Name"] != null) add(cat, String(layer["Material Name"]), v);
                }
                break;
            case "Curtain Walls":
                add(cat, "All Numbers", 1);
                break;
            case "Columns":
                add(cat, "All Numbers", 1);
                add(cat, "Column Length", num(L?.["Column Length"]));
                add(cat, "Column Volume", num(L?.["Column Volume"]));
                break;
            case "Structural Columns":
                add(cat, "All Numbers", 1);
                add(cat, "All Length", num(L?.["Column Length"]));
                if (L?.["Column Material"] != null) add(cat, String(L["Column Material"]), num(L["Column Length"]));
                break;
            case "Stairs":
                add(cat, "All Numbers", 1);
                for (const k of ["Stair Length", "Stair Run Length", "Stair Landing Length"]) add(cat, k, num(L?.[k]));
                break;
            case "Railings":
                add(cat, "All Numbers", 1);
                add(cat, "Railing Length", num(L?.["Railing Length"]));
                break;
            case "Windows":
            case "Doors":
                add(cat, "All Numbers", 1);
                add(cat, `${info.Common.ElementFamily ?? ""}${info.Common.ElementType ?? ""}`, 1);
                break;
        }
    }

    for (const cat of Object.keys(q)) {
        const base = new Set(BASE[cat]);
        q[cat] = Object.fromEntries(Object.entries(q[cat])
            .filter(([k, v]) => base.has(k) || Math.abs(v) > 1e-9)
            .sort((a, b) => b[1] - a[1]));
    }
    return q;
}
