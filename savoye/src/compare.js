// ─────────────────────────────────────────────────────────────────────────────
// 분할 비교 (Split compare)
//
// 기본은 3D 뷰어 하나. [비교] 버튼이나 비교 탭을 누르면 기존 뷰어가 오른쪽(Current / After)으로
// 줄어들고 왼쪽에 새 뷰어(Past / Before)가 나타난다. 비교 탭을 닫으면 분할도 꺼진다.
//
// 비교 UI와 알고리즘은 기존 비교 화면(compare.html · src/script/diffView.js)을 그대로 쓴다:
//   · Revision 슬라이더 · Save time · Sync camera · Ghost others
//   · Diff 패널: Revision A/B · Summary / Counts / Quantities / Materials ·
//     Active Filters(Reset isolate) · Log Citations(Highlight)
//   · 차이 계산 · 격리 · 강조 함수는 diffView.js 에서 import (복사하지 않음)
// 달라진 점은 두 가지뿐이다:
//   · After 뷰어 = 기존 메인 뷰어, Before 뷰어는 처음 열 때 형상을 공유해 한 번만 만든다.
//   · 하단 층 · 카테고리 필터가 요소 목록에 먼저 적용된다(두 뷰어와 집계에 공통).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { store, emit, on, passesFilters, escapeHtml, catInfo } from "./store.js";
import { icon } from "./icons.js";
import { renderMarkers, pinAtIndex, prevPinBefore } from "./pins.js";
import { clickEvent } from "./clickEvent.js";
import {
    DIFF_TEXT,
    buildShapeIndex,
    filterIdsByCategoriesAndMaterials,
    diffElementVersionsFromLists,
    applyChangeFilterToDiff,
    diffElementVersions,
    mergeQuantities,
    sortByCategoryOrder,
    normalizeCategoryKey,
    buildCountRows,
    sortCountRows,
    renderTableList,
    buildLayerMaterialGroups,
    buildMaterialGroups,
    renderMaterialList,
    buildLogStats,
    setVisibleByIds,
    setGroupGhosted,
    colorElementsById,
    resetGroupColors,
    cacheOriginalColors,
    formatMaterialFilterLabel,
    normalizeMaterialFilterKey,
    formatTimeLabel,
    formatTimeLabelSingleLine,
    attachSliderTooltip,
    updateSliderFill,
    showTooltip,
    hideTooltip,
    saveTime,
    renderSaved,
    captureCamera,
    restoreCamera,
    syncCameras,
} from "./script/diffView.js";

export function initCompare() {
    if (window.__ablCompareInit) return;
    window.__ablCompareInit = true;

    // 옮겨 온 비교 화면의 글자를 뷰어 말투(한국어)로 — 기존 compare.html 은 영어 그대로 둔다
    Object.assign(DIFF_TEXT, {
        category: "카테고리", before: "A", after: "B", delta: "증감", elements: "전체 요소",
        added: "추가된 요소", deleted: "삭제된 요소", modified: "수정된 요소", unchanged: "그대로인 요소",
        highlight: "강조", noFilters: "고른 필터가 없어요.", revisionA: "A · 이전", revisionB: "B · 현재",
        categoryLabel: (key) => catInfo(key).label !== key ? catInfo(key).label : null,
    });

    const root = document.getElementById("root");
    const beforeTarget = document.getElementById("viewer-before");
    const beforeSlider = document.getElementById("before-slider");
    const afterSlider = document.getElementById("after-slider");
    const beforeSave = document.getElementById("before-save");
    const afterSave = document.getElementById("after-save");
    const beforeSaved = document.getElementById("before-saved");
    const afterSaved = document.getElementById("after-saved");
    const beforePins = document.getElementById("before-pins");
    const afterPins = document.getElementById("after-pins");
    const beforePinLabel = document.getElementById("before-pin");
    const afterPinLabel = document.getElementById("after-pin");
    const syncCamera = document.getElementById("sync-camera");
    const isolateGhostToggle = document.getElementById("isolate-ghost");
    const diffSummary = document.getElementById("diff-summary");
    const diffQuantity = document.getElementById("diff-quantity");
    const diffCounts = document.getElementById("diff-counts");
    const diffMaterials = document.getElementById("diff-materials");
    const diffCitations = document.getElementById("diff-citations");
    const diffActiveFilters = document.getElementById("diff-active-filters");
    const materialHideZero = document.getElementById("material-hide-zero");
    const diffReset = document.getElementById("diff-reset");
    const diffTabs = document.querySelectorAll("#compare-divs [data-diff-tab]");
    const diffTabsContainer = document.querySelector("#compare-divs .diff-tabs");
    const diffSections = Array.from(
        document.querySelectorAll("#compare-divs .diff-section:not(.diff-section--no-anim)")
    );

    if (!beforeTarget || !beforeSlider || !afterSlider || !diffSummary || !diffQuantity || !diffCitations) return;

    const state = {
        beforeIndex: 0,
        syncingCamera: false,
        isolatedCategories: new Set(),
        isolatedMaterials: new Set(),
        openMaterialGroups: new Set(["Materials"]),
        isolateIdsBefore: null,
        isolateIdsAfter: null,
        isolationMode: "hide",
        activeChange: null,
        highlightChanges: new Set(),
        savedBefore: [],
        savedAfter: [],
        savedBeforeCam: new Map(),
        savedAfterCam: new Map(),
        activeTab: "summary",
    };

    let before = null;          // { scene, camera, renderer, controls }
    let beforeMeshes = null;    // { allGroup, meshDict }
    let shapeIndex = null;
    let raf = 0;
    let dolly = 0;
    const afterMeshes = {
        get allGroup() { return store.allGroup; },
        get meshDict() { return store.meshDict; },
    };

    const beforeTooltip = attachSliderTooltip(beforeSlider);
    const afterTooltip = attachSliderTooltip(afterSlider);
    let beforeHideTimer = null;
    let afterHideTimer = null;

    // ── 분할 켜기 / 끄기 ─────────────────────────────────────────────────────────
    document.getElementById("split-toggle")?.addEventListener("click", () => store.openSplit());
    document.getElementById("split-close")?.addEventListener("click", () => store.closeSplit());

    store.openSplit = (opts = {}) => {
        if (!store.timeKeys.length || !store.viewer) return;
        ensureBuilt();
        if (opts.afterIndex != null) store.setMainIndex?.(opts.afterIndex);
        if (!store.split || opts.beforeIndex != null) {
            state.beforeIndex = clampIndex(opts.beforeIndex ?? defaultBeforeIndex());
        }
        if (!store.split) {
            // 카드가 좁아져도 모델이 잘리지 않을 만큼만 카메라를 물린다(닫을 때 되돌림)
            dolly = fitDollyFactor();
            dollyMain(dolly);
            copyCamera(store.viewer, before);
            store.split = true;
            root.classList.add("is-split");
            startLoop();
            emit("split", true);
        }
        resetSummaryFilters();
        syncSliders();
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
        requestAnimationFrame(() => updateDiffTabsIndicator(getActiveTabIndex()));
    };

    store.closeSplit = () => {
        if (!store.split) return;
        store.split = false;
        root.classList.remove("is-split");
        clearHighlight();
        state.isolatedCategories.clear();
        state.isolatedMaterials.clear();
        state.activeChange = null;
        state.isolateIdsBefore = null;
        state.isolateIdsAfter = null;
        store.allGroup.forEach((group) => setGroupGhosted(group, false));
        if (dolly) dollyMain(1 / dolly);
        dolly = 0;
        emit("split", false);
        emit("visibility");     // 메인 뷰어 가시성을 타임라인 기준으로 되돌림
        setTimeout(() => { if (!store.split) stopLoop(); }, 650);
    };

    // 분할 중에는 메인(After) 뷰어의 가시성도 비교 규칙(격리 · Ghost)으로 정한다
    store.applyMainVisibility = () => applyTimeState("after");

    on("time:main", () => {
        if (!store.split) return;
        syncSliders();
        resetSummaryFilters();
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
    });
    on("filters", () => {
        if (!store.split) return;
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
    });
    on("pins", () => { if (before) renderPinMarkers(); });

    // ── 기존 비교 화면과 같은 컨트롤 ───────────────────────────────────────────
    diffReset?.addEventListener("click", () => {
        state.isolatedCategories.clear();
        state.isolatedMaterials.clear();
        state.isolateIdsBefore = null;
        state.isolateIdsAfter = null;
        state.activeChange = null;
        clearHighlight();
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
    });

    materialHideZero?.addEventListener("change", () => updateDiffPanel());

    beforeSlider.addEventListener("input", () => {
        state.beforeIndex = Number(beforeSlider.value);
        updateSliderFill(beforeSlider, "right");
        resetSummaryFilters();
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
        renderPinMarkers();
        if (beforeTooltip) {
            showTooltip(beforeTooltip, beforeSlider, formatTimeLabel(store.timeKeys[state.beforeIndex]));
            clearTimeout(beforeHideTimer);
            beforeHideTimer = setTimeout(() => hideTooltip(beforeTooltip), 700);
        }
    });

    afterSlider.addEventListener("input", () => {
        store.setMainIndex?.(Number(afterSlider.value));   // → time:main 에서 갱신
        if (afterTooltip) {
            showTooltip(afterTooltip, afterSlider, formatTimeLabel(store.timeKeys[store.mainIndex]));
            clearTimeout(afterHideTimer);
            afterHideTimer = setTimeout(() => hideTooltip(afterTooltip), 700);
        }
    });

    diffTabs.forEach((tab, index) => {
        tab.addEventListener("click", () => {
            const target = tab.getAttribute("data-diff-tab");
            if (!target) return;
            state.activeTab = target;
            diffTabs.forEach((btn) => btn.classList.toggle("is-active", btn === tab));
            updateDiffTabsIndicator(index);
            updateDiffPanel();
            animateSections(diffSections);
        });
    });

    if (diffTabsContainer) {
        new ResizeObserver(() => updateDiffTabsIndicator(getActiveTabIndex())).observe(diffTabsContainer);
    }

    diffSections.forEach((section) => {
        section.addEventListener("animationend", () => section.classList.remove("diff-section-slide"));
    });

    function renderBeforeSaved() {
        renderSaved(
            beforeSaved,
            state.savedBefore,
            (value) => {
                state.beforeIndex = store.timeKeys.indexOf(value);
                beforeSlider.value = state.beforeIndex;
                updateSliderFill(beforeSlider, "right");
                applyTimeState("before");
                restoreCamera(before, state.savedBeforeCam.get(value));
                updateDiffPanel();
                renderPinMarkers();
            },
            (value) => {
                state.savedBefore = state.savedBefore.filter((item) => item !== value);
                state.savedBeforeCam.delete(value);
                renderBeforeSaved();
            }
        );
    }

    function renderAfterSaved() {
        renderSaved(
            afterSaved,
            state.savedAfter,
            (value) => {
                store.setMainIndex?.(store.timeKeys.indexOf(value));
                restoreCamera(store.viewer, state.savedAfterCam.get(value));
            },
            (value) => {
                state.savedAfter = state.savedAfter.filter((item) => item !== value);
                state.savedAfterCam.delete(value);
                renderAfterSaved();
            }
        );
    }

    beforeSave?.addEventListener("click", () => {
        const timeKey = store.timeKeys[state.beforeIndex];
        saveTime(state.savedBefore, timeKey);
        state.savedBeforeCam.set(timeKey, captureCamera(before));
        renderBeforeSaved();
    });

    afterSave?.addEventListener("click", () => {
        const timeKey = store.timeKeys[store.mainIndex];
        saveTime(state.savedAfter, timeKey);
        state.savedAfterCam.set(timeKey, captureCamera(store.viewer));
        renderAfterSaved();
    });

    isolateGhostToggle?.addEventListener("change", () => {
        state.isolationMode = isolateGhostToggle.checked ? "ghost" : "hide";
        applyTimeState("before");
        applyTimeState("after");
    });

    // ── Before 뷰어 (처음 열 때 한 번) ─────────────────────────────────────────
    function ensureBuilt() {
        if (before) return;
        const main = store.viewer;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#edf0f4");
        [[0, 3, 0], [0, 3, 5], [5, 3, 0], [-5, 3, 5], [5, 3, -5], [0, 3, -5], [-5, 3, 0]].forEach((pos) => {
            const light = new THREE.DirectionalLight(0xffffff, 0.7);
            light.position.set(...pos);
            scene.add(light);
        });
        scene.add(new THREE.AmbientLight(0x000000));

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        beforeTarget.appendChild(renderer.domElement);

        const camera = new THREE.PerspectiveCamera(main.camera.fov, 1, main.camera.near, main.camera.far);
        const controls = new OrbitControls(camera, renderer.domElement);
        const mctl = main.controls;
        Object.assign(controls, {
            enableDamping: mctl.enableDamping,
            dampingFactor: mctl.dampingFactor,
            screenSpacePanning: mctl.screenSpacePanning,
            minDistance: mctl.minDistance,
            maxDistance: mctl.maxDistance,
            maxPolarAngle: mctl.maxPolarAngle,
            rotateSpeed: mctl.rotateSpeed,
            zoomToCursor: mctl.zoomToCursor,
        });

        const syncSize = () => {
            const w = beforeTarget.clientWidth, h = beforeTarget.clientHeight;
            if (w < 2 || h < 2) return false;
            const cur = renderer.getSize(new THREE.Vector2());
            if (cur.x !== w || cur.y !== h) {
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                renderer.setSize(w, h);
            }
            return true;
        };
        new ResizeObserver(syncSize).observe(beforeTarget);

        // 메인 뷰어의 형상(geometry)을 공유하고 재질만 복제 — 로그를 다시 읽지 않는다
        const allGroup = [];
        const meshDict = {};
        for (const g of store.allGroup) {
            const ng = new THREE.Group();
            ng.name = g.name;
            ng.userData = g.userData;
            ng.visible = false;
            for (const m of g.children) {
                if (!m.isMesh) continue;
                const mat = m.material.clone();
                if (mat.emissive) mat.emissive.setHex(0x000000);
                const nm = new THREE.Mesh(m.geometry, mat);
                nm.position.copy(m.position);
                nm.quaternion.copy(m.quaternion);
                nm.scale.copy(m.scale);
                for (const c of m.children) {
                    if (!c.isLineSegments) continue;
                    const line = new THREE.LineSegments(c.geometry, c.material);
                    line.renderOrder = c.renderOrder;
                    nm.add(line);
                }
                ng.add(nm);
            }
            scene.add(ng);
            allGroup.push(ng);
            if (g.name) meshDict[g.name] = ng;
        }

        before = {
            scene, camera, renderer, controls,
            // 캡처 직전: 분할을 막 열어 ResizeObserver 가 아직 안 돌았어도 실제 크기로 맞춰 한 번 그린다
            prepareCapture() {
                const ok = syncSize();
                controls.update();
                renderer.render(scene, camera);
                return ok;
            },
        };
        beforeMeshes = { allGroup, meshDict };
        store.compareViewer = before;   // AI 요약이 A 화면을 캡처할 때 쓴다
        shapeIndex = buildShapeIndex(store.shapeLog || []);
        cacheOriginalColors(beforeMeshes.allGroup);
        cacheOriginalColors(store.allGroup);

        if (syncCamera) {
            controls.addEventListener("change", () => {
                if (store.split) syncCameras(before, store.viewer, syncCamera, state);
            });
            mctl.addEventListener("change", () => {
                if (store.split) syncCameras(store.viewer, before, syncCamera, state);
            });
        }

        clickEvent(renderer, camera, allGroup, { chip: document.getElementById("pick-before"), panel: false });
        renderBeforeSaved();
        renderAfterSaved();
    }

    function startLoop() {
        if (raf) return;
        const loop = () => {
            raf = requestAnimationFrame(loop);
            before.controls.update();
            before.renderer.render(before.scene, before.camera);
        };
        loop();
    }

    function stopLoop() {
        cancelAnimationFrame(raf);
        raf = 0;
    }

    function copyCamera(src, dst) {
        state.syncingCamera = true;
        dst.camera.near = src.camera.near;
        dst.camera.far = src.camera.far;
        dst.camera.updateProjectionMatrix();
        dst.camera.position.copy(src.camera.position);
        dst.camera.quaternion.copy(src.camera.quaternion);
        dst.controls.target.copy(src.controls.target);
        dst.controls.update();
        state.syncingCamera = false;
    }

    // 분할 후 카드 크기에서 지금 보이는 모델 전체가 들어오려면 몇 배 물러나야 하는지.
    // 이미 들어오면 1(그대로), 최대로는 폭이 줄어든 비율까지만.
    function fitDollyFactor() {
        const { camera, controls, container } = store.viewer;
        const stage = document.getElementById("stage");
        const oldWidth = container.clientWidth;
        const newWidth = Math.max(1, (stage.clientWidth - 30) / 2 - 20);
        const newHeight = Math.max(1, container.clientHeight - 120);   // 카드 헤더 + Revision 컨트롤
        const widthRatio = Math.max(1, oldWidth / newWidth);

        const box = new THREE.Box3();
        for (const g of store.allGroup) if (g.visible) box.expandByObject(g);
        if (box.isEmpty()) return widthRatio;

        const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
        const vFov = (camera.fov * Math.PI) / 180;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (newWidth / newHeight));
        const needed = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 0.9;
        const current = camera.position.distanceTo(controls.target) || 1;
        return Math.min(widthRatio, Math.max(1, needed / current));
    }

    // 메인 카메라를 중심(target)에서 factor 배만큼 멀리/가깝게
    function dollyMain(factor) {
        const { camera, controls } = store.viewer;
        const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
        camera.position.copy(controls.target).add(offset);
        controls.update();
    }

    function clampIndex(i) {
        const n = store.timeKeys.length;
        return Math.max(0, Math.min(n - 1, Number.isFinite(i) ? i : 0));
    }

    // 처음 열 때 Before 는 직전 핀(없으면 기존 비교 화면과 같이 첫 리비전)
    function defaultBeforeIndex() {
        const prev = prevPinBefore(store.mainIndex);
        return prev ? prev.index : 0;
    }

    function syncSliders() {
        const max = Math.max(0, store.timeKeys.length - 1);
        beforeSlider.min = 0;
        beforeSlider.max = max;
        beforeSlider.value = state.beforeIndex;
        afterSlider.min = 0;
        afterSlider.max = max;
        afterSlider.value = store.mainIndex;
        updateSliderFill(beforeSlider, "right");
        updateSliderFill(afterSlider, "left");
        renderPinMarkers();
    }

    function renderPinMarkers() {
        renderMarkers(beforePins, state.beforeIndex, (i) => {
            beforeSlider.value = i;
            beforeSlider.dispatchEvent(new Event("input"));
        });
        renderMarkers(afterPins, store.mainIndex, (i) => store.setMainIndex?.(i));
        setPinLabel(beforePinLabel, pinAtIndex(state.beforeIndex));
        setPinLabel(afterPinLabel, pinAtIndex(store.mainIndex));
    }

    function setPinLabel(el, pin) {
        if (!el) return;
        el.hidden = !pin;
        if (pin) el.innerHTML = `${icon("pinSolid", 13)}<span>${escapeHtml(pin.title)}</span>`;
    }

    // ── 층 · 카테고리 필터(하단)를 요소 목록에 먼저 적용 ─────────────────────
    function storeFiltered() {
        return Boolean(store.levelFilter) || store.hiddenCats.size > 0;
    }

    function allowed(meshes, ids) {
        return ids.filter((id) => {
            const g = meshes.meshDict[id];
            return !g || (g.userData?.visible !== false && passesFilters(g));
        });
    }

    function elementsAt(index, meshes) {
        return allowed(meshes, store.timeLog[store.timeKeys[index]]?.Elements || []);
    }

    function getFilteredElements(index, meshes, categories, materials) {
        return filterIdsByCategoriesAndMaterials(meshes, elementsAt(index, meshes), categories, materials, shapeIndex);
    }

    // ── 이하 기존 비교 화면(diffView.js)과 같은 흐름 ────────────────────────────
    function applyTimeState(which) {
        if (!before) return;
        const isBefore = which === "before";
        const meshes = isBefore ? beforeMeshes : afterMeshes;
        const allIds = elementsAt(isBefore ? state.beforeIndex : store.mainIndex, meshes);
        const isolateIds = isBefore ? state.isolateIdsBefore : state.isolateIdsAfter;
        const baseIds = isolateIds ? allowed(meshes, isolateIds) : allIds;
        const filtered = filterIdsByCategoriesAndMaterials(
            meshes,
            baseIds,
            state.isolatedCategories,
            state.isolatedMaterials,
            shapeIndex
        );
        const filtersActive =
            state.isolatedCategories.size > 0 ||
            state.isolatedMaterials.size > 0 ||
            Boolean(state.activeChange);
        if (!filtersActive) {
            setVisibleByIds(meshes, allIds, { ghostNonIsolated: false });
            return;
        }
        const ghostNonIsolated = state.isolationMode === "ghost";
        setVisibleByIds(meshes, filtered, { baseIds: allIds, ghostNonIsolated });
    }

    function updateDiffPanel() {
        if (!before || !store.split) return;
        const timeJson = store.timeLog;
        const beforeKey = store.timeKeys[state.beforeIndex];
        const afterKey = store.timeKeys[store.mainIndex];
        const filteredBefore = getFilteredElements(state.beforeIndex, beforeMeshes, state.isolatedCategories, state.isolatedMaterials);
        const filteredAfter = getFilteredElements(store.mainIndex, afterMeshes, state.isolatedCategories, state.isolatedMaterials);
        const baseDiff = diffElementVersionsFromLists(filteredBefore, filteredAfter);
        const changeAdjusted = applyChangeFilterToDiff(baseDiff, state.activeChange);
        const diff = changeAdjusted.diff;

        // AI 요약이 읽을 현재 비교 상태 (숫자는 여기서 계산된 것만 쓴다)
        store.compareState = () => ({
            beforeIndex: state.beforeIndex,
            afterIndex: store.mainIndex,
            beforeKey,
            afterKey,
            diff,
            filters: {
                level: store.levelFilter,
                hiddenCategories: [...store.hiddenCats],
                isolatedCategories: [...state.isolatedCategories],
                isolatedMaterials: [...state.isolatedMaterials],
                change: state.activeChange,
            },
        });

        const pinA = pinAtIndex(state.beforeIndex);
        const pinB = pinAtIndex(store.mainIndex);
        diffSummary.innerHTML = `
            <div class="diff-summary-card">
                <div class="diff-summary-title"><span class="tag tag--solid tone-before">A</span>이전</div>
                <div class="diff-summary-value">${formatTimeLabelSingleLine(beforeKey)}</div>
                ${pinA ? `<div class="diff-summary-pin">${icon("pinSolid", 11)}<span>${escapeHtml(pinA.title)}</span></div>` : ""}
            </div>
            <div class="diff-summary-card">
                <div class="diff-summary-title"><span class="tag tag--solid tone-accent">B</span>현재</div>
                <div class="diff-summary-value">${formatTimeLabelSingleLine(afterKey)}</div>
                ${pinB ? `<div class="diff-summary-pin">${icon("pinSolid", 11)}<span>${escapeHtml(pinB.title)}</span></div>` : ""}
            </div>
        `;

        const beforeQuantity = timeJson[beforeKey]?.Quantity || {};
        const afterQuantity = timeJson[afterKey]?.Quantity || {};
        const merged = mergeQuantities(beforeQuantity, afterQuantity);
        const sorted = sortByCategoryOrder(merged);
        const quantityFiltered = sorted.filter((row) => {
            const key = normalizeCategoryKey(row.category || row.label || "");
            return (
                key === normalizeCategoryKey("Walls") ||
                key === normalizeCategoryKey("Ceilings") ||
                key === normalizeCategoryKey("Floors")
            );
        });
        renderTableList(diffQuantity, quantityFiltered, state.isolatedCategories, toggleIsolate);

        if (diffCounts) {
            const countOptions = storeFiltered()
                ? {
                    filtered: true,
                    beforeElements: elementsAt(state.beforeIndex, beforeMeshes),
                    afterElements: elementsAt(store.mainIndex, afterMeshes),
                }
                : { filtered: false };
            const countRows = buildCountRows(
                timeJson,
                beforeKey,
                afterKey,
                beforeMeshes.meshDict,
                afterMeshes.meshDict,
                countOptions
            );
            renderTableList(diffCounts, sortCountRows(countRows), state.isolatedCategories, toggleIsolate);
        }

        if (diffMaterials) {
            const hideZero = Boolean(materialHideZero?.checked);
            let materialGroups = [];
            const useFiltersForMaterials =
                state.isolatedCategories.size > 0 || Boolean(state.activeChange) || storeFiltered();
            if (useFiltersForMaterials) {
                const materialsBefore = getFilteredElements(state.beforeIndex, beforeMeshes, state.isolatedCategories, new Set());
                const materialsAfter = getFilteredElements(store.mainIndex, afterMeshes, state.isolatedCategories, new Set());
                const baseDiffForMaterials = diffElementVersionsFromLists(materialsBefore, materialsAfter);
                const changeAdjustedForMaterials = applyChangeFilterToDiff(baseDiffForMaterials, state.activeChange);
                materialGroups = buildLayerMaterialGroups(
                    beforeMeshes.meshDict,
                    afterMeshes.meshDict,
                    changeAdjustedForMaterials.beforeList,
                    changeAdjustedForMaterials.afterList,
                    hideZero
                );
            } else {
                materialGroups = buildMaterialGroups(timeJson, beforeKey, afterKey, hideZero);
            }
            renderMaterialList(
                diffMaterials,
                materialGroups,
                state.isolatedMaterials,
                toggleMaterialFilter,
                state.openMaterialGroups,
                toggleMaterialGroup
            );
        }

        const logStats = buildLogStats(diff, changeAdjusted.beforeList.length, changeAdjusted.afterList.length);
        diffCitations.innerHTML = "";
        logStats.forEach((stat) => {
            const row = document.createElement("div");
            row.className = "diff-row";
            row.innerHTML = `
                <div class="diff-row-title">${stat.label}</div>
                <div class="diff-row-values">
                    <span class="diff-value">${stat.value}</span>
                </div>
            `;
            if (stat.action) {
                row.classList.add("is-clickable");
                if (state.activeChange === stat.action) row.classList.add("is-selected");
                row.addEventListener("click", () => toggleChangeFilter(stat.action));
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "diff-highlight-btn btn btn--xs btn--soft";
                btn.textContent = "강조";
                if (state.highlightChanges.has(stat.action)) btn.classList.add("is-active");
                btn.addEventListener("click", (event) => {
                    event.stopPropagation();
                    toggleHighlightChange(stat.action);
                });
                row.querySelector(".diff-row-values")?.appendChild(btn);
            }
            diffCitations.appendChild(row);
        });

        applyTabVisibility();
        updateActiveFiltersUI();
    }

    function applyTabVisibility() {
        diffSummary.style.display = "grid";
        const ai = document.getElementById("ai-summary");
        if (ai) ai.style.display = state.activeTab === "summary" ? "flex" : "none";
        diffQuantity.parentElement.style.display = state.activeTab === "quantities" ? "block" : "none";
        diffCounts.parentElement.style.display = state.activeTab === "counts" ? "block" : "none";
        diffMaterials.parentElement.style.display = state.activeTab === "materials" ? "block" : "none";
        diffCitations.parentElement.style.display = state.activeTab === "summary" ? "block" : "none";
    }

    function getActiveTabIndex() {
        return Array.from(diffTabs).findIndex((tab) => tab.classList.contains("is-active"));
    }

    function updateDiffTabsIndicator(index) {
        if (!diffTabsContainer) return;
        const safeIndex = index >= 0 ? index : 0;
        const width = diffTabsContainer.clientWidth || 1;
        const columns = width <= 420 ? 2 : 4;
        const rows = Math.ceil(diffTabs.length / columns);
        diffTabsContainer.style.setProperty("--tab-columns", columns);
        diffTabsContainer.style.setProperty("--tab-rows", rows);
        diffTabsContainer.style.setProperty("--active-col", safeIndex % columns);
        diffTabsContainer.style.setProperty("--active-row", Math.floor(safeIndex / columns));
    }

    function animateSections(sections) {
        sections.forEach((section) => {
            section.classList.remove("diff-section-slide");
            void section.offsetWidth;
            section.classList.add("diff-section-slide");
        });
    }

    function isolateIdsForChange(action) {
        const diff = diffElementVersions(store.timeLog, store.timeKeys[state.beforeIndex], store.timeKeys[store.mainIndex]);
        if (action === "added") {
            state.isolateIdsAfter = diff.addedIds;
            state.isolateIdsBefore = null;
        } else if (action === "deleted") {
            state.isolateIdsBefore = diff.deletedIds;
            state.isolateIdsAfter = null;
        } else if (action === "modified") {
            state.isolateIdsBefore = diff.modified.before;
            state.isolateIdsAfter = diff.modified.after;
        } else if (action === "unchanged") {
            state.isolateIdsBefore = diff.unchangedIds;
            state.isolateIdsAfter = diff.unchangedIds;
        }
    }

    function toggleIsolate(category) {
        if (state.isolatedCategories.has(category)) state.isolatedCategories.delete(category);
        else state.isolatedCategories.add(category);
        if (state.activeChange) {
            isolateIdsForChange(state.activeChange);
        } else {
            state.isolateIdsBefore = null;
            state.isolateIdsAfter = null;
        }
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
    }

    function toggleMaterialFilter(material, category) {
        const key = normalizeMaterialFilterKey(material, category);
        if (state.isolatedMaterials.has(key)) state.isolatedMaterials.delete(key);
        else state.isolatedMaterials.add(key);
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
    }

    function toggleMaterialGroup(category, isOpen) {
        if (isOpen) state.openMaterialGroups.add(category);
        else state.openMaterialGroups.delete(category);
    }

    function resetSummaryFilters() {
        state.activeChange = null;
        state.isolateIdsBefore = null;
        state.isolateIdsAfter = null;
        clearHighlight();
    }

    function toggleChangeFilter(action) {
        if (state.activeChange === action) {
            state.activeChange = null;
            state.isolateIdsBefore = null;
            state.isolateIdsAfter = null;
        } else {
            state.activeChange = action;
            isolateIdsForChange(action);
        }
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
    }

    function toggleHighlightChange(action) {
        if (state.highlightChanges.has(action)) state.highlightChanges.delete(action);
        else state.highlightChanges.add(action);
        applyHighlightChanges();
        updateDiffPanel();
    }

    function clearHighlight() {
        state.highlightChanges.clear();
        if (beforeMeshes) resetGroupColors(beforeMeshes.allGroup);
        resetGroupColors(store.allGroup);
    }

    function applyHighlightChanges() {
        resetGroupColors(beforeMeshes.allGroup);
        resetGroupColors(afterMeshes.allGroup);
        if (!state.highlightChanges.size) return;
        const timeJson = store.timeLog;
        const beforeKey = store.timeKeys[state.beforeIndex];
        const afterKey = store.timeKeys[store.mainIndex];
        const diff = diffElementVersions(timeJson, beforeKey, afterKey);
        const beforeSet = new Set(timeJson[beforeKey]?.Elements || []);
        const afterSet = new Set(timeJson[afterKey]?.Elements || []);
        state.highlightChanges.forEach((action) => {
            if (action === "added") {
                colorElementsById(afterMeshes.meshDict, diff.addedIds.filter((id) => afterSet.has(id)), 0x3dff7a);
            } else if (action === "deleted") {
                colorElementsById(beforeMeshes.meshDict, diff.deletedIds.filter((id) => beforeSet.has(id)), 0xff4d4d);
            } else if (action === "modified") {
                colorElementsById(beforeMeshes.meshDict, diff.modified.before.filter((id) => beforeSet.has(id)), 0xffe600);
                colorElementsById(afterMeshes.meshDict, diff.modified.after.filter((id) => afterSet.has(id)), 0xffe600);
            } else if (action === "unchanged") {
                const ids = diff.unchangedIds.filter((id) => beforeSet.has(id) && afterSet.has(id));
                colorElementsById(beforeMeshes.meshDict, ids, 0x7ecbff);
                colorElementsById(afterMeshes.meshDict, ids, 0x7ecbff);
            }
        });
    }

    function updateActiveFiltersUI() {
        if (!diffActiveFilters) return;
        diffActiveFilters.innerHTML = "";
        const categories = Array.from(state.isolatedCategories);
        const materials = Array.from(state.isolatedMaterials);
        const change = state.activeChange;
        const hasFilters = Boolean(categories.length || materials.length || change);
        if (diffReset) {
            diffReset.disabled = !hasFilters;
            diffReset.classList.toggle("is-disabled", !hasFilters);
        }
        if (!hasFilters) {
            diffActiveFilters.innerHTML = `<div class="diff-filter-empty">고른 필터가 없어요. 아래 항목을 누르면 그것만 보여요.</div>`;
            return;
        }
        const addGroup = (title, items, labelOf, onClick) => {
            const group = document.createElement("div");
            group.className = "diff-filter-group";
            group.innerHTML = `<div class="diff-filter-title">${title}</div>`;
            const tags = document.createElement("div");
            tags.className = "diff-filter-tags";
            items.forEach((item) => {
                const tag = document.createElement("button");
                tag.type = "button";
                tag.className = "diff-filter-tag chip chip--sm is-on";
                tag.title = "눌러서 이 필터 빼기";
                tag.innerHTML = `<span>${escapeHtml(labelOf(item))}</span><span class="diff-filter-x chip__x" aria-hidden="true">${icon("x", 11)}</span>`;
                tag.addEventListener("click", () => onClick(item));
                tags.appendChild(tag);
            });
            group.appendChild(tags);
            diffActiveFilters.appendChild(group);
        };
        if (categories.length) addGroup("카테고리", categories, (c) => catInfo(c).label, toggleIsolate);
        if (materials.length) addGroup("재료", materials, formatMaterialFilterLabel, (m) => toggleMaterialFilter(m));
        if (change) {
            const label = { added: "추가", deleted: "삭제", modified: "수정" }[change] || "그대로";
            addGroup("변경", [change], () => label, toggleChangeFilter);
        }
    }
}
