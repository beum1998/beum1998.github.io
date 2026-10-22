// ─────────────────────────────────────────────────────────────────────────────
// 요소 선택 (뷰어마다 하나씩)
//
//   · 캔버스를 "클릭"했을 때만 선택(드래그로 회전한 경우는 무시)
//   · 선택 요소는 은은하게 발광 + 뷰어 좌하단 칩(카테고리 · 타입 · 층)
//   · 메인 뷰어는 우측 [요소] 탭에 상세 정보(검색 가능한 파라미터 포함)
//   · 요소 숨기기: 칩의 [숨기기] · H 키 · Ctrl+Alt+클릭 (hideElements.js, 시간을 옮겨도 유지, 머리줄 [숨김 n] 에서 다시 켠다)
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { store, on, catInfo, levelOf, formatKey, escapeHtml, baseId, onProjectReset } from "./store.js";
import { direction } from "./changeDiff.js";
import { renderElementHistory } from "./elementHistory.js";
import { icon } from "./icons.js";
import { hideElement } from "./hideElements.js";

const SELECT_EMISSIVE = 0x24406e;
const openSections = new Set(["Geometry", "Property", "Layers"]);
let panelBase = null;   // 요소 탭에 보이는 요소의 기본 ID (시점이 바뀌면 이력의 "지금" 표시를 갱신)

// clickEvent 는 폴더를 다시 열 때마다(main() 마다) 새 캔버스에 다시 붙는다.
// 캔버스는 사라지지만 시점 구독은 남으므로, 이전 것을 걷어낸다(타임라인과 같은 규칙).
let offTime = null;
onProjectReset(() => { offTime?.(); offTime = null; panelBase = null; });

export function clickEvent(renderer, camera, allGroup, opts = {}) {
    const chip = opts.chip === undefined ? document.getElementById("pick-main") : opts.chip;
    const showInPanel = opts.panel !== false;
    const raycaster = new THREE.Raycaster();
    const el = renderer.domElement;
    let down = null;
    let selected = null;
    let selectedBase = null;   // 선택한 요소의 기본 ID — 시점이 바뀌어도 이 요소를 따라간다

    if (showInPanel) {
        renderPanel(null);
        offTime?.();
        offTime = on("time:main", () => {
            followTime();
            const host = document.querySelector("#element-target [data-ehist]");
            if (host && panelBase != null) renderElementHistory(host, panelBase);
        });

        /** 기본 ID 로 요소를 고른다(수명선 · 표 · 이력에서). index 가 있으면 그 시점으로 먼저 옮긴다. */
        store.selectElement = (base, index = null) => {
            if (index != null && index !== store.mainIndex) store.setMainIndex?.(index);
            const list = store.timeLog?.[store.timeKeys[store.mainIndex]]?.Elements || [];
            const id = list.find((x) => baseId(x) === String(base));
            const g = id ? store.meshDict[id] : null;
            if (g) select(g);
            store.setTab?.("info");
            return Boolean(g);
        };
    }

    el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        down = { x: e.clientX, y: e.clientY, hide: e.ctrlKey && e.altKey };
    });
    el.addEventListener("pointerup", (e) => {
        if (e.button !== 0 || !down) return;
        const d = down;
        down = null;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;   // 드래그(회전)였음
        const g = pick(e);
        if (d.hide) {
            if (g) {
                const base = baseId(g.name);
                if (base === selectedBase) select(null);
                hideElement(base);
            }
            return;
        }
        select(g && g !== selected ? g : null);
    });

    // 선택 칩은 화면에 계속 남는 요소라, 다시 불러오면 이전 핸들러를 걷어내고 새로 건다
    if (chip) {
        chip.__ablOff?.();
        const onChipClick = (e) => {
            if (e.target.closest("[data-act=close]")) select(null);
            else if (e.target.closest("[data-act=info]")) store.setTab?.("info");
            else if (e.target.closest("[data-act=hide]")) hideSelected();
        };
        chip.addEventListener("click", onChipClick);
        chip.__ablOff = () => chip.removeEventListener("click", onChipClick);
    }

    /** 고른 요소만 숨기고 선택은 푼다(다시 켜기는 머리줄 [숨김 n]) */
    function hideSelected() {
        if (selectedBase == null) return;
        const base = selectedBase;
        select(null);
        hideElement(base);
    }

    function pick(e) {
        const rect = el.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        const meshes = [];
        for (const g of allGroup) {
            if (!g.visible) continue;
            for (const c of g.children) if (c.isMesh) meshes.push(c);
        }
        raycaster.setFromCamera(mouse, camera);
        const hit = raycaster.intersectObjects(meshes, false)[0];
        return hit ? hit.object.parent : null;
    }

    function setEmissive(g, hex) {
        g.traverse((c) => { if (c.isMesh && c.material?.emissive) c.material.emissive.setHex(hex); });
    }

    /** 같은 요소의 모든 버전(요소ID_1, _2 …) — 시점을 옮겨도 선택이 이어지게 */
    function versionsOf(base) {
        return base == null ? [] : allGroup.filter((g) => baseId(g.name) === String(base));
    }

    function select(g) {
        for (const old of versionsOf(selectedBase)) setEmissive(old, 0x000000);
        selected = g;
        selectedBase = g ? baseId(g.name || g.userData?.Common?.ElementId || "") : null;
        if (g) setEmissive(g, SELECT_EMISSIVE);
        renderChip(g);
        if (showInPanel) renderPanel(g ? g.userData : null);
    }

    /**
     * 시점이 바뀌면 같은 요소의 그 시점 버전으로 선택을 옮긴다.
     * 버전이 실제로 바뀔 때만 요소 탭을 다시 그린다(재생 중 매 프레임 갱신을 피한다).
     */
    function followTime() {
        if (selectedBase == null) return;
        const now = versionsOf(selectedBase).find((g) => g.visible)
            || versionsOf(selectedBase).find((g) => g.name === currentVersionId(selectedBase));
        if (!now) {                       // 이 시점에는 없는 요소(아직 생기기 전이거나 지워진 뒤)
            if (chip) chip.hidden = true;
            selected = null;
            return;
        }
        if (now === selected) { renderChip(now); return; }
        setEmissive(now, SELECT_EMISSIVE);
        selected = now;
        renderChip(now);
        if (showInPanel) renderPanel(now.userData);
    }

    function currentVersionId(base) {
        const list = store.timeLog?.[store.timeKeys[store.mainIndex]]?.Elements || [];
        return list.find((x) => baseId(x) === String(base)) || null;
    }

    function renderChip(g) {
        if (!chip) return;
        if (!g) { chip.hidden = true; return; }
        const c = g.userData?.Common || {};
        const ci = catInfo(c.ElementCategory);
        const lv = levelOf(g.userData);
        chip.hidden = false;
        chip.innerHTML = `
            <i class="dot" style="--c:${ci.color}"></i>
            <div class="pick-chip__text">
                <b>${escapeHtml(ci.label)}<span>${escapeHtml(c.ElementType || c.ElementFamily || "")}</span></b>
                <em>${escapeHtml(lv.name)} · #${escapeHtml(String(c.ElementId || "").split("_")[0])}</em>
            </div>
            ${showInPanel ? `<button class="btn btn--ghost btn--icon btn--sm" type="button" data-act="info" title="요소 정보 보기" aria-label="요소 정보 보기">${icon("info", 15)}</button>` : ""}
            ${showInPanel ? `<button class="btn btn--ghost btn--icon btn--sm" type="button" data-act="hide" title="이 요소 숨기기 (H)" aria-label="이 요소 숨기기">${icon("eyeOff", 15)}</button>` : ""}
            <button class="btn btn--ghost btn--icon btn--sm" type="button" data-act="close" title="선택 해제" aria-label="선택 해제">${icon("x", 14)}</button>`;
    }

    return { select, get selected() { return selected; }, get selectedBase() { return selectedBase; } };
}

// ── 요소 탭 ─────────────────────────────────────────────────────────────────
function renderPanel(info) {
    const target = document.getElementById("element-target");
    if (!target) return;
    panelBase = info ? String(info.Common?.ElementId || "").split("_")[0] : null;
    if (!info) {
        target.innerHTML = `
            <div class="empty">
                <div class="empty__icon">${icon("box", 22)}</div>
                <div class="empty__title">요소를 선택하세요</div>
                <p class="empty__text">3D 뷰에서 요소를 클릭하면 카테고리 · 타입 · 층 · 파라미터를 보여줘요.<br>
                고른 요소는 칩의 눈 버튼이나 <span class="kbd">H</span> 키로 숨길 수 있어요(<span class="kbd">Ctrl</span> + <span class="kbd">Alt</span> + 클릭도 같아요). 다시 켜기는 3D 위의 <b>숨김</b> 버튼에서 해요.</p>
            </div>`;
        return;
    }

    const c = info.Common || {};
    const ci = catInfo(c.ElementCategory);
    const lv = levelOf(info);
    const [bid, ver] = String(c.ElementId || "").split("_");
    const sections = [
        ["Geometry", "형상", info.Geometry],
        ["Property", "속성", info.Property],
        ["Layers", "레이어 · 재질", info.Layers],
        ["Parameter", "파라미터", info.Parameter],
        ["Common", "기본", info.Common],
    ].filter(([, , v]) => v && (Array.isArray(v) ? v.length : Object.keys(v).length));

    target.innerHTML = `
        <div class="el-hero card">
            <div class="el-hero__icon" style="--c:${ci.color}">${icon("box", 20)}</div>
            <div class="el-hero__text">
                <div class="el-hero__cat">${escapeHtml(ci.label)}<span>${escapeHtml(c.ElementCategory || "")}</span></div>
                <div class="el-hero__name">${escapeHtml(c.ElementFamily || "—")}</div>
                <div class="el-hero__type">${escapeHtml(c.ElementType || "")}</div>
            </div>
        </div>
        <div class="kv-grid">
            <div class="kv card card--flat"><span>요소 ID</span><b>${escapeHtml(bid || "—")}</b></div>
            <div class="kv card card--flat"><span>버전</span><b>v${escapeHtml(ver || "1")}</b></div>
            <div class="kv card card--flat"><span>층</span><b>${escapeHtml(lv.name)}</b></div>
            <div class="kv card card--flat"><span>기록 시각</span><b>${escapeHtml(formatKey(c.Timestamp).short)}</b></div>
        </div>
        <section class="ehist" data-ehist aria-label="변경 이력"></section>
        ${sections.map(([key, label, value]) => section(key, label, value)).join("")}`;
    renderElementHistory(target.querySelector("[data-ehist]"), bid);

    target.querySelectorAll("details.el-sec").forEach((d) => {
        d.addEventListener("toggle", () => {
            if (d.open) openSections.add(d.dataset.key); else openSections.delete(d.dataset.key);
        });
    });
    const search = target.querySelector(".param-search input");
    search?.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        search.closest(".el-sec").querySelectorAll(".prow").forEach((row) => {
            row.hidden = q && !row.dataset.k.includes(q);
        });
    });
}

function section(key, label, value) {
    const count = Array.isArray(value) ? value.length : Object.keys(value).length;
    let body;
    if (key === "Parameter") {
        const rows = Object.entries(value).map(([k, v]) => {
            const shown = v && typeof v === "object" ? (v.ValueString ?? v.Value) : v;
            return `<div class="prow" data-k="${escapeHtml(`${k} ${shown ?? ""}`.toLowerCase())}">
                <span class="prow__k" title="${escapeHtml(k)}">${escapeHtml(prettyKey(k))}</span>
                <span class="prow__v">${escapeHtml(shown ?? "—")}</span></div>`;
        }).join("");
        body = `<label class="param-search field-icon">${icon("search", 14)}<input class="field field--sm" type="search" placeholder="파라미터 검색" spellcheck="false"></label>${rows}`;
    } else if (key === "Layers" && Array.isArray(value)) {
        body = value.map((layer, i) => `
            <div class="layer">
                <div class="layer__head"><span class="tag tag--num">${i + 1}</span>${escapeHtml(layer["Material Name"] || layer.Function || "레이어")}</div>
                ${rows(layer, ["Material Name"])}
            </div>`).join("");
    } else {
        body = rows(value);
    }
    return `<details class="el-sec card card--flat disc" data-key="${key}" ${openSections.has(key) ? "open" : ""}>
        <summary>${icon("chevronRight", 14)}<span>${label}</span><em class="tag tag--num">${count}</em></summary>
        <div class="el-sec__body">${body}</div>
    </details>`;
}

function rows(obj, skip = []) {
    if (!obj || typeof obj !== "object") return `<div class="prow"><span class="prow__v">${escapeHtml(obj)}</span></div>`;
    return Object.entries(obj).filter(([k]) => !skip.includes(k)).map(([k, v]) => `
        <div class="prow">
            <span class="prow__k" title="${escapeHtml(k)}">${escapeHtml(prettyKey(k))}</span>
            <span class="prow__v">${formatValue(v)}</span>
        </div>`).join("");
}

// ── 값 표시 ─────────────────────────────────────────────────────────────────
// 형상 값은 Revit 내부 단위(피트)라 그대로 보면 읽히지 않는다. 점 · 선은 풀어서 쓰고,
// 길이는 m(1m 미만은 mm)로 바꾼다. 화면에 찍는 숫자는 소수점 두 자리까지만.
const FT_TO_MM = 304.8;
const nf2 = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

function num2(v) { return nf2.format(v); }

function isPoint(o) {
    return o && typeof o === "object" && ["X", "Y", "Z"].every((k) => typeof o[k] === "number");
}

const nf2fix = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function pointText(p) {
    const m = (v) => nf2fix.format((v * FT_TO_MM) / 1000);   // 좌표는 자릿수를 맞춰 세로로 읽히게
    return `(${m(p.X)}, ${m(p.Y)}, ${m(p.Z)}) m`;
}

function lengthText(ft) {
    const mm = Math.abs(ft) * FT_TO_MM;
    return mm >= 1000 ? `${num2(mm / 1000)} m` : `${num2(mm)} mm`;
}

/** {Type:"Line", endPoints:[{X,Y,Z},{X,Y,Z}]} → 길이 · 방향 · 시작/끝 점 */
function curveHtml(v) {
    const [a, b] = v.endPoints || [];
    if (!isPoint(a) || !isPoint(b)) return null;
    const dx = b.X - a.X, dy = b.Y - a.Y, dz = b.Z - a.Z;
    const len = Math.hypot(dx, dy, dz);
    const dir = direction(dx, dy);
    const kind = v.Type === "Line" ? "직선" : escapeHtml(String(v.Type || "선"));
    return `<span class="geo">
        <span class="geo__head"><b>${kind}</b> 길이 ${lengthText(len)}${dir ? ` · ${dir} 방향` : ""}</span>
        <span class="geo__pt">시작 ${pointText(a)}</span>
        <span class="geo__pt">끝 ${pointText(b)}</span>
    </span>`;
}

/** 윤곽(점 목록) → 점 수 · 둘레 */
function pathHtml(list) {
    const pts = list.filter(isPoint);
    if (pts.length < 2) return null;
    let peri = 0;
    for (let i = 1; i < pts.length; i++) peri += Math.hypot(pts[i].X - pts[i - 1].X, pts[i].Y - pts[i - 1].Y, pts[i].Z - pts[i - 1].Z);
    return `<span class="geo">
        <span class="geo__head">점 ${pts.length}개 · 둘레 ${lengthText(peri)}</span>
        <span class="geo__pt">시작 ${pointText(pts[0])}</span>
    </span>`;
}

function formatValue(v) {
    if (v == null || v === "") return "—";
    if (typeof v === "number") return num2(v);
    if (typeof v === "boolean") return v ? "예" : "아니오";
    if (isPoint(v)) return pointText(v);
    if (Array.isArray(v)) {
        const path = pathHtml(v);
        if (path) return path;
    }
    if (typeof v === "object") {
        const curve = v.endPoints ? curveHtml(v) : null;
        if (curve) return curve;
        // 그 밖의 구조는 원문을 보여주되 숫자는 두 자리로 줄인다
        const text = JSON.stringify(v, (k, x) => (typeof x === "number" ? Number(x.toFixed(2)) : x));
        return `<code title="${escapeHtml(text)}">${escapeHtml(text.length > 140 ? text.slice(0, 140) + "…" : text)}</code>`;
    }
    return escapeHtml(v);
}

// ALL_CAPS_PARAM → "All Caps Param" 처럼 읽기 쉽게
function prettyKey(k) {
    if (!/^[A-Z0-9_]+$/.test(k)) return k;
    return k.toLowerCase().split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}
