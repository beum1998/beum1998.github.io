// ─────────────────────────────────────────────────────────────────────────────
// 화면 밖 렌더러 (Offscreen shooter)
//
// 메인 뷰어의 장면을 빌려 특정 시점의 모델을 한 장씩 찍는다.
// 가시성(필요하면 색)을 바꿨다가 같은 동기 블록에서 되돌리므로 메인 화면은 깜빡이지 않는다.
//
//   · 이력 화면의 썸네일: 한 방향, 모든 핀이 같은 각도
//   · AI 요약: 동 · 서 · 남 · 북 · 위 다섯 방향
//   · AI 요약: 바뀐 층의 변경 전 · 후 평면(층 높이에서 수평으로 잘라 위에서 본 것)
//
// 좌표 변환(meshLoader): three.x = revit.x, three.y = revit.z, three.z = −revit.y
// → Revit의 북(+Y)은 three의 −Z 쪽이다. 방위 이름은 프로젝트 북(Project North) 기준.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { store, levelOf, onProjectReset } from "./store.js";

const DEFAULT_SIZE = { w: 480, h: 340 };
const TINT_STRENGTH = 0.65;

/** AI 요약용 다섯 방향 (약간 위에서 내려다보는 각도) */
export const VIEWS = [
    { key: "south", label: "남측(정면)", dir: [0, 0.25, 1] },
    { key: "east", label: "동측", dir: [1, 0.25, 0] },
    { key: "north", label: "북측", dir: [0, 0.25, -1] },
    { key: "west", label: "서측", dir: [-1, 0.25, 0] },
    { key: "top", label: "상부(평면)", dir: [0, 1, 0.0001] },
];

/** 이력 썸네일 기본 각도 */
export const DEFAULT_DIR = [0, 0.35, 1];

let renderer = null;
let camera = null;
let sphere = null;

function ensureShooter(size) {
    if (!renderer) {
        renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1);
        camera = new THREE.PerspectiveCamera(75, size.w / size.h, 0.01, 5000);
    }
    if (renderer.domElement.width !== size.w || renderer.domElement.height !== size.h) {
        renderer.setSize(size.w, size.h, false);
        camera.aspect = size.w / size.h;
        camera.updateProjectionMatrix();
    }
    return { renderer, camera };
}

/**
 * 모델이 차지하는 범위. 기준은 마지막 시점이고 핀 시점의 요소를 더한다.
 * 로그에는 좌표가 크게 벗어난 요소 버전이 섞여 있어(예: 수천 단위 떨어진 지붕)
 * 기준 반경의 2배를 넘는 요소는 제외한다. 그렇지 않으면 모델이 점처럼 찍힌다.
 */
export function modelSphere(refresh = false) {
    if (sphere && !refresh) return sphere;

    const idsAt = (index) => new Set(store.timeLog[store.timeKeys[index]]?.Elements || []);
    const base = new THREE.Box3();
    for (const id of idsAt(store.timeKeys.length - 1)) {
        const g = store.meshDict[id];
        if (g) base.expandByObject(g);
    }
    if (base.isEmpty()) for (const g of store.allGroup) base.expandByObject(g);
    if (base.isEmpty()) return null;

    const baseSphere = base.getBoundingSphere(new THREE.Sphere());
    const limit = Math.max(baseSphere.radius * 2, 8);
    const box = base.clone();
    const center = new THREE.Vector3();
    for (const pin of store.pins) {
        for (const id of idsAt(pin.index)) {
            const g = store.meshDict[id];
            if (!g) continue;
            const b = new THREE.Box3().setFromObject(g);
            if (b.isEmpty()) continue;
            if (b.getCenter(center).distanceTo(baseSphere.center) > limit) continue;
            box.union(b);
        }
    }
    sphere = box.getBoundingSphere(new THREE.Sphere());
    return sphere;
}

function aim(cam, target, direction, pad = 1.12) {
    const dir = new THREE.Vector3(...direction).normalize();
    const vFov = (cam.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
    const dist = (target.radius / Math.sin(Math.min(vFov, hFov) / 2)) * pad;
    cam.position.copy(target.center).addScaledVector(dir, dist);
    cam.up.set(0, 1, 0);
    // 위에서 볼 때만 up 을 북쪽으로. (예전에는 dir 에 dist 를 곱한 뒤 검사해 모든 방향이 "위"로 잡혔고,
    // 동 · 북 · 서 화면이 눕거나 뒤집혀 찍혔다)
    if (Math.abs(dir.y) > 0.99) cam.up.set(0, 0, -1);
    cam.lookAt(target.center);
    cam.near = Math.max(dist / 1000, 0.05);
    cam.far = dist * 10;
    cam.updateProjectionMatrix();
}

/**
 * 한 시점(index)의 모델을 여러 방향에서 찍는다.
 * @param {object} opts
 * @param {number} opts.index      타임라인 인덱스
 * @param {number[][]} opts.dirs   카메라 방향들
 * @param {Map<string, THREE.Color>} [opts.tint]  요소별 강조색
 * @returns {string[]} dataURL 배열 (dirs 와 같은 순서)
 */
export function captureViews({ index, dirs = [DEFAULT_DIR], tint = null, size = DEFAULT_SIZE, quality = 0.82 }) {
    if (!store.viewer) return [];
    const { renderer: r, camera: cam } = ensureShooter(size);
    const target = modelSphere();
    if (!target) return [];

    const ids = new Set(store.timeLog[store.timeKeys[index]]?.Elements || []);
    const savedVisible = store.allGroup.map((g) => g.visible);
    const tinted = [];

    for (const g of store.allGroup) g.visible = ids.has(g.name);
    if (tint) {
        for (const [id, color] of tint) {
            const g = store.meshDict[id];
            if (!g || !g.visible) continue;
            g.traverse((c) => {
                if (!c.isMesh) return;
                tinted.push([c.material, c.material.color.clone()]);
                c.material.color.lerp(color, TINT_STRENGTH);
            });
        }
    }

    const out = [];
    try {
        for (const dir of dirs) {
            aim(cam, target, dir);
            r.render(store.viewer.scene, cam);
            out.push(r.domElement.toDataURL("image/jpeg", quality));
        }
    } catch (e) {
        console.warn("[shoot] 렌더 실패:", e);
    }

    for (const [material, color] of tinted) material.color.copy(color);
    store.allGroup.forEach((g, i) => { g.visible = savedVisible[i]; });
    return out;
}

// ── 층 평면 (Floor plan) ────────────────────────────────────────────────────
// Revit 평면 뷰와 같은 규칙으로 찍는다: 층 바닥 높이에서 층고의 40%(3 m 층고면 약 1.2 m)를
// 수평으로 잘라, 그 높이를 지나는 벽 · 문 · 창은 단면으로, 그 층 바닥 · 가구 · 계단은
// 내려다본 모습으로 남긴다. 위층 바닥 · 천장 · 지붕은 평면을 덮으므로 뺀다. 북(−Z)이 위.
//
// 요소가 어느 층인지는 로그의 층 이름(LevelName)이 아니라 실제 높이로 정한다.
// 층 이름은 모델마다 들쭉날쭉하다 — 예) 1층 높이에 서 있는 벽이 "First Floor" 로 묶이거나,
// 같은 높이에 "Ground Level" · "Ground Floor" 두 레벨이 겹친다. 그래서
//   ① 층 이름마다 바닥 높이를 추정하고(그 층 바닥판 윗면, 없으면 요소 아랫면의 중앙값)
//   ② 거의 같은 높이의 이름은 한 층으로 합친 뒤
//   ③ 요소의 높이 범위가 [바닥 − 여유, 자르는 높이] 와 겹치면 그 층 평면에 넣는다.
//      다만 바닥판 · 계단 · 난간이 아닌 요소는 바닥보다 조금이라도(층고의 10%) 올라와야 넣는다 —
//      윗면이 위층 바닥에 닿기만 한 아래층 벽 · 창이 위층 평면에 겹쳐 그려지지 않게.
// 같은 층을 여러 시점에서 찍을 때는 같은 틀을 써서 이전 · 이후 평면을 겹쳐 볼 수 있게 한다.

const PLAN_HIDDEN = new Set(["Ceilings", "Roofs"]);
const PLAN_CUT = 0.4;          // 층고 대비 자르는 높이
const PLAN_BELOW = 0.1;        // 바닥 아래 여유(층고 대비) — 바닥판 윗면이 조금 낮아도 잡히게
const PLAN_ABOVE = 0.1;        // 바닥 위로 올라와야 하는 높이(층고 대비) — 바닥판 · 계단 · 난간 말고는
const PLAN_REACH = new Set(["Floors", "Stairs", "Railings"]);   // 아래에서 이 층 바닥까지 닿아도 이 층 평면에 넣는 것
const PLAN_MERGE = 0.2;        // 가장 큰 층고의 20% 보다 가까운 층 이름은 한 층으로
const PLAN_WIDTH = 560;
const PLAN_FLOOR = new THREE.Color(0xf4f5f7);

let planCache = null;
let orthoCam = null;
onProjectReset(() => { planCache = null; sphere = null; });

const boxCache = new WeakMap();
function boxOf(g) {
    let b = boxCache.get(g);
    if (!b) { b = new THREE.Box3().setFromObject(g); boxCache.set(g, b); }
    return b;
}

// 경사 화살표가 있는 바닥(경사로)
const isSloped = (info) => { const s = info?.Geometry?.SlopeArrow; return s != null && s !== "None"; };

function median(list) {
    if (!list.length) return null;
    const a = [...list].sort((x, y) => x - y);
    return a[a.length >> 1];
}

/**
 * 평면 층 목록(낮은 층 → 높은 층). 로그 전체의 요소로 한 번 계산해 캐시한다.
 * @returns {{ key: string, name: string, names: string[], base: number, cut: number, low: number }[]}
 */
export function planLevels() {
    if (planCache && planCache.n === store.allGroup.length) return planCache.levels;

    const whole = modelSphere();
    const limit = whole ? Math.max(whole.radius * 2, 8) : Infinity;
    const center = new THREE.Vector3();
    const byName = new Map();   // key → { name, floorTops, mins, count }
    for (const g of store.allGroup) {
        const b = boxOf(g);
        if (b.isEmpty()) continue;
        if (whole && b.getCenter(center).distanceTo(whole.center) > limit) continue;
        const lv = levelOf(g.userData);
        if (lv.key === "__none") continue;
        if (!byName.has(lv.key)) byName.set(lv.key, { key: lv.key, name: lv.name, floorTops: [], mins: [], count: 0 });
        const e = byName.get(lv.key);
        e.count++;
        e.mins.push(b.min.y);
        // 층의 기준 높이는 바닥판 윗면. 경사 바닥(경사로)은 윗면이 다음 층까지 올라가므로 뺀다
        if (g.userData?.Common?.ElementCategory === "Floors" && !isSloped(g.userData)) e.floorTops.push(b.max.y);
    }

    const named = [...byName.values()]
        .map((e) => ({ ...e, base: e.floorTops.length ? Math.max(...e.floorTops) : median(e.mins) }))
        .filter((e) => e.base != null)
        .sort((a, b) => a.base - b.base);

    let maxGap = 0;
    for (let i = 1; i < named.length; i++) maxGap = Math.max(maxGap, named[i].base - named[i - 1].base);

    const groups = [];
    for (const e of named) {
        const last = groups[groups.length - 1];
        if (last && e.base - last.base < maxGap * PLAN_MERGE) last.members.push(e);
        else groups.push({ base: e.base, members: [e] });
    }

    const levels = groups.map((grp, i) => {
        const next = groups[i + 1];
        const prev = groups[i - 1];
        const storey = next ? next.base - grp.base : prev ? grp.base - prev.base : maxGap || 1;
        // 바닥판이 있는 이름 → 요소가 많은 이름을 대표로
        const lead = [...grp.members].sort((a, b) => (b.floorTops.length > 0) - (a.floorTops.length > 0) || b.count - a.count)[0];
        return {
            key: lead.key,
            name: lead.name,
            names: grp.members.map((m) => m.name),
            base: grp.base,
            cut: grp.base + storey * PLAN_CUT,
            low: grp.base - storey * PLAN_BELOW,
        };
    });
    planCache = { n: store.allGroup.length, levels };
    return levels;
}

function inPlan(g, lv) {
    const cat = g.userData?.Common?.ElementCategory;
    if (PLAN_HIDDEN.has(cat)) return false;
    const b = boxOf(g);
    if (b.isEmpty() || b.min.y >= lv.cut) return false;
    if (PLAN_REACH.has(cat)) return b.max.y > lv.low;
    const storey = (lv.cut - lv.base) / PLAN_CUT;
    return b.max.y > lv.base + storey * PLAN_ABOVE;
}

function planMembers(index, lv) {
    const out = [];
    for (const id of store.timeLog[store.timeKeys[index]]?.Elements || []) {
        const g = store.meshDict[id];
        if (g && inPlan(g, lv)) out.push(g);
    }
    return out;
}

/**
 * 요소(버전 ID)가 속한 평면 층 key — 요소가 "서 있는" 층 하나.
 * 평면에는 자르는 높이를 지나는 요소가 모두 보이지만(두 층 높이의 벽은 두 평면에 다 나온다),
 * 어느 층이 바뀌었는지 셀 때는 아랫면(바닥판은 윗면)이 놓인 층 하나로 센다.
 */
export function planLevelOf(id) {
    const g = store.meshDict[id];
    const levels = planLevels();
    if (!g || !levels.length || PLAN_HIDDEN.has(g.userData?.Common?.ElementCategory)) return null;
    const b = boxOf(g);
    if (b.isEmpty()) return null;
    const y = g.userData?.Common?.ElementCategory === "Floors" ? b.max.y : b.min.y;
    let hit = levels[0];
    for (const lv of levels) if (lv.low <= y) hit = lv;
    return hit.key;
}

/**
 * 한 평면 층을 여러 시점에서 같은 틀로 찍는다.
 * @param {object} opts
 * @param {string} opts.levelKey   planLevels() 의 key
 * @param {{ index: number, tint?: Map<string, THREE.Color> }[]} opts.shots
 * @returns {string[]} dataURL 배열 (shots 와 같은 순서, 틀을 못 잡으면 빈 배열)
 */
export function captureLevelPlans({ levelKey, shots, quality = 0.82, width = PLAN_WIDTH }) {
    if (!store.viewer || !shots?.length) return [];
    const lv = planLevels().find((l) => l.key === levelKey);
    if (!lv) return [];

    const whole = modelSphere();
    const limit = whole ? Math.max(whole.radius * 2, 8) : Infinity;
    const center = new THREE.Vector3();
    const members = shots.map((s) => planMembers(s.index, lv)
        .filter((g) => !whole || boxOf(g).getCenter(center).distanceTo(whole.center) <= limit));
    const box = new THREE.Box3();
    for (const list of members) for (const g of list) box.union(boxOf(g));
    if (box.isEmpty()) return [];

    const size = box.getSize(new THREE.Vector3());
    const pad = 1.08;
    const halfW = Math.max(size.x, 0.5) * pad / 2;
    const halfD = Math.max(size.z, 0.5) * pad / 2;
    const w = width;   // 포스터처럼 크게 찍을 때만 바꾼다(AI 입력은 기본값)
    const h = Math.round(Math.min(w * 1.25, Math.max(w * 0.55, w * (halfD / halfW))));
    const { renderer: r } = ensureShooter({ w, h });

    // 틀의 가로세로 비율을 이미지에 맞춘다(찌그러지지 않게)
    let hw = halfW, hd = halfD;
    if (hw / hd > w / h) hd = hw * h / w; else hw = hd * w / h;

    const c = box.getCenter(new THREE.Vector3());
    const top = lv.cut + 1;
    if (!orthoCam) orthoCam = new THREE.OrthographicCamera();
    Object.assign(orthoCam, { left: -hw, right: hw, top: hd, bottom: -hd, near: 0.01, far: top - Math.min(lv.low, box.min.y) + 1 });
    orthoCam.position.set(c.x, top, c.z);
    orthoCam.up.set(0, 0, -1);   // 북이 위
    orthoCam.lookAt(c.x, lv.base, c.z);
    orthoCam.updateProjectionMatrix();

    const savedVisible = store.allGroup.map((g) => g.visible);
    const savedClip = r.clippingPlanes;
    r.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), lv.cut)];   // y ≤ cut 만 남긴다

    const out = [];
    shots.forEach((shot, k) => {
        const set = new Set(members[k]);
        for (const g of store.allGroup) g.visible = set.has(g);
        const tinted = [];
        const paint = (g, color, amount) => g.traverse((m) => {
            if (!m.isMesh) return;
            tinted.push([m.material, m.material.color.clone()]);
            m.material.color.lerp(color, amount);
        });
        // 바닥판은 밝게 — 어두운 바닥 위에서는 벽 단면이 묻힌다. 바뀐 바닥판도 옅게만 칠한다
        const isFloor = (g) => g.userData?.Common?.ElementCategory === "Floors";
        for (const g of set) if (isFloor(g)) paint(g, PLAN_FLOOR, 0.8);
        for (const [id, color] of shot.tint || []) {
            const g = store.meshDict[id];
            if (g && set.has(g)) paint(g, color, isFloor(g) ? 0.3 : TINT_STRENGTH);
        }
        try {
            r.render(store.viewer.scene, orthoCam);
            out.push(r.domElement.toDataURL("image/jpeg", quality));
        } catch (e) {
            console.warn("[shoot] 평면 렌더 실패:", e);
            out.push(null);
        }
        for (const [material, color] of tinted.reverse()) material.color.copy(color);   // 두 번 칠한 바닥판도 원래 색으로
    });

    r.clippingPlanes = savedClip;
    store.allGroup.forEach((g, i) => { g.visible = savedVisible[i]; });
    return out;
}
