// ─────────────────────────────────────────────────────────────────────────────
// 무엇이 바뀌었나 (Change explanations)
//
// 같은 요소의 두 버전(요소ID_n → 요소ID_m)을 비교해, 사람이 읽는 변경 문장으로 바꾼다.
//
//   파라미터   높이 3,000 → 3,200 mm (+200)     ← ValueString(프로젝트 표시 단위) 기준
//   타입       타입 교체: 기본 벽 200mm → 기본 벽 250mm
//   형상       이동 1.20 m (북동) · 회전 12° · 윤곽 변경   ← 좌표는 Revit 내부 단위(피트)
//   속성       좌우 뒤집기
//   재료 층    재료 교체(마감 2): Roofing, Standing Seam → Roofing, Tile
//
// 파라미터 중 다른 값의 결과인 것(면적 · 체적 · 둘레 · 고도)은 "결과로 바뀐 값"으로 따로 둔다.
// 기록된 값이 하나도 안 바뀐 버전 변경은 "함께 갱신"으로 분류한다 — 데모 데이터에서 수정의 약 4할이
// 이런 갱신(붙어 있는 벽이 바뀌며 창 · 커튼월이 함께 갱신되는 경우 등)이라, 수정으로 세면 과장된다.
//
// 문장은 모두 코드가 만든다. AI 는 이 문장을 인용만 한다.
// ─────────────────────────────────────────────────────────────────────────────

import { store, baseId, catInfo, levelOf, onProjectReset } from "./store.js";
import { analyzeRework } from "./rework.js";

const FT_TO_MM = 304.8;
const MOVE_EPS_MM = 1;          // 1mm 미만 이동은 부동소수 잡음
const ANGLE_EPS_DEG = 0.5;

// ── 이름표 ──────────────────────────────────────────────────────────────────
const LABELS = {
    WALL_USER_HEIGHT_PARAM: "높이",
    WALL_BASE_OFFSET: "하단 간격띄우기",
    WALL_TOP_OFFSET: "상단 간격띄우기",
    WALL_BASE_CONSTRAINT: "하단 구속",
    WALL_HEIGHT_TYPE: "상단 구속",
    WALL_TOP_IS_ATTACHED: "상단 부착",
    WALL_BOTTOM_IS_ATTACHED: "하단 부착",
    WALL_STRUCTURAL_SIGNIFICANT: "구조 벽",
    WALL_STRUCTURAL_USAGE_PARAM: "구조 용도",
    WALL_BOTTOM_EXTENSION_DIST_PARAM: "하단 확장",
    WALL_TOP_EXTENSION_DIST_PARAM: "상단 확장",
    CURVE_ELEM_LENGTH: "길이",
    ELEM_TYPE_PARAM: "타입",
    ELEM_FAMILY_PARAM: "패밀리",
    FAMILY_TOP_LEVEL_PARAM: "상단 층",
    FAMILY_TOP_LEVEL_OFFSET_PARAM: "상단 간격띄우기",
    FAMILY_BASE_LEVEL_PARAM: "하단 층",
    FAMILY_BASE_LEVEL_OFFSET_PARAM: "하단 간격띄우기",
    FAMILY_LEVEL_PARAM: "층",
    LEVEL_PARAM: "층",
    COLUMN_TOP_ATTACHED_PARAM: "상단 부착",
    COLUMN_TOP_ATTACHMENT_OFFSET_PARAM: "부착 간격띄우기",
    COLUMN_TOP_ATTACH_JUSTIFICATION_PARAM: "부착 기준",
    SLANTED_COLUMN_TYPE_PARAM: "기울기 형식",
    STRUCTURAL_MATERIAL_PARAM: "구조 재료",
    INSTANCE_HEAD_HEIGHT_PARAM: "머리 높이",
    INSTANCE_SILL_HEIGHT_PARAM: "씰 높이",
    INSTANCE_LENGTH_PARAM: "길이",
    INSTANCE_ELEVATION_PARAM: "고도",
    INSTANCE_FREE_HOST_PARAM: "호스트",
    INSTANCE_FREE_HOST_OFFSET_PARAM: "호스트 간격띄우기",
    SPACING_NUM_DIVISIONS_VERT: "세로 분할 수",
    SPACING_NUM_DIVISIONS_HORIZ: "가로 분할 수",
    SPACING_JUSTIFICATION_VERT: "세로 분할 정렬",
    SPACING_JUSTIFICATION_HORIZ: "가로 분할 정렬",
    CURTAINGRID_ANGLE_VERT: "세로 그리드 각도",
    CURTAINGRID_ANGLE_HORIZ: "가로 그리드 각도",
    CURTAINGRID_ORIGIN_VERT: "세로 그리드 원점",
    CURTAINGRID_ORIGIN_HORIZ: "가로 그리드 원점",
    FLOOR_ATTR_THICKNESS_PARAM: "두께",
    FLOOR_HEIGHTABOVELEVEL_PARAM: "층 기준 높이",
    FLOOR_PARAM_IS_STRUCTURAL: "구조 바닥",
    STRUCTURAL_FLOOR_CORE_THICKNESS: "코어 두께",
    CEILING_HEIGHTABOVELEVEL_PARAM: "층 기준 높이",
    ROOF_ATTR_THICKNESS_PARAM: "두께",
    ROOF_BASE_LEVEL_PARAM: "기준 층",
    ROOF_LEVEL_OFFSET_PARAM: "기준 층 간격띄우기",
    ROOF_UPTO_LEVEL_PARAM: "최상단 층",
    ROOF_UPTO_LEVEL_OFFSET_PARAM: "최상단 간격띄우기",
    ROOF_SLOPE: "경사",
    ROOF_EAVE_CUT_PARAM: "처마 절단",
    FASCIA_DEPTH_PARAM: "처마 깊이",
    ROOF_RAFTER_OR_TRUSS_PARAM: "서까래/트러스",
    FACEROOF_LEVEL_PARAM: "층",
    FACEROOF_OFFSET_PARAM: "간격띄우기",
    STAIRS_BASE_LEVEL_PARAM: "하단 층",
    STAIRS_TOP_LEVEL_PARAM: "상단 층",
    STAIRS_BASE_OFFSET: "하단 간격띄우기",
    STAIRS_TOP_OFFSET: "상단 간격띄우기",
    STAIRS_DESIRED_NUMBER_OF_RISERS: "챌면 수(목표)",
    STAIRS_ACTUAL_NUM_RISERS: "챌면 수",
    STAIRS_ACTUAL_RISER_HEIGHT: "챌면 높이",
    STAIRS_ACTUAL_TREAD_DEPTH: "디딤판 깊이",
    STAIRS_STAIRS_HEIGHT: "계단 높이",
    STAIRS_RAILING_BASE_LEVEL_PARAM: "기준 층",
    STAIRS_RAILING_HEIGHT_OFFSET: "높이 간격띄우기",
    STAIRS_RAILING_PLACEMENT_OFFSET: "배치 간격띄우기",
    CLEAR_COVER_TOP: "피복(상단)",
    CLEAR_COVER_BOTTOM: "피복(하단)",
    CLEAR_COVER_OTHER: "피복(기타)",
    CLEAR_COVER_INTERIOR: "피복(내부)",
    CLEAR_COVER_EXTERIOR: "피복(외부)",
};

/** 다른 값의 결과로 바뀌는 파라미터 */
const DERIVED = {
    HOST_VOLUME_COMPUTED: "체적",
    HOST_AREA_COMPUTED: "면적",
    HOST_PERIMETER_COMPUTED: "둘레",
    ACTUAL_MAX_RIDGE_HEIGHT_PARAM: "최고 용마루 높이",
    STRUCTURAL_ELEVATION_AT_TOP: "상단 고도",
    STRUCTURAL_ELEVATION_AT_BOTTOM: "하단 고도",
    STRUCTURAL_ELEVATION_AT_TOP_CORE: "코어 상단 고도",
    STRUCTURAL_ELEVATION_AT_BOTTOM_CORE: "코어 하단 고도",
    STRUCTURAL_ELEVATION_AT_TOP_SURVEY: "상단 고도(측량)",
    STRUCTURAL_ELEVATION_AT_BOTTOM_SURVEY: "하단 고도(측량)",
};

/** 새로 생기거나 사라져도 그 자체가 의미 있는 값 (나머지는 다른 변경에 딸린 값으로 본다) */
const PRESENCE_MATTERS = new Set(["WALL_TOP_IS_ATTACHED", "WALL_BOTTOM_IS_ATTACHED", "COLUMN_TOP_ATTACHED_PARAM", "INSTANCE_FREE_HOST_PARAM"]);

/** 이름표만 다른 중복(일정표용) · 식별자 · 다른 곳에서 다루는 값 */
const SKIP = new Set([
    "ELEM_CATEGORY_PARAM", "ELEM_CATEGORY_PARAM_MT", "ELEM_FAMILY_AND_TYPE_PARAM", "SYMBOL_ID_PARAM", "HOST_ID_PARAM",
    "SCHEDULE_LEVEL_PARAM", "SCHEDULE_BASE_LEVEL_PARAM", "SCHEDULE_TOP_LEVEL_PARAM",
    "SCHEDULE_BASE_LEVEL_OFFSET_PARAM", "SCHEDULE_TOP_LEVEL_OFFSET_PARAM",
]);

const LAYER_FUNCTION = {
    Structure: "구조", Substrate: "하지", Insulation: "단열", Finish1: "마감 1", Finish2: "마감 2",
    Membrane: "멤브레인", StructuralDeck: "구조 데크",
};

const PROPERTY_LABELS = { Flipped: "방향 뒤집기", FlipFacing: "앞뒤 뒤집기", FlipHand: "좌우 뒤집기" };

export function paramLabel(key) {
    return LABELS[key] || DERIVED[key] || prettyKey(key);
}

function prettyKey(k) {
    if (!/^[A-Z0-9_]+$/.test(k)) return k;
    return k.toLowerCase().split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// ── 값 다루기 ───────────────────────────────────────────────────────────────
const nf0 = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

/** ValueString 에서 숫자와 단위를 뽑는다. 길이는 내부 값(피트)과 대조해 mm 를 붙인다. */
function readValue(p) {
    if (p == null) return { text: "—", num: null, unit: "" };
    const text = String(p.ValueString ?? p.Value ?? "").trim().replace(/^(\d+) \. /, "$1. ");
    if (!text) return { text: "—", num: null, unit: "" };
    if (/^(yes|예)$/i.test(text)) return { text: "예", num: null, unit: "", bool: true };
    if (/^(no|아니요|아니오)$/i.test(text)) return { text: "아니오", num: null, unit: "", bool: false };
    const m = text.replace(/,/g, "").match(/^(-?\d+(?:\.\d+)?)\s*([^\d\s].*)?$/);
    if (!m) return { text, num: null, unit: "" };
    const num = Number(m[1]);
    let unit = (m[2] || "").trim();
    if (!unit && p.StorageType === "Double" && Number.isFinite(p.Value) && Math.abs(p.Value * FT_TO_MM - num) <= 1.5) unit = "mm";
    return { text: unit ? `${fmtNum(num)} ${unit}` : fmtNum(num), num, unit };
}

function fmtNum(n) {
    const s = Math.abs(n) >= 100 || Number.isInteger(n) ? nf0.format(n) : nf2.format(n);
    return s.replace(/^-/, "−");   // 증감 표시와 같은 빼기 기호
}

function signed(n, unit) {
    const s = n > 0 ? "+" : n < 0 ? "−" : "±";
    return `${s}${fmtNum(Math.abs(n))}${unit ? ` ${unit}` : ""}`;
}

// ── 형상 ─────────────────────────────────────────────────────────────────────
function points(obj, out = []) {
    if (!obj || typeof obj !== "object") return out;
    if (Number.isFinite(obj.X) && Number.isFinite(obj.Y)) { out.push(obj); return out; }
    for (const v of Array.isArray(obj) ? obj : Object.values(obj)) points(v, out);
    return out;
}

function dist(a, b) {
    return Math.hypot((b.X - a.X), (b.Y - a.Y), ((b.Z || 0) - (a.Z || 0)));
}

/** 평면 이동 방향 (+Y = 북, +X = 동; Revit 프로젝트 북 기준) */
export function direction(dx, dy) {
    if (Math.hypot(dx, dy) < 1e-9) return "";
    const names = ["동", "북동", "북", "북서", "서", "남서", "남", "남동"];
    const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    return names[Math.round(deg / 45) % 8];
}

function fmtLength(ft) {
    const mm = Math.abs(ft) * FT_TO_MM;
    return mm >= 1000 ? `${nf2.format(mm / 1000)} m` : `${nf0.format(mm)} mm`;
}

function geometryItems(ga = {}, gb = {}) {
    const items = [];
    const keys = new Set([...Object.keys(ga), ...Object.keys(gb)]);
    for (const key of keys) {
        const a = ga[key], b = gb[key];
        if (JSON.stringify(a) === JSON.stringify(b)) continue;

        if (key === "Curve" && a?.endPoints?.length === 2 && b?.endPoints?.length === 2) {
            let [a0, a1] = a.endPoints, [b0, b1] = b.endPoints;
            if (dist(a0, b0) + dist(a1, b1) > dist(a0, b1) + dist(a1, b0)) [b0, b1] = [b1, b0];   // 끝점 순서가 뒤집힌 경우
            const d0 = dist(a0, b0) * FT_TO_MM, d1 = dist(a1, b1) * FT_TO_MM;
            const angA = Math.atan2(a1.Y - a0.Y, a1.X - a0.X), angB = Math.atan2(b1.Y - b0.Y, b1.X - b0.X);
            let dAng = Math.abs((angB - angA) * 180 / Math.PI) % 180;
            if (dAng > 90) dAng = 180 - dAng;
            const parts = [];
            if (dAng > ANGLE_EPS_DEG) parts.push(`회전 ${nf0.format(dAng)}°`);
            if (d0 > MOVE_EPS_MM && d1 > MOVE_EPS_MM && Math.abs(d0 - d1) < MOVE_EPS_MM * 2 && dAng <= ANGLE_EPS_DEG) {
                parts.push(`이동 ${fmtLength(dist(a0, b0))} (${direction(b0.X - a0.X, b0.Y - a0.Y)})`);
            } else if (d0 > MOVE_EPS_MM || d1 > MOVE_EPS_MM) {
                if (d0 <= MOVE_EPS_MM || d1 <= MOVE_EPS_MM) parts.push("한쪽 끝 이동");
                else if (!parts.length) parts.push("양 끝 이동");
            }
            if (parts.length) items.push({ kind: "geom", key, label: "위치", text: parts.join(" · "), group: parts.some((p) => p.startsWith("회전")) ? "회전" : "이동" });
            continue;
        }

        if (key === "Location") {
            const pa = points(a)[0], pb = points(b)[0];
            if (pa && pb) {
                const d = dist(pa, pb) * FT_TO_MM;
                if (d > MOVE_EPS_MM) {
                    const dz = ((pb.Z || 0) - (pa.Z || 0));
                    const flat = Math.hypot(pb.X - pa.X, pb.Y - pa.Y);
                    const text = flat * FT_TO_MM > MOVE_EPS_MM
                        ? `이동 ${fmtLength(Math.hypot(pb.X - pa.X, pb.Y - pa.Y, dz))} (${direction(pb.X - pa.X, pb.Y - pa.Y)})`
                        : `높이 방향 이동 ${signed(dz * FT_TO_MM, "mm")}`;
                    items.push({ kind: "geom", key, label: "위치", text, group: "이동" });
                }
            }
            continue;
        }

        if (key === "HostId") {
            items.push({ kind: "geom", key, label: "호스트", text: `호스트 변경 #${a ?? "—"} → #${b ?? "—"}`, group: "호스트 변경" });
            continue;
        }
        if (key === "Profile" || key === "FootPrint") {
            items.push({ kind: "geom", key, label: "윤곽", text: "윤곽 변경", group: "윤곽 변경" });
            continue;
        }
        if (key === "SlopeArrow" || key === "SlopeAngle") {
            if (!items.some((i) => i.key === "Slope")) items.push({ kind: "geom", key: "Slope", label: "경사", text: "경사 변경", group: "경사 변경" });
            continue;
        }
        if (key === "SpanDirection") {
            items.push({ kind: "geom", key, label: "스팬 방향", text: "스팬 방향 변경", group: "스팬 방향 변경" });
            continue;
        }
        if (key === "Level") {
            items.push({ kind: "geom", key, label: "층", before: String(a ?? "—"), after: String(b ?? "—"), text: `층 ${a ?? "—"} → ${b ?? "—"}`, group: "층 이동" });
            continue;
        }
        if (key === "IsProfileWall") {
            items.push({ kind: "geom", key, label: "프로파일 편집", text: b ? "프로파일 편집 벽으로" : "프로파일 편집 해제", group: "윤곽 변경" });
            continue;
        }
        const name = key === "Curve" ? "선 형태" : prettyKey(key);
        items.push({ kind: "geom", key, label: name, text: `${name} 변경`, group: "형상 변경" });
    }
    return items;
}

function layerItems(la, lb) {
    const a = Array.isArray(la) ? la : [], b = Array.isArray(lb) ? lb : [];
    if (JSON.stringify(a) === JSON.stringify(b)) return { items: [], derived: [] };
    const items = [], derived = [];
    if (a.length !== b.length) {
        items.push({ kind: "layer", key: "Layers", label: "재료 층", before: String(a.length), after: String(b.length), text: `재료 층 ${a.length} → ${b.length}개`, group: "재료 교체" });
    }
    const n = Math.min(a.length, b.length);
    let volumeChanged = false;
    for (let i = 0; i < n; i++) {
        const nameA = a[i]?.["Material Name"], nameB = b[i]?.["Material Name"];
        const fn = LAYER_FUNCTION[b[i]?.Function] || b[i]?.Function || `${i + 1}층`;
        if (nameA !== nameB) {
            items.push({ kind: "layer", key: `Layers.${i}`, label: `재료(${fn})`, before: nameA || "—", after: nameB || "—", text: `재료 교체(${fn}): ${nameA || "—"} → ${nameB || "—"}`, group: "재료 교체" });
        } else if (a[i]?.["Material Volume"] !== b[i]?.["Material Volume"]) {
            volumeChanged = true;
        }
    }
    if (volumeChanged) derived.push({ kind: "layer", key: "Layers.volume", label: "재료 체적", text: "재료 체적 변화", group: "재료 체적" });
    return { items, derived };
}

// ── 두 버전 비교 ────────────────────────────────────────────────────────────
const diffCache = new Map();

/**
 * @returns {{ items: Item[], derived: Item[], quiet: boolean, derivedOnly: boolean }}
 *   Item = { kind, key, label, before?, after?, delta?, unit?, text, group }
 */
export function diffVersions(prevId, nextId) {
    const cacheKey = `${prevId}>${nextId}`;
    if (diffCache.has(cacheKey)) return diffCache.get(cacheKey);

    const A = store.meshDict[prevId]?.userData, B = store.meshDict[nextId]?.userData;
    const items = [], derived = [];
    if (!A || !B) {
        const res = { items, derived, quiet: true, derivedOnly: false, missing: true };
        diffCache.set(cacheKey, res);
        return res;
    }

    // 타입 교체 (패밀리 · 타입 파라미터를 한 줄로)
    const typeA = A.Common?.ElementType, typeB = B.Common?.ElementType;
    const famA = A.Common?.ElementFamily, famB = B.Common?.ElementFamily;
    if (typeA !== typeB || famA !== famB) {
        const before = famA !== famB ? `${famA}: ${typeA}` : typeA;
        const after = famA !== famB ? `${famB}: ${typeB}` : typeB;
        items.push({ kind: "type", key: "ELEM_TYPE_PARAM", label: "타입", before, after, text: `타입 교체: ${before} → ${after}`, group: "타입 교체" });
    }

    const pa = A.Parameter || {}, pb = B.Parameter || {};
    for (const key of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
        if (SKIP.has(key) || key === "ELEM_TYPE_PARAM" || key === "ELEM_FAMILY_PARAM") continue;
        if (JSON.stringify(pa[key]) === JSON.stringify(pb[key])) continue;
        const va = readValue(pa[key]), vb = readValue(pb[key]);
        // 부착 여부처럼 값이 없던 것 = "아니오"
        if (PRESENCE_MATTERS.has(key)) {
            if (pa[key] == null && /^(예|아니오)$/.test(vb.text)) va.text = "아니오";
            if (pb[key] == null && /^(예|아니오)$/.test(va.text)) vb.text = "아니오";
        }
        if (va.text === vb.text) continue;   // 내부 값만 미세하게 달라 표시가 같은 경우
        const label = paramLabel(key);
        const item = { kind: "param", key, label, before: va.text, after: vb.text, group: DERIVED[key] ? label : `${label} 변경` };
        if (va.num != null && vb.num != null && va.unit === vb.unit) {
            item.delta = vb.num - va.num;
            item.unit = vb.unit;
            item.text = `${label} ${va.text} → ${vb.text} (${signed(item.delta, vb.unit)})`;
        } else {
            item.text = `${label} ${va.text} → ${vb.text}`;
        }
        const appeared = pa[key] == null || pb[key] == null;
        (DERIVED[key] || (appeared && !PRESENCE_MATTERS.has(key)) ? derived : items).push(item);
    }

    items.push(...geometryItems(A.Geometry, B.Geometry));

    const propA = A.Property || {}, propB = B.Property || {};
    for (const key of new Set([...Object.keys(propA), ...Object.keys(propB)])) {
        if (propA[key] === propB[key]) continue;
        const label = PROPERTY_LABELS[key] || prettyKey(key);
        items.push({ kind: "prop", key, label, text: label, group: label });
    }

    const layers = layerItems(A.Layers, B.Layers);
    items.push(...layers.items);
    derived.push(...layers.derived);

    // 길이가 바뀐 경우 "한쪽 끝 이동"은 길이 문장과 같은 말이므로 뺀다(회전은 남긴다)
    if (items.some((i) => i.key === "CURVE_ELEM_LENGTH" || i.key === "INSTANCE_LENGTH_PARAM")) {
        for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            if (it.kind !== "geom" || it.key !== "Curve") continue;
            const rest = it.text.split(" · ").filter((p) => p !== "한쪽 끝 이동" && p !== "양 끝 이동");
            if (rest.length) { it.text = rest.join(" · "); it.group = rest[0].startsWith("회전") ? "회전" : it.group; }
            else items.splice(i, 1);
        }
    }
    items.sort((x, y) => rank(x) - rank(y));

    const res = { items, derived, quiet: !items.length && !derived.length, derivedOnly: !items.length && derived.length > 0 };
    diffCache.set(cacheKey, res);
    return res;
}

function rank(item) {
    if (item.kind === "type") return 0;
    if (item.kind === "param" && item.delta != null) return 1;
    if (item.kind === "param") return 2;
    if (item.kind === "layer") return 3;
    if (item.kind === "geom" && item.text !== "한쪽 끝 이동") return 4;
    if (item.kind === "prop") return 5;
    return 6;
}

/** 한 줄 요약: 앞의 max 개 문장 + "외 n" */
export function headline(diff, max = 2) {
    if (!diff) return "";
    if (diff.quiet) return "기록된 값 변화 없음";
    const list = diff.items.length ? diff.items : diff.derived;
    const shown = list.slice(0, max).map((i) => i.text);
    const more = list.length - shown.length;
    return shown.join(" · ") + (more > 0 ? ` 외 ${more}` : "");
}

// ── 요소 하나의 이력 ────────────────────────────────────────────────────────
function versionAt(base, index) {
    const list = store.timeLog[store.timeKeys[index]]?.Elements;
    if (!list) return null;
    for (const id of list) if (baseId(id) === base) return id;
    return null;
}

/** 같은 시점에 바뀐 다른 요소가 있는지 (함께 갱신 판단용) */
function coChangedAt(index, selfBase) {
    const R = analyzeRework();
    const total = R.addAt[index] + R.modAt[index] + R.delAt[index];
    return total > 1 || (total === 1 && !R.lives.get(selfBase)?.changes.includes(index));
}

/**
 * 요소 기본 ID 의 전체 이력.
 * @returns {{ life, entries: Entry[] }}
 *   Entry = { index, key, ms, kind: "add"|"mod"|"del"|"revive", versionId, diff?, cascade? }
 */
export function elementHistory(base) {
    const R = analyzeRework();
    const life = R.lives.get(String(base));
    if (!life) return { life: null, entries: [] };

    const entries = [];
    const spanStarts = new Set(life.spans.map(([s]) => s));
    for (const index of life.changes) {
        const versionId = versionAt(life.base, index);
        const entry = { index, key: store.timeKeys[index], ms: store.keyMs[index], versionId };
        if (spanStarts.has(index)) {
            entry.kind = index === life.firstIdx ? "add" : "revive";
        } else {
            entry.kind = "mod";
            const prevId = versionAt(life.base, index - 1);
            entry.prevId = prevId;
            entry.diff = diffVersions(prevId, versionId);
            if (entry.diff.quiet) entry.cascade = cascadeReason(life, index, versionId);
        }
        entries.push(entry);
    }
    for (const [, end] of life.spans) {
        if (end < R.n - 1) entries.push({ index: end + 1, key: store.timeKeys[end + 1], ms: store.keyMs[end + 1], kind: "del", versionId: versionAt(life.base, end) });
    }
    entries.sort((a, b) => a.index - b.index || (a.kind === "del" ? -1 : 1));
    return { life, entries };
}

function cascadeReason(life, index, versionId) {
    const host = store.meshDict[versionId]?.userData?.Geometry?.HostId;
    if (host != null) {
        const hostLife = analyzeRework().lives.get(String(host));
        if (hostLife?.changes.includes(index)) return "host";
    }
    return coChangedAt(index, life.base) ? "co" : "none";
}

export const CASCADE_TEXT = {
    host: "호스트 요소가 바뀌며 함께 갱신",
    co: "같은 순간 다른 요소 변경과 함께 갱신",
    none: "기록된 값 변화 없음",
};

// ── 구간 요약 (핀 · 비교 · 브리핑 공용) ────────────────────────────────────
/**
 * from → to 사이 수정된 요소들의 변경 내용을 모은다(순변화: from 시점 버전 → to 시점 버전).
 * 같은 값 변화(항목 · 이전 → 이후)는 "패턴" 하나로 묶어 요소 수를 센다 — 47개가 똑같이 바뀌면 한 줄.
 * @returns {{ groups: {group, count, patterns}[], changed, quiet, derivedOnly, lines: string[], total }}
 *   pattern = { item, count, bases: string[], cats: {label,count}[] }
 */
export function summarizeModifications(diff, { exampleLimit = 12 } = {}) {
    const before = new Map(diff.modified.before.map((id) => [baseId(id), id]));
    const groups = new Map();
    let quiet = 0, derivedOnly = 0;

    for (const afterId of diff.modified.after) {
        const prevId = before.get(baseId(afterId));
        const d = diffVersions(prevId, afterId);
        if (d.quiet) { quiet++; continue; }
        if (d.derivedOnly) { derivedOnly++; continue; }
        const seen = new Set();
        const cat = catInfo(store.meshDict[afterId]?.userData?.Common?.ElementCategory).label;
        for (const item of d.items) {
            if (seen.has(item.group)) continue;
            seen.add(item.group);
            if (!groups.has(item.group)) groups.set(item.group, { group: item.group, count: 0, patterns: new Map() });
            const g = groups.get(item.group);
            g.count++;
            const key = item.before != null ? `${item.label}|${item.before}|${item.after}` : item.text;
            if (!g.patterns.has(key)) g.patterns.set(key, { item, count: 0, bases: [], ids: [], cats: new Map() });
            const p = g.patterns.get(key);
            p.count++;
            p.bases.push(baseId(afterId));
            p.ids.push(afterId);
            p.cats.set(cat, (p.cats.get(cat) || 0) + 1);
        }
    }

    const list = [...groups.values()]
        .sort((a, b) => b.count - a.count)
        .map((g) => ({
            group: g.group,
            count: g.count,
            patterns: [...g.patterns.values()]
                .sort((a, b) => b.count - a.count)
                .map((p) => ({ ...p, cats: [...p.cats].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count) })),
        }));

    // AI · 보고서용 문장: 항목마다 많은 패턴부터 돌아가며
    const lines = [];
    for (let round = 0; lines.length < exampleLimit && round < 4; round++) {
        let added = false;
        for (const g of list) {
            const p = g.patterns[round];
            if (!p || lines.length >= exampleLimit) continue;
            lines.push(`${catsText(p.cats)}: ${p.item.text}`);
            added = true;
        }
        if (!added) break;
    }

    return {
        groups: list,
        changed: diff.modified.after.length - quiet - derivedOnly,
        quiet,
        derivedOnly,
        lines,
        total: diff.modified.after.length,
    };
}

/** "구조 기둥 30 · 벽 17" (하나면 "벽 1개") */
export function catsText(cats, max = 3) {
    if (cats.length === 1) return `${cats[0].label} ${cats[0].count}개`;
    const head = cats.slice(0, max).map((c) => `${c.label} ${c.count}`).join(" · ");
    return cats.length > max ? `${head} 외` : head;
}

/** "벽 · 기본 벽 200mm · 2층" */
export function elementName(versionId) {
    const ud = store.meshDict[versionId]?.userData;
    const c = ud?.Common || {};
    return [catInfo(c.ElementCategory).label, c.ElementType || c.ElementFamily, levelOf(ud).name].filter(Boolean).join(" · ");
}

export function clearChangeCache() { diffCache.clear(); }

// 버전 id(요소ID_n)는 프로젝트가 달라도 같은 값이 나올 수 있다 — 다른 폴더를 열면 반드시 비운다.
onProjectReset(clearChangeCache);
