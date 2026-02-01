import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadMeshes } from "./meshLoader.js";

export async function initDiffView() {
    const beforeTarget = document.getElementById("before-target");
    const afterTarget = document.getElementById("after-target");
    const beforeSlider = document.getElementById("before-slider");
    const afterSlider = document.getElementById("after-slider");
    const beforeSave = document.getElementById("before-save");
    const afterSave = document.getElementById("after-save");
    const beforeSaved = document.getElementById("before-saved");
    const afterSaved = document.getElementById("after-saved");
    const syncCamera = document.getElementById("sync-camera");
    const diffSummary = document.getElementById("diff-summary");
    const diffQuantity = document.getElementById("diff-quantity");
    const diffCounts = document.getElementById("diff-counts");
    const diffMaterials = document.getElementById("diff-materials");
    const diffCitations = document.getElementById("diff-citations");
    const diffActiveFilters = document.getElementById("diff-active-filters");
    const materialHideZero = document.getElementById("material-hide-zero");
    const llmSummaryBtn = document.getElementById("llm-summary-btn");
    const llmSummaryOutput = document.getElementById("llm-summary-output");
    const llmSummaryLoading = document.getElementById("llm-summary-loading");
    const diffSections = Array.from(
        document.querySelectorAll(".diff-section:not(.diff-section--no-anim)")
    ).filter(Boolean);
    const diffReset = document.getElementById("diff-reset");
    const isolateGhostToggle = document.getElementById("isolate-ghost");
    const diffTabs = document.querySelectorAll("[data-diff-tab]");
    const diffTabsContainer = document.querySelector(".diff-tabs");
    const diffPanelWrapper = document.getElementById("llm-panel-diff");

    if (!beforeTarget || !afterTarget || !beforeSlider || !afterSlider || !diffSummary || !diffQuantity || !diffCitations) {
        return;
    }

    const shapeJson = await loadJson("./src/finalLogs/shapeLogs1.json");
    const shapeByIdJson = await loadJson("./src/finalLogs/shapeLogs1_by_element_id.json");
    const timeJson = await loadJson("./src/finalLogs/timeLogs1.json");
    if (!shapeJson || !timeJson) return;

    const timeKeys = Object.keys(timeJson).sort();
    if (!timeKeys.length) return;

    const shapeIndex = buildShapeIndex(shapeJson);
    const quantityCategoryAllowlist = new Set(["Walls", "Ceilings", "Floors"]);

    const before = createViewer(beforeTarget);
    const after = createViewer(afterTarget);

    const beforeMeshes = loadMeshes(shapeJson, before.scene, 0.2);
    const afterMeshes = loadMeshes(shapeJson, after.scene, 0.2);
    addOutlines(beforeMeshes.allGroup);
    addOutlines(afterMeshes.allGroup);
    cacheOriginalColors(beforeMeshes.allGroup);
    cacheOriginalColors(afterMeshes.allGroup);
    setupElementSelection({
        before,
        after,
        beforeMeshes,
        afterMeshes,
        diffPanelWrapper,
    });

    const state = {
        timeKeys,
        beforeIndex: 0,
        afterIndex: timeKeys.length - 1,
        syncingTime: false,
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

    beforeSlider.min = 0;
    beforeSlider.max = timeKeys.length - 1;
    beforeSlider.value = state.beforeIndex;

    afterSlider.min = 0;
    afterSlider.max = timeKeys.length - 1;
    afterSlider.value = state.afterIndex;

    const beforeTooltip = attachSliderTooltip(beforeSlider);
    const afterTooltip = attachSliderTooltip(afterSlider);
    let beforeHideTimer = null;
    let afterHideTimer = null;
    updateSliderFill(beforeSlider, "right");
    updateSliderFill(afterSlider, "left");

    applyTimeState("before");
    applyTimeState("after");
    updateDiffPanel();

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

    materialHideZero?.addEventListener("change", () => {
        updateDiffPanel();
    });

    llmSummaryBtn?.addEventListener("click", async () => {
        const apiKey = getStoredKey();
        if (!apiKey) {
            openKeyModal();
            return;
        }
        if (!llmSummaryOutput || !llmSummaryLoading) return;
        setSummaryLoading(true);
        try {
            const beforeImage = captureViewerImage(before);
            const afterImage = captureViewerImage(after);
            const filterSummary = buildFilterSummary(state);
            const context = {
                ...(window.__LLM_CONTEXT__ || {}),
                filters: filterSummary,
                timeKeys: {
                    before: timeKeys[state.beforeIndex],
                    after: timeKeys[state.afterIndex],
                },
            };
            const summary = await requestLlmSummary(apiKey, context, {
                beforeImage,
                afterImage,
            });
            llmSummaryOutput.innerHTML = renderSummaryMarkdown(summary || "No summary generated.");
        } catch (error) {
            llmSummaryOutput.textContent = `Error: ${error.message || "request failed"}`;
        } finally {
            setSummaryLoading(false);
        }
    });

    beforeSlider.addEventListener("input", () => {
        state.beforeIndex = Number(beforeSlider.value);
        updateSliderFill(beforeSlider, "right");
        resetSummaryFilters();
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
        if (beforeTooltip) {
            const timeKey = timeKeys[state.beforeIndex];
            showTooltip(beforeTooltip, beforeSlider, formatTimeLabel(timeKey));
            clearTimeout(beforeHideTimer);
            beforeHideTimer = setTimeout(() => hideTooltip(beforeTooltip), 700);
        }
    });

    afterSlider.addEventListener("input", () => {
        state.afterIndex = Number(afterSlider.value);
        updateSliderFill(afterSlider, "left");
        resetSummaryFilters();
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
        if (afterTooltip) {
            const timeKey = timeKeys[state.afterIndex];
            showTooltip(afterTooltip, afterSlider, formatTimeLabel(timeKey));
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
        const observer = new ResizeObserver(() => updateDiffTabsIndicator(getActiveTabIndex()));
        observer.observe(diffTabsContainer);
    }

    diffSections.forEach((section) => {
        section.addEventListener("animationend", () => {
            section.classList.remove("diff-section-slide");
        });
    });

    function renderBeforeSaved() {
        renderSaved(
            beforeSaved,
            state.savedBefore,
            (value) => {
                state.beforeIndex = timeKeys.indexOf(value);
                beforeSlider.value = state.beforeIndex;
                updateSliderFill(beforeSlider, "right");
                applyTimeState("before");
                restoreCamera(before, state.savedBeforeCam.get(value));
                updateDiffPanel();
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
                state.afterIndex = timeKeys.indexOf(value);
                afterSlider.value = state.afterIndex;
                updateSliderFill(afterSlider, "left");
                applyTimeState("after");
                restoreCamera(after, state.savedAfterCam.get(value));
                updateDiffPanel();
            },
            (value) => {
                state.savedAfter = state.savedAfter.filter((item) => item !== value);
                state.savedAfterCam.delete(value);
                renderAfterSaved();
            }
        );
    }

    renderBeforeSaved();
    renderAfterSaved();

    beforeSave?.addEventListener("click", () => {
        const timeKey = timeKeys[state.beforeIndex];
        saveTime(state.savedBefore, timeKey);
        state.savedBeforeCam.set(timeKey, captureCamera(before));
        renderBeforeSaved();
    });

    afterSave?.addEventListener("click", () => {
        const timeKey = timeKeys[state.afterIndex];
        saveTime(state.savedAfter, timeKey);
        state.savedAfterCam.set(timeKey, captureCamera(after));
        renderAfterSaved();
    });

    if (syncCamera) {
        before.controls.addEventListener("change", () => syncCameras(before, after, syncCamera, state));
        after.controls.addEventListener("change", () => syncCameras(after, before, syncCamera, state));
    }

    if (isolateGhostToggle) {
        isolateGhostToggle.addEventListener("change", () => {
            state.isolationMode = isolateGhostToggle.checked ? "ghost" : "hide";
            applyTimeState("before");
            applyTimeState("after");
        });
    }

    animate();

    function animate() {
        requestAnimationFrame(animate);
        before.renderer.render(before.scene, before.camera);
        after.renderer.render(after.scene, after.camera);
    }

    function applyTimeState(which) {
        const isBefore = which === "before";
        const timeIndex = isBefore ? state.beforeIndex : state.afterIndex;
        const timeKey = timeKeys[timeIndex];
        const viewer = isBefore ? before : after;
        const meshes = isBefore ? beforeMeshes : afterMeshes;

        const allIds = timeJson[timeKey]?.Elements || [];
        const baseIds =
            isBefore && state.isolateIdsBefore
                ? state.isolateIdsBefore
                : !isBefore && state.isolateIdsAfter
                ? state.isolateIdsAfter
                : allIds;
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
        const beforeKey = timeKeys[state.beforeIndex];
        const afterKey = timeKeys[state.afterIndex];
        const filteredBefore = getFilteredElements(
            timeJson,
            beforeKey,
            beforeMeshes,
            state.isolatedCategories,
            state.isolatedMaterials,
            shapeIndex
        );
        const filteredAfter = getFilteredElements(
            timeJson,
            afterKey,
            afterMeshes,
            state.isolatedCategories,
            state.isolatedMaterials,
            shapeIndex
        );
        const baseDiff = diffElementVersionsFromLists(filteredBefore, filteredAfter);
        const changeAdjusted = applyChangeFilterToDiff(baseDiff, state.activeChange);
        const diff = changeAdjusted.diff;
        const diffContext = buildDiffContext(diff, shapeIndex);
        const quantityContext = buildQuantityContext(timeJson, beforeKey, afterKey);
        window.__LLM_CONTEXT__ = {
            beforeRevision: beforeKey,
            afterRevision: afterKey,
            quantity: quantityContext,
            diff: diffContext,
        };
        diffSummary.innerHTML = `
            <div class="diff-summary-card">
                <div class="diff-summary-title">Revision A</div>
                <div class="diff-summary-value">${formatTimeLabelSingleLine(beforeKey)}</div>
            </div>
            <div class="diff-summary-card">
                <div class="diff-summary-title">Revision B</div>
                <div class="diff-summary-value">${formatTimeLabelSingleLine(afterKey)}</div>
            </div>
        `;

        const beforeQuantity = timeJson[beforeKey]?.Quantity || {};
        const afterQuantity = timeJson[afterKey]?.Quantity || {};
        const merged = mergeQuantities(beforeQuantity, afterQuantity);
        const sorted = sortByCategoryOrder(merged);

        const quantityFiltered = sorted.filter((row) => {
            const label = row.category || row.label || "";
            const key = normalizeCategoryKey(label);
            return (
                key === normalizeCategoryKey("Walls") ||
                key === normalizeCategoryKey("Ceilings") ||
                key === normalizeCategoryKey("Floors")
            );
        });

        renderTableList(diffQuantity, quantityFiltered, state.isolatedCategories, toggleIsolate);

        if (diffCounts) {
            const countRows = buildCountRows(
                timeJson,
                beforeKey,
                afterKey,
                beforeMeshes.meshDict,
                afterMeshes.meshDict,
                {
                    filtered: false,
                }
            );
            const sortedCounts = sortCountRows(countRows);
            renderTableList(diffCounts, sortedCounts, state.isolatedCategories, toggleIsolate);
        }

        if (diffMaterials) {
            const hideZero = Boolean(materialHideZero?.checked);
            let materialGroups = [];
            const useFiltersForMaterials =
                state.isolatedCategories.size > 0 || Boolean(state.activeChange);
            if (useFiltersForMaterials) {
                const materialsBefore = getFilteredElements(
                    timeJson,
                    beforeKey,
                    beforeMeshes,
                    state.isolatedCategories,
                    new Set(),
                    shapeIndex
                );
                const materialsAfter = getFilteredElements(
                    timeJson,
                    afterKey,
                    afterMeshes,
                    state.isolatedCategories,
                    new Set(),
                    shapeIndex
                );
                const baseDiffForMaterials = diffElementVersionsFromLists(materialsBefore, materialsAfter);
                const changeAdjustedForMaterials = applyChangeFilterToDiff(
                    baseDiffForMaterials,
                    state.activeChange
                );
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

        const logStats = buildLogStats(
            diff,
            changeAdjusted.beforeList.length,
            changeAdjusted.afterList.length
        );
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
                if (state.activeChange === stat.action) {
                    row.classList.add("is-selected");
                }
                row.addEventListener("click", () => {
                    toggleChangeFilter(stat.action);
                });
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "diff-highlight-btn";
                btn.textContent = "Highlight";
                if (state.highlightChanges.has(stat.action)) {
                    btn.classList.add("is-active");
                }
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
        const showSummary = state.activeTab === "summary";
        const showCounts = state.activeTab === "counts";
        const showQuantities = state.activeTab === "quantities";
        const showMaterials = state.activeTab === "materials";
        diffSummary.style.display = "grid";
        diffQuantity.parentElement.style.display = showQuantities ? "block" : "none";
        diffCounts.parentElement.style.display = showCounts ? "block" : "none";
        diffMaterials.parentElement.style.display = showMaterials ? "block" : "none";
        diffCitations.parentElement.style.display = showSummary ? "block" : "none";
        if (llmSummaryOutput?.parentElement) {
            llmSummaryOutput.parentElement.style.display = showSummary ? "block" : "none";
        }
    }

    function getActiveTabIndex() {
        const list = Array.from(diffTabs);
        return list.findIndex((tab) => tab.classList.contains("is-active"));
    }

    function updateDiffTabsIndicator(index) {
        if (!diffTabsContainer) return;
        const safeIndex = index >= 0 ? index : 0;
        const width = diffTabsContainer.clientWidth || 1;
        const columns = width <= 420 ? 2 : 4;
        const rows = Math.ceil(diffTabs.length / columns);
        const col = safeIndex % columns;
        const row = Math.floor(safeIndex / columns);
        diffTabsContainer.style.setProperty("--tab-columns", columns);
        diffTabsContainer.style.setProperty("--tab-rows", rows);
        diffTabsContainer.style.setProperty("--active-col", col);
        diffTabsContainer.style.setProperty("--active-row", row);
    }

    function animateSections(sections) {
        sections.forEach((section) => {
            section.classList.remove("diff-section-slide");
            void section.offsetWidth;
            section.classList.add("diff-section-slide");
        });
    }
    function toggleIsolate(category) {
        if (state.isolatedCategories.has(category)) {
            state.isolatedCategories.delete(category);
        } else {
            state.isolatedCategories.add(category);
        }
        if (state.activeChange) {
            const diff = diffElementVersions(timeJson, timeKeys[state.beforeIndex], timeKeys[state.afterIndex]);
            if (state.activeChange === "added") {
                state.isolateIdsAfter = diff.addedIds;
                state.isolateIdsBefore = null;
            } else if (state.activeChange === "deleted") {
                state.isolateIdsBefore = diff.deletedIds;
                state.isolateIdsAfter = null;
            } else if (state.activeChange === "modified") {
                state.isolateIdsBefore = diff.modified.before;
                state.isolateIdsAfter = diff.modified.after;
            } else if (state.activeChange === "unchanged") {
                state.isolateIdsBefore = diff.unchangedIds;
                state.isolateIdsAfter = diff.unchangedIds;
            }
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
        if (state.isolatedMaterials.has(key)) {
            state.isolatedMaterials.delete(key);
        } else {
            state.isolatedMaterials.add(key);
        }
        if (state.isolatedMaterials.size) {
            console.debug("[MaterialFilter] Active materials:", Array.from(state.isolatedMaterials));
        }
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
    }

    function toggleMaterialGroup(category, isOpen) {
        if (isOpen) {
            state.openMaterialGroups.add(category);
        } else {
            state.openMaterialGroups.delete(category);
        }
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
            const diff = diffElementVersions(timeJson, timeKeys[state.beforeIndex], timeKeys[state.afterIndex]);
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
        applyTimeState("before");
        applyTimeState("after");
        updateDiffPanel();
    }

    function toggleHighlightChange(action) {
        if (state.highlightChanges.has(action)) {
            state.highlightChanges.delete(action);
        } else {
            state.highlightChanges.add(action);
        }
        applyHighlightChanges();
        updateDiffPanel();
    }

    function clearHighlight() {
        state.highlightChanges.clear();
        resetGroupColors(beforeMeshes.allGroup);
        resetGroupColors(afterMeshes.allGroup);
    }

    function applyHighlightChanges() {
        resetGroupColors(beforeMeshes.allGroup);
        resetGroupColors(afterMeshes.allGroup);
        if (!state.highlightChanges.size) return;
        const beforeKey = timeKeys[state.beforeIndex];
        const afterKey = timeKeys[state.afterIndex];
        const diff = diffElementVersions(timeJson, beforeKey, afterKey);
        const beforeSet = new Set(timeJson[beforeKey]?.Elements || []);
        const afterSet = new Set(timeJson[afterKey]?.Elements || []);
        state.highlightChanges.forEach((action) => {
            if (action === "added") {
                const ids = diff.addedIds.filter((id) => afterSet.has(id));
                colorElementsById(afterMeshes.meshDict, ids, 0x3dff7a);
            } else if (action === "deleted") {
            const ids = diff.deletedIds.filter((id) => beforeSet.has(id));
            colorElementsById(beforeMeshes.meshDict, ids, 0xff4d4d);
        } else if (action === "modified") {
            const beforeIds = diff.modified.before.filter((id) => beforeSet.has(id));
            const afterIds = diff.modified.after.filter((id) => afterSet.has(id));
            colorElementsById(beforeMeshes.meshDict, beforeIds, 0xffe600);
            colorElementsById(afterMeshes.meshDict, afterIds, 0xffe600);
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
            diffActiveFilters.innerHTML = `<div class="diff-filter-empty">No filters selected.</div>`;
            return;
        }
        if (categories.length) {
            const group = document.createElement("div");
            group.className = "diff-filter-group";
            group.innerHTML = `<div class="diff-filter-title">Categories</div>`;
            const tags = document.createElement("div");
            tags.className = "diff-filter-tags";
            categories.forEach((cat) => {
                const tag = document.createElement("button");
                tag.type = "button";
                tag.className = "diff-filter-tag";
                tag.innerHTML = `<span>${cat}</span><span class="diff-filter-x">x</span>`;
                tag.addEventListener("click", () => toggleIsolate(cat));
                tags.appendChild(tag);
            });
            group.appendChild(tags);
            diffActiveFilters.appendChild(group);
        }
        if (materials.length) {
            const group = document.createElement("div");
            group.className = "diff-filter-group";
            group.innerHTML = `<div class="diff-filter-title">Materials</div>`;
            const tags = document.createElement("div");
            tags.className = "diff-filter-tags";
            materials.forEach((mat) => {
                const tag = document.createElement("button");
                tag.type = "button";
                tag.className = "diff-filter-tag";
                tag.innerHTML = `<span>${formatMaterialFilterLabel(mat)}</span><span class="diff-filter-x">x</span>`;
                tag.addEventListener("click", () => toggleMaterialFilter(mat));
                tags.appendChild(tag);
            });
            group.appendChild(tags);
            diffActiveFilters.appendChild(group);
        }
        if (change) {
            const group = document.createElement("div");
            group.className = "diff-filter-group";
            group.innerHTML = `<div class="diff-filter-title">Change</div>`;
            const tags = document.createElement("div");
            tags.className = "diff-filter-tags";
            const label = change === "added" ? "Added" : change === "deleted" ? "Deleted" : "Modified";
            const tag = document.createElement("button");
            tag.type = "button";
            tag.className = "diff-filter-tag";
            tag.innerHTML = `<span>${label}</span><span class="diff-filter-x">x</span>`;
            tag.addEventListener("click", () => toggleChangeFilter(change));
            tags.appendChild(tag);
            group.appendChild(tags);
            diffActiveFilters.appendChild(group);
        }
    }

    function setSummaryLoading(isLoading) {
        if (llmSummaryBtn) {
            llmSummaryBtn.disabled = isLoading;
            llmSummaryBtn.textContent = isLoading ? "Summarizing..." : "Summarize";
        }
        if (llmSummaryLoading) {
            llmSummaryLoading.classList.toggle("is-active", isLoading);
            llmSummaryLoading.setAttribute("aria-hidden", String(!isLoading));
        }
    }

    function openKeyModal() {
        const modal = document.getElementById("llm-modal");
        if (!modal) return;
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
    }

    function renderSummaryMarkdown(text) {
        const escaped = escapeHtml(text || "");
        const withBold = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        return withBold.replace(/\n/g, "<br>");
    }

    function captureViewerImage(viewer) {
        if (!viewer?.renderer?.domElement) return null;
        try {
            return viewer.renderer.domElement.toDataURL("image/png");
        } catch (error) {
            console.warn("Failed to capture viewer image:", error);
            return null;
        }
    }

    function buildFilterSummary(currentState) {
        return {
            categories: Array.from(currentState.isolatedCategories || []),
            materials: Array.from(currentState.isolatedMaterials || []),
            change: currentState.activeChange || null,
            ghostMode: currentState.isolationMode === "ghost",
        };
    }

    // Expose scene control API for LLM/tooling
    window.__SCENE_API__ = {
        timeKeys,
        getCurrent: () => ({
            before: timeKeys[state.beforeIndex],
            after: timeKeys[state.afterIndex],
        }),
        getState: () => ({
            beforeTime: timeKeys[state.beforeIndex],
            afterTime: timeKeys[state.afterIndex],
            syncCamera: Boolean(syncCamera?.checked),
            activeCategories: Array.from(state.isolatedCategories),
            activeMaterials: Array.from(state.isolatedMaterials),
            activeChange: state.activeChange,
            savedTimes: [...state.savedBefore],
        }),
        setTime: (panel, timeKey) => {
            const index = timeKeys.indexOf(timeKey);
            if (index < 0) return;
            if (panel === "before") {
                state.beforeIndex = index;
                beforeSlider.value = index;
                updateSliderFill(beforeSlider, "right");
                applyTimeState("before");
            } else if (panel === "after") {
                state.afterIndex = index;
                afterSlider.value = index;
                updateSliderFill(afterSlider, "left");
                applyTimeState("after");
            } else {
                state.beforeIndex = index;
                state.afterIndex = index;
                beforeSlider.value = index;
                afterSlider.value = index;
                updateSliderFill(beforeSlider, "right");
                updateSliderFill(afterSlider, "left");
                applyTimeState("before");
                applyTimeState("after");
            }
            updateDiffPanel();
        },
        saveTimeLeft: (timeKey) => {
            const targetKey = timeKey || timeKeys[state.beforeIndex];
            if (!targetKey) return;
            const idx = timeKeys.indexOf(targetKey);
            if (idx >= 0) {
                state.beforeIndex = idx;
                beforeSlider.value = idx;
                updateSliderFill(beforeSlider, "right");
                applyTimeState("before");
            }
            saveTime(state.savedBefore, targetKey);
            state.savedBeforeCam.set(targetKey, captureCamera(before));
            renderBeforeSaved();
            updateDiffPanel();
        },
        setSyncCamera: (enabled) => {
            if (!syncCamera) return;
            syncCamera.checked = Boolean(enabled);
        },
        setCategoryFilter: (categories = []) => {
            state.isolatedCategories = new Set(categories);
            applyTimeState("before");
            applyTimeState("after");
            updateDiffPanel();
        },
        setMaterialFilter: (materials = []) => {
            state.isolatedMaterials = new Set(materials);
            applyTimeState("before");
            applyTimeState("after");
            updateDiffPanel();
        },
        clearFilters: () => {
            state.isolatedCategories.clear();
            state.isolatedMaterials.clear();
            state.activeChange = null;
            state.isolateIdsBefore = null;
            state.isolateIdsAfter = null;
            applyTimeState("before");
            applyTimeState("after");
            updateDiffPanel();
        },
        setChangeFilter: (changeType) => {
            if (!changeType) return;
            toggleChangeFilter(changeType);
        },
        readTimeLog: (timeKey) => {
            const key = timeKey || timeKeys[state.beforeIndex];
            const entry = timeJson[key] || {};
            return { timeKey: key, elements: entry.Elements || [] };
        },
        readQuantityLog: (timeKey) => {
            const key = timeKey || timeKeys[state.beforeIndex];
            const entry = timeJson[key] || {};
            return { timeKey: key, quantity: entry.Quantity || {} };
        },
        readShapeLog: (elementIds = []) => {
            const dict = shapeByIdJson || {};
            const result = {};
            elementIds.forEach((id) => {
                const key = String(id);
                if (dict[key]) {
                    result[key] = dict[key];
                }
            });
            return result;
        },
        getVisibleElements: (panel = "before") => {
            const meshes = panel === "after" ? afterMeshes : beforeMeshes;
            return collectVisibleElements(meshes);
        },
        getVisibleByCategory: (panel = "before", category) => {
            const meshes = panel === "after" ? afterMeshes : beforeMeshes;
            return collectVisibleElements(meshes, category);
        },
        getVisibleStats: (panel = "before") => {
            const meshes = panel === "after" ? afterMeshes : beforeMeshes;
            return buildVisibleStats(meshes);
        },
        compareVisibleStats: () => {
            return {
                before: buildVisibleStats(beforeMeshes),
                after: buildVisibleStats(afterMeshes),
            };
        },
        colorByIds: (elementIds = [], colorHex) => {
            colorElementsById(beforeMeshes.meshDict, elementIds, colorHex);
            colorElementsById(afterMeshes.meshDict, elementIds, colorHex);
        },
        isolateCategories: (categories) => {
            state.isolatedCategories = new Set(categories || []);
            applyTimeState("before");
            applyTimeState("after");
            updateDiffPanel();
        },
        isolateMaterials: (materials) => {
            state.isolatedMaterials = new Set(materials || []);
            applyTimeState("before");
            applyTimeState("after");
            updateDiffPanel();
        },
        clearIsolation: () => {
            state.isolatedCategories.clear();
            state.isolatedMaterials.clear();
            state.activeChange = null;
            state.isolateIdsBefore = null;
            state.isolateIdsAfter = null;
            clearHighlight();
            applyTimeState("before");
            applyTimeState("after");
            updateDiffPanel();
        },
        setCategoryColor: (category, colorHex) => {
            applyCategoryColor(beforeMeshes.allGroup, category, colorHex);
            applyCategoryColor(afterMeshes.allGroup, category, colorHex);
        },
        resetColors: () => {
            resetGroupColors(beforeMeshes.allGroup);
            resetGroupColors(afterMeshes.allGroup);
        },
        restoreColors: () => {
            resetGroupColors(beforeMeshes.allGroup);
            resetGroupColors(afterMeshes.allGroup);
        },
        highlightChanged: (colorHex = 0xffd400) => {
            const beforeKey = timeKeys[state.beforeIndex];
            const afterKey = timeKeys[state.afterIndex];
            const changed = getChangedElements(timeJson, beforeKey, afterKey);
            colorElementsById(beforeMeshes.meshDict, changed, colorHex);
            colorElementsById(afterMeshes.meshDict, changed, colorHex);
        },
    };
}

function createViewer(container) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#F5F5DC");

    const lightPositions = [
        [0, 3, 0],
        [0, 3, 5],
        [5, 3, 0],
        [-5, 3, 5],
        [5, 3, -5],
        [0, 3, -5],
        [-5, 3, 0],
    ];

    lightPositions.forEach((pos) => {
        const light = new THREE.DirectionalLight(0xffffff, 0.7);
        light.position.set(...pos);
        light.castShadow = true;
        light.shadow.bias = -0.0005;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;
        scene.add(light);
    });

    scene.add(new THREE.AmbientLight(0x000000));

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(75, 1, 0.01, 5000);
    camera.position.set(0, 3, 10);
    camera.lookAt(0, 1, 0);

    const resize = () => {
        const width = container.clientWidth || 1;
        const height = container.clientHeight || 1;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
    };

    if ("ResizeObserver" in window) {
        const observer = new ResizeObserver(resize);
        observer.observe(container);
    } else {
        window.addEventListener("resize", resize);
    }
    resize();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI / 2;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.target.set(0, 0, 0);
    controls.update();

    return { scene, camera, renderer, controls };
}

function updateVisibleMeshes(allGroup, meshDict, timeJson, timeKey, isolatedCategories) {
    allGroup.forEach((group) => {
        group.visible = false;
    });
    const elements = timeJson[timeKey]?.Elements || [];
    for (const elementId of elements) {
        const group = meshDict[elementId];
        if (!group) continue;
        if (!isolatedCategories || isolatedCategories.size === 0) {
            group.visible = true;
            continue;
        }
        const category = getGroupCategory(group);
        if (category && isolatedCategories.has(category)) {
            group.visible = true;
        }
    }
}

function getBoundsForTime(timeJson, timeKey, meshDict) {
    const bounds = new THREE.Box3();
    let hasBounds = false;
    const elements = timeJson[timeKey]?.Elements || [];
    for (const elementId of elements) {
        const group = meshDict[elementId];
        if (!group) continue;
        const temp = new THREE.Box3().setFromObject(group);
        if (!isFinite(temp.min.x) || !isFinite(temp.max.x)) continue;
        bounds.union(temp);
        hasBounds = true;
    }
    if (!hasBounds) return null;
    return bounds;
}

function getModelBounds(groups) {
    const bounds = new THREE.Box3();
    let hasBounds = false;
    for (const group of groups) {
        if (!group) continue;
        const temp = new THREE.Box3().setFromObject(group);
        if (!isFinite(temp.min.x) || !isFinite(temp.max.x)) continue;
        bounds.union(temp);
        hasBounds = true;
    }
    if (!hasBounds) return null;
    return bounds;
}

function recenterCamera(camera, controls, center) {
    const offset = camera.position.clone().sub(controls.target);
    controls.target.copy(center);
    camera.position.copy(center).add(offset);
    camera.lookAt(center);
    controls.update();
}

function mergeQuantities(beforeQuantity, afterQuantity) {
    const categories = new Set([...Object.keys(beforeQuantity), ...Object.keys(afterQuantity)]);
    const result = [];
    categories.forEach((category) => {
        const beforeValue = extractCategoryTotal(beforeQuantity[category] || {});
        const afterValue = extractCategoryTotal(afterQuantity[category] || {});
        result.push({
            category,
            before: beforeValue,
            after: afterValue,
            delta: afterValue - beforeValue,
        });
    });
    return result;
}

const CATEGORY_ORDER = [
    "Walls",
    "Curtain Walls",
    "CurtainWalls",
    "Floors",
    "Ceilings",
    "Columns",
    "Structural Columns",
    "Windows",
    "Doors",
    "Stairs",
    "Railings",
];

function sortByCategoryOrder(items) {
    const order = new Map(CATEGORY_ORDER.map((name, index) => [normalizeCategoryKey(name), index]));
    return [...items].sort((a, b) => {
        const aKey = normalizeCategoryKey(a.category || "");
        const bKey = normalizeCategoryKey(b.category || "");
        const aOrder = order.has(aKey) ? order.get(aKey) : Number.MAX_SAFE_INTEGER;
        const bOrder = order.has(bKey) ? order.get(bKey) : Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return aKey.localeCompare(bKey);
    });
}

function sortCountRows(rows) {
    if (!rows.length) return rows;
    const header = rows[0];
    const rest = rows.slice(1);
    const sorted = sortByCategoryOrder(
        rest.map((row) => ({
            ...row,
            category: row.category || row.label,
        }))
    );
    return [header, ...sorted];
}

function normalizeCategoryKey(value) {
    return String(value)
        .toLowerCase()
        .replace(/[\s_]/g, "");
}

function formatCategoryLabel(value) {
    const label = String(value);
    if (!label.includes(" ") && /[a-z][A-Z]/.test(label)) {
        return label.replace(/([a-z])([A-Z])/g, "$1 $2");
    }
    return label;
}

function extractCategoryTotal(quantity) {
    const preferredKeys = ["All Volume", "All Length", "All Numbers"];
    for (const key of preferredKeys) {
        if (typeof quantity[key] === "number") return quantity[key];
    }
    return Object.values(quantity)
        .filter((value) => typeof value === "number")
        .reduce((sum, value) => sum + value, 0);
}

function buildLogStats(diff, beforeCount, afterCount) {
    const added = diff.addedIds.length;
    const deleted = diff.deletedIds.length;
    const modified = diff.modified.before.length;
    const unchanged = diff.unchangedIds?.length ?? 0;
    return [
        { label: "Added elements", value: added, action: "added" },
        { label: "Deleted elements", value: deleted, action: "deleted" },
        { label: "Modified elements", value: modified, action: "modified" },
        { label: "Unchanged elements", value: unchanged, action: "unchanged" },
    ];
}

function buildCountRows(
    timeJson,
    beforeKey,
    afterKey,
    beforeMeshDict,
    afterMeshDict,
    options = {}
) {
    const beforeElements = options.beforeElements || timeJson[beforeKey]?.Elements || [];
    const afterElements = options.afterElements || timeJson[afterKey]?.Elements || [];
    const rows = [
        {
            label: "Elements",
            before: beforeElements.length,
            after: afterElements.length,
            delta: afterElements.length - beforeElements.length,
        },
    ];
    const beforeQuantity = timeJson[beforeKey]?.Quantity || {};
    const afterQuantity = timeJson[afterKey]?.Quantity || {};
    const beforeCounts = buildCategoryCountsFromElements(beforeElements, beforeMeshDict);
    const afterCounts = buildCategoryCountsFromElements(afterElements, afterMeshDict);
    const useQuantity = !options.filtered;
    const allKeys = new Set([
        ...(useQuantity ? Object.keys(beforeQuantity) : []),
        ...(useQuantity ? Object.keys(afterQuantity) : []),
        ...Object.keys(beforeCounts),
        ...Object.keys(afterCounts),
    ]);
    const countMap = new Map();
    allKeys.forEach((category) => {
        const beforeCount = useQuantity
            ? beforeQuantity[category]?.["All Numbers"] ?? beforeCounts[category] ?? 0
            : beforeCounts[category] ?? 0;
        const afterCount = useQuantity
            ? afterQuantity[category]?.["All Numbers"] ?? afterCounts[category] ?? 0
            : afterCounts[category] ?? 0;
        const key = normalizeCategoryKey(category);
        if (!countMap.has(key)) {
            countMap.set(key, {
                label: category,
                category,
                before: 0,
                after: 0,
                delta: 0,
            });
        }
        const row = countMap.get(key);
        row.before += beforeCount;
        row.after += afterCount;
        row.delta = row.after - row.before;
    });

    const orderedKeys = [];
    const preferredLabel = new Map();
    CATEGORY_ORDER.forEach((name) => {
        const key = normalizeCategoryKey(name);
        if (!orderedKeys.includes(key)) orderedKeys.push(key);
        if (!preferredLabel.has(key)) {
            preferredLabel.set(key, formatCategoryLabel(name));
        }
    });

    orderedKeys.forEach((key) => {
        const row = countMap.get(key);
        const label = preferredLabel.get(key) || formatCategoryLabel(key);
        if (row) {
            row.label = label;
            row.category = label;
            rows.push(row);
        } else {
            const label = preferredLabel.get(key) || formatCategoryLabel(key);
            rows.push({
                label,
                category: label,
                before: 0,
                after: 0,
                delta: 0,
            });
        }
    });

    // Append any remaining categories not in the preferred order
    countMap.forEach((row, key) => {
        if (!orderedKeys.includes(key)) {
            rows.push(row);
        }
    });
    return rows;
}

function getFilteredElements(timeJson, timeKey, meshes, categories, materials, shapeIndex) {
    const elements = timeJson[timeKey]?.Elements || [];
    return filterIdsByCategoriesAndMaterials(meshes, elements, categories, materials, shapeIndex);
}

function diffElementVersionsFromLists(beforeList, afterList) {
    const beforeMap = buildBaseIdMap(beforeList);
    const afterMap = buildBaseIdMap(afterList);

    const addedIds = [];
    const deletedIds = [];
    const modified = { before: [], after: [] };
    const unchangedIds = [];

    for (const [baseId, beforeVersion] of beforeMap) {
        if (!afterMap.has(baseId)) {
            deletedIds.push(beforeVersion);
        } else {
            const afterVersion = afterMap.get(baseId);
            if (afterVersion !== beforeVersion) {
                modified.before.push(beforeVersion);
                modified.after.push(afterVersion);
            } else {
                unchangedIds.push(beforeVersion);
            }
        }
    }

    for (const [baseId, afterVersion] of afterMap) {
        if (!beforeMap.has(baseId)) {
            addedIds.push(afterVersion);
        }
    }

    return { addedIds, deletedIds, modified, unchangedIds };
}

function applyChangeFilterToDiff(diff, change) {
    if (!change) {
        return {
            diff,
            beforeList: [
                ...diff.deletedIds,
                ...diff.modified.before,
                ...diff.unchangedIds,
            ],
            afterList: [
                ...diff.addedIds,
                ...diff.modified.after,
                ...diff.unchangedIds,
            ],
        };
    }
    if (change === "added") {
        return { diff: { ...diff, deletedIds: [], modified: { before: [], after: [] }, unchangedIds: [] }, beforeList: [], afterList: diff.addedIds };
    }
    if (change === "deleted") {
        return { diff: { ...diff, addedIds: [], modified: { before: [], after: [] }, unchangedIds: [] }, beforeList: diff.deletedIds, afterList: [] };
    }
    if (change === "modified") {
        return { diff: { ...diff, addedIds: [], deletedIds: [], unchangedIds: [] }, beforeList: diff.modified.before, afterList: diff.modified.after };
    }
    if (change === "unchanged") {
        return { diff: { ...diff, addedIds: [], deletedIds: [], modified: { before: [], after: [] } }, beforeList: diff.unchangedIds, afterList: diff.unchangedIds };
    }
    return { diff, beforeList: [], afterList: [] };
}

function buildCategoryCountsFromElements(elementIds, meshDict) {
    const counts = {};
    elementIds.forEach((id) => {
        const group = meshDict?.[id];
        if (!group) return;
        const category = getGroupCategory(group) || "Unknown";
        counts[category] = (counts[category] || 0) + 1;
    });
    return counts;
}

function buildLayerQuantityRows(
    timeJson,
    beforeKey,
    afterKey,
    beforeMeshDict,
    afterMeshDict,
    beforeElements,
    afterElements,
    mode
) {
    const beforeTotals = buildLayerTotalsByCategory(beforeMeshDict, beforeElements);
    const afterTotals = buildLayerTotalsByCategory(afterMeshDict, afterElements);
    const beforeQuantity = timeJson[beforeKey]?.Quantity || {};
    const afterQuantity = timeJson[afterKey]?.Quantity || {};
    const categories = new Set([
        ...Object.keys(beforeQuantity),
        ...Object.keys(afterQuantity),
        ...Object.keys(beforeTotals),
        ...Object.keys(afterTotals),
    ]);
    const rows = [];
    categories.forEach((category) => {
        const rawBefore = beforeTotals[category] ?? 0;
        const rawAfter = afterTotals[category] ?? 0;
        let before = rawBefore;
        let after = rawAfter;
        let delta = rawAfter - rawBefore;

        if (mode === "added") {
            before = 0;
            after = rawAfter;
            delta = rawAfter;
        } else if (mode === "deleted") {
            before = rawBefore;
            after = 0;
            delta = -rawBefore;
        } else if (mode === "modified") {
            before = rawBefore;
            after = rawAfter;
            delta = rawAfter - rawBefore;
        } else if (mode === "unchanged") {
            before = rawBefore;
            after = rawAfter;
            delta = rawAfter - rawBefore;
        }
        rows.push({
            category,
            before,
            after,
            delta,
        });
    });
    return rows;
}

function buildLayerMaterialTotals(meshDict, elementIds) {
    const totals = {};
    elementIds.forEach((id) => {
        const group = meshDict?.[id];
        if (!group) return;
        const category = getGroupCategory(group) || "Unknown";
        if (!isAllowedMaterialCategory(category)) return;
        const info = group.userData || {};
        const layers = info.Layers || [];
        if (Array.isArray(layers)) {
            layers.forEach((layer) => {
                if (!layer || typeof layer !== "object") return;
                const name = layer["Material Name"] || layer["Material"] || "Unknown Material";
                let amount = layer["Material Volume"];
                if (typeof amount !== "number" || !Number.isFinite(amount)) {
                    amount = 0;
                    Object.values(layer).forEach((value) => {
                        if (typeof value === "number" && Number.isFinite(value)) {
                            amount += value;
                        }
                    });
                }
                if (!Number.isFinite(amount)) return;
                totals[name] = (totals[name] || 0) + amount;
            });
            return;
        }
        Object.entries(layers).forEach(([key, value]) => {
            if (typeof value !== "number" || !Number.isFinite(value)) return;
            const name = key || "Unknown Material";
            totals[name] = (totals[name] || 0) + value;
        });
    });
    return totals;
}

function buildLayerMaterialGroups(beforeMeshDict, afterMeshDict, beforeElements, afterElements, hideZero) {
    const beforeTotals = buildLayerMaterialTotals(beforeMeshDict, beforeElements);
    const afterTotals = buildLayerMaterialTotals(afterMeshDict, afterElements);
    return buildMaterialGroupsFromTotals(beforeTotals, afterTotals, hideZero);
}

function buildLayerTotalsByCategory(meshDict, elementIds) {
    const totals = {};
    elementIds.forEach((id) => {
        const group = meshDict?.[id];
        if (!group) return;
        const category = getGroupCategory(group) || "Unknown";
        const info = group.userData || {};
        const layers = info.Layers || [];
        let sum = 0;

        if (Array.isArray(layers)) {
            layers.forEach((layer) => {
                if (!layer || typeof layer !== "object") return;
                const volume = layer["Material Volume"];
                if (typeof volume === "number" && Number.isFinite(volume)) {
                    sum += volume;
                    return;
                }
                Object.values(layer).forEach((value) => {
                    if (typeof value === "number" && Number.isFinite(value)) {
                        sum += value;
                    }
                });
            });
        } else {
            Object.values(layers).forEach((value) => {
                if (typeof value === "number" && Number.isFinite(value)) {
                    sum += value;
                }
            });
        }
        totals[category] = (totals[category] || 0) + sum;
    });
    return totals;
}

function isAllowedMaterialCategory(category) {
    const allowed = new Set([
        normalizeCategoryKey("Walls"),
        normalizeCategoryKey("Ceilings"),
        normalizeCategoryKey("Floors"),
    ]);
    return allowed.has(normalizeCategoryKey(category || ""));
}

function filterIdsByCategories(meshes, ids, categories) {
    if (!categories || categories.size === 0) return ids;
    const filtered = [];
    ids.forEach((id) => {
        const group = meshes.meshDict[id];
        if (!group) return;
        const category = getGroupCategory(group);
        if (category && categories.has(category)) {
            filtered.push(id);
        }
    });
    return filtered;
}

function filterIdsByCategoriesAndMaterials(meshes, ids, categories, materials, shapeIndex) {
    const useCategories = categories && categories.size > 0;
    const useMaterials = materials && materials.size > 0;
    if (!useCategories && !useMaterials) return ids;
    const materialEntries = useMaterials
        ? Array.from(materials).map(parseMaterialFilterKey).filter((entry) => entry.material)
        : [];
    const globalMaterialKeys = materialEntries
        .filter((entry) => !entry.categoryKey)
        .map((entry) => normalizeMaterialName(entry.material))
        .filter(Boolean);
    const scopedMaterialKeys = materialEntries.reduce((acc, entry) => {
        if (!entry.categoryKey) return acc;
        const key = normalizeCategoryKey(entry.categoryKey);
        const token = normalizeMaterialName(entry.material);
        if (!token) return acc;
        if (!acc[key]) acc[key] = [];
        acc[key].push(token);
        return acc;
    }, {});
    let matchedMaterials = 0;
    const filtered = [];
    ids.forEach((id) => {
        const group = meshes.meshDict[id];
        if (!group) return;
        if (useCategories) {
            const category = getGroupCategory(group);
            if (!category || !categories.has(category)) return;
        }
        if (useMaterials) {
            const category = getGroupCategory(group);
            const categoryKey = normalizeCategoryKey(category || "");
            const scopedKeys = scopedMaterialKeys[categoryKey];
            if (scopedKeys && scopedKeys.length) {
                if (!versionHasMaterial(String(id), scopedKeys, shapeIndex)) return;
                matchedMaterials += 1;
            } else if (globalMaterialKeys.length) {
                if (!versionHasMaterial(String(id), globalMaterialKeys, shapeIndex)) return;
                matchedMaterials += 1;
            }
        }
        filtered.push(id);
    });
    if (useMaterials) {
        console.debug("[MaterialFilter] matched elements:", matchedMaterials, "of", ids.length);
    }
    return filtered;
}

function normalizeMaterialName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

function normalizeMaterialFilterKey(material, category) {
    const value = String(material || "");
    const text = value.trim();
    if (!text) return "";
    if (text.includes("::")) return text;
    if (!category) return text;
    const categoryLabel = String(category || "").trim();
    return `${categoryLabel}::${text}`;
}

function parseMaterialFilterKey(key) {
    const raw = String(key || "");
    if (!raw.includes("::")) {
        return { categoryKey: null, material: raw };
    }
    const [categoryKey, ...rest] = raw.split("::");
    return { categoryKey: categoryKey || null, material: rest.join("::") };
}

function formatMaterialFilterLabel(key) {
    const parsed = parseMaterialFilterKey(key);
    if (!parsed.categoryKey) return parsed.material;
    return `${formatCategoryLabel(parsed.categoryKey)} · ${parsed.material}`;
}

function versionHasMaterial(versionId, materialKeys, shapeIndex) {
    const meta = shapeIndex?.versionMap?.get(versionId);
    const baseId = String(versionId).split("_")[0];
    const fallback = shapeIndex?.baseMap?.get(baseId);
    const source = meta || fallback;
    if (!source) return false;
    const tokens = extractMaterialTokens(source);
    return materialKeys.some((key) => tokens.some((token) => token.includes(key) || key.includes(token)));
}

function extractMaterialTokens(meta) {
    const tokens = new Set();
    const layers = meta.layers || [];
    if (Array.isArray(layers)) {
        layers.forEach((layer) => {
            if (!layer || typeof layer !== "object") return;
            const name = layer["Material Name"] || layer["Material"] || "";
            if (typeof name === "string") {
                const token = normalizeMaterialName(name);
                if (token) tokens.add(token);
            }
            Object.values(layer).forEach((value) => {
                if (typeof value === "string") {
                    const token = normalizeMaterialName(value);
                    if (token) tokens.add(token);
                }
            });
        });
    } else {
        Object.values(layers).forEach((value) => {
            if (typeof value === "string") {
                const token = normalizeMaterialName(value);
                if (token) tokens.add(token);
            }
        });
    }
    const parameters = meta.parameters || {};
    Object.entries(parameters).forEach(([key, entry]) => {
        if (!key) return;
        const upper = key.toUpperCase();
        if (!upper.includes("MATERIAL") && !upper.includes("MAT")) return;
        const value = entry?.ValueString;
        if (typeof value === "string") {
            const token = normalizeMaterialName(value);
            if (token) tokens.add(token);
        }
    });
    return Array.from(tokens);
}

function buildMaterialGroups(timeJson, beforeKey, afterKey, hideZero) {
    const beforeQuantity = timeJson[beforeKey]?.Quantity || {};
    const afterQuantity = timeJson[afterKey]?.Quantity || {};
    const categories = new Set([...Object.keys(beforeQuantity), ...Object.keys(afterQuantity)]);
    const totalKeys = new Set(["All Volume", "All Length", "All Numbers"]);
    const beforeTotals = {};
    const afterTotals = {};

    categories.forEach((category) => {
        if (!isAllowedMaterialCategory(category)) return;
        const beforeCat = beforeQuantity[category] || {};
        const afterCat = afterQuantity[category] || {};
        const metrics = new Set([...Object.keys(beforeCat), ...Object.keys(afterCat)]);
        metrics.forEach((metric) => {
            if (totalKeys.has(metric)) return;
            const beforeValue = typeof beforeCat[metric] === "number" ? beforeCat[metric] : 0;
            const afterValue = typeof afterCat[metric] === "number" ? afterCat[metric] : 0;
            beforeTotals[metric] = (beforeTotals[metric] || 0) + beforeValue;
            afterTotals[metric] = (afterTotals[metric] || 0) + afterValue;
        });
    });

    return buildMaterialGroupsFromTotals(beforeTotals, afterTotals, hideZero);
}

function buildMaterialGroupsFromTotals(beforeTotals, afterTotals, hideZero) {
    const metrics = new Set([...Object.keys(beforeTotals), ...Object.keys(afterTotals)]);
    const items = [];
    metrics.forEach((metric) => {
        const beforeValue = beforeTotals?.[metric] ?? 0;
        const afterValue = afterTotals?.[metric] ?? 0;
        if (hideZero && beforeValue === 0 && afterValue === 0) return;
        items.push({
            metric,
            before: beforeValue,
            after: afterValue,
            delta: afterValue - beforeValue,
        });
    });

    const totalBefore = Object.values(beforeTotals || {})
        .filter((value) => typeof value === "number" && Number.isFinite(value))
        .reduce((sum, value) => sum + value, 0);
    const totalAfter = Object.values(afterTotals || {})
        .filter((value) => typeof value === "number" && Number.isFinite(value))
        .reduce((sum, value) => sum + value, 0);

    return [
        {
            category: "Materials",
            totals: {
                before: totalBefore,
                after: totalAfter,
                delta: totalAfter - totalBefore,
            },
            items,
        },
    ];
}

function renderSimpleList(container, rows, selectedCategories = new Set()) {
    container.innerHTML = "";
    rows.forEach((row) => {
        const item = document.createElement("div");
        item.className = "diff-row diff-row--simple";
        item.innerHTML = `
            <div class="diff-row-title">${row.label}</div>
            <div class="diff-row-values">
                <span class="diff-value">${row.value}</span>
            </div>
        `;
        if (row.category) {
            item.classList.add("is-clickable");
            item.addEventListener("click", () => {
                toggleIsolate(row.category);
            });
            if (selectedCategories.has(row.category)) {
                item.classList.add("is-selected");
            }
        }
        container.appendChild(item);
    });
}

function renderTableList(container, rows, selectedCategories = new Set(), onCategoryClick) {
    const previousScroll = container.querySelector(".diff-table__list")?.scrollTop ?? 0;
    container.innerHTML = "";
    const table = document.createElement("div");
    table.className = "diff-table";
    table.innerHTML = `
        <div class="diff-table__head">
            <span class="diff-table__head-label">Category</span>
            <span class="diff-table__head-values">
                <span>A</span>
                <span>B</span>
                <span>Delta</span>
            </span>
        </div>
    `;
    const list = document.createElement("div");
    list.className = "diff-table__list";
    rows.forEach((row) => {
        const item = document.createElement("div");
        item.className = "diff-table__row";
        const box = document.createElement("div");
        box.className = "diff-table__box";
        const label = formatCategoryLabel(row.label || row.category || "-");
        const catButton = document.createElement("button");
        catButton.type = "button";
        catButton.className = "diff-table__cat";
        catButton.textContent = label;
        item.appendChild(catButton);
        box.innerHTML = `
            <span>${formatNumber(row.before)}</span>
            <span>${formatNumber(row.after)}</span>
            <span class="diff-delta ${row.delta >= 0 ? "up" : "down"}">${formatDeltaValue(row.delta)}</span>
        `;
        if (row.category) {
            if (onCategoryClick) {
                catButton.classList.add("is-clickable");
                catButton.addEventListener("click", () => onCategoryClick(row.category));
            }
        } else {
            catButton.disabled = true;
        }
        if (row.category && selectedCategories.has(row.category)) {
            catButton.classList.add("is-selected");
        }
        item.appendChild(box);
        list.appendChild(item);
    });
    table.appendChild(list);
    container.appendChild(table);
    list.scrollTop = previousScroll;
}

function renderMaterialList(
    container,
    groups,
    selectedMaterials = new Set(),
    onMaterialClick,
    openGroups = new Set(),
    onGroupToggle
) {
    const previousScroll = container.querySelector(".material-list")?.scrollTop ?? 0;
    container.innerHTML = "";
    const table = document.createElement("div");
    table.className = "diff-table diff-table--materials";
    table.innerHTML = `
        <div class="diff-table__head">
            <span class="diff-table__head-label">Category</span>
            <span class="diff-table__head-values">
                <span>A</span>
                <span>B</span>
                <span>Delta</span>
            </span>
        </div>
    `;

    const list = document.createElement("div");
    list.className = "diff-table__list material-list";

    groups.forEach((group) => {
        const details = document.createElement("details");
        details.className = "material-group";
        details.open = openGroups.has(group.category);

        const summary = document.createElement("summary");
        summary.className = "diff-table__row material-summary";

        const groupLabel = document.createElement("span");
        groupLabel.className = "diff-table__cat material-category";
        groupLabel.textContent = formatCategoryLabel(group.category);

        const groupBox = document.createElement("div");
        groupBox.className = "diff-table__box";
        groupBox.innerHTML = `
            <span>${formatNumber(group.totals.before)}</span>
            <span>${formatNumber(group.totals.after)}</span>
            <span class="diff-delta ${group.totals.delta >= 0 ? "up" : "down"}">${formatDeltaValue(group.totals.delta)}</span>
        `;

        summary.appendChild(groupLabel);
        summary.appendChild(groupBox);
        details.appendChild(summary);

        const items = document.createElement("div");
        items.className = "material-items";

        if (group.items.length === 0) {
            const emptyRow = document.createElement("div");
            emptyRow.className = "diff-table__row material-item-row material-empty-row";

            const emptyLabel = document.createElement("span");
            emptyLabel.className = "material-metric";
            emptyLabel.textContent = "No material entries.";

            const emptyBox = document.createElement("div");
            emptyBox.className = "diff-table__box is-disabled";
            emptyBox.innerHTML = `
                <span>-</span>
                <span>-</span>
                <span>-</span>
            `;

            emptyRow.appendChild(emptyLabel);
            emptyRow.appendChild(emptyBox);
            items.appendChild(emptyRow);
        } else {
            group.items.forEach((item) => {
                const row = document.createElement("div");
                row.className = "diff-table__row material-item-row";

                const label = document.createElement("button");
                label.type = "button";
                label.className = "diff-table__cat material-item";
                label.textContent = item.metric;
                if (onMaterialClick) {
                    label.classList.add("is-clickable");
                    label.addEventListener("click", (event) => {
                        event.stopPropagation();
                        onMaterialClick(item.metric, null);
                    });
                } else {
                    label.disabled = true;
                }
                const scopedKey = normalizeMaterialFilterKey(item.metric, group.category);
                if (selectedMaterials.has(scopedKey) || selectedMaterials.has(item.metric)) {
                    label.classList.add("is-selected");
                }

                const box = document.createElement("div");
                box.className = "diff-table__box material-item-box";
                box.innerHTML = `
                    <span>${formatNumber(item.before)}</span>
                    <span>${formatNumber(item.after)}</span>
                    <span class="diff-delta ${item.delta >= 0 ? "up" : "down"}">${formatDeltaValue(item.delta)}</span>
                `;

                row.appendChild(label);
                row.appendChild(box);
                items.appendChild(row);
            });
        }

        details.addEventListener("toggle", () => {
            if (onGroupToggle) {
                onGroupToggle(group.category, details.open);
            }
        });
        details.appendChild(items);
        list.appendChild(details);
    });

    table.appendChild(list);
    container.appendChild(table);
    list.scrollTop = previousScroll;
}

function collectVisibleElements(meshes, categoryFilter) {
    const elements = [];
    meshes.allGroup.forEach((group) => {
        if (!group.visible) return;
        if (categoryFilter) {
            const category = getGroupCategory(group);
            if (category !== categoryFilter) return;
        }
        elements.push({
            id: group.name,
            category: getGroupCategory(group),
            info: group.userData || {},
        });
    });
    return elements;
}

function buildVisibleStats(meshes) {
    const stats = {};
    meshes.allGroup.forEach((group) => {
        if (!group.visible) return;
        const category = getGroupCategory(group) || "Unknown";
        stats[category] = (stats[category] || 0) + 1;
    });
    return stats;
}

function formatNumber(value) {
    if (typeof value !== "number" || Number.isNaN(value)) return "-";
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
}

function formatDeltaValue(value) {
    if (typeof value !== "number" || Number.isNaN(value)) return "-";
    const sign = value > 0 ? "+" : "";
    if (Number.isInteger(value)) return `${sign}${value}`;
    return `${sign}${value.toFixed(2)}`;
}

function formatDelta(value) {
    return formatDeltaValue(value);
}
function buildQuantityContext(timeJson, beforeKey, afterKey) {
    const beforeQuantity = timeJson[beforeKey]?.Quantity || {};
    const afterQuantity = timeJson[afterKey]?.Quantity || {};
    const categories = new Set([...Object.keys(beforeQuantity), ...Object.keys(afterQuantity)]);
    const result = {};

    categories.forEach((category) => {
        const beforeCat = beforeQuantity[category] || {};
        const afterCat = afterQuantity[category] || {};
        const metrics = new Set([...Object.keys(beforeCat), ...Object.keys(afterCat)]);
        const metricResult = {};
        metrics.forEach((metric) => {
            const beforeValue = typeof beforeCat[metric] === "number" ? beforeCat[metric] : 0;
            const afterValue = typeof afterCat[metric] === "number" ? afterCat[metric] : 0;
            metricResult[metric] = {
                before: beforeValue,
                after: afterValue,
                delta: afterValue - beforeValue,
            };
        });
        result[category] = metricResult;
    });

    return result;
}

function buildShapeIndex(shapeJson) {
    const versionMap = new Map();
    const baseMap = new Map();

    shapeJson.forEach((entry) => {
        const info = entry.Info || {};
        const common = info.Common || {};
        const versionId = common.ElementId;
        const baseId = entry.ElementId || (versionId ? String(versionId).split("_")[0] : null);
        const meta = {
            versionId: versionId || null,
            baseId: baseId || null,
            timestamp: common.Timestamp || null,
            category: common.ElementCategory || null,
            family: common.ElementFamily || null,
            type: common.ElementType || null,
            layers: info.Layers || {},
            parameters: info.Parameter || {},
            commandType: entry.CommandType || null,
        };

        if (versionId) {
            versionMap.set(versionId, meta);
        }
        if (baseId && !baseMap.has(baseId)) {
            baseMap.set(baseId, meta);
        }
    });

    return { versionMap, baseMap };
}

function buildDiffContext(diff, shapeIndex) {
    return {
        added: summarizeByCategory(diff.addedIds, shapeIndex),
        deleted: summarizeByCategory(diff.deletedIds, shapeIndex),
        modified: {
            before: summarizeByCategory(diff.modified.before, shapeIndex),
            after: summarizeByCategory(diff.modified.after, shapeIndex),
        },
    };
}

function summarizeByCategory(versionIds, shapeIndex) {
    const summary = {};
    versionIds.forEach((id) => {
        const meta = shapeIndex.versionMap.get(id) || { versionId: id, baseId: String(id).split("_")[0] };
        const category = meta.category || "Unknown";
        if (!summary[category]) {
            summary[category] = { count: 0, samples: [] };
        }
        summary[category].count += 1;
        if (summary[category].samples.length < 5) {
            summary[category].samples.push({
                id: meta.versionId || id,
                baseId: meta.baseId,
                timestamp: meta.timestamp,
                family: meta.family,
                type: meta.type,
                layers: meta.layers,
            });
        }
    });
    return summary;
}

function highlightCategory(groups, category) {
    groups.forEach((group) => {
        group.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            child.material.emissive.setHex(0x000000);
        });
    });

    groups.forEach((group) => {
        const info = group.userData;
        const common = info?.Common || {};
        const groupCategory = common.Category || common.ElementCategory || common.CategoryName || common.CategoryId;
        if (groupCategory !== category) return;
        group.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.emissive.setHex(0x555555);
            }
        });
    });
}

function getGroupCategory(group) {
    const info = group.userData || {};
    const common = info.Common || {};
    return (
        common.Category ||
        common.ElementCategory ||
        common.CategoryName ||
        common.CategoryId ||
        info.Category ||
        info.ElementCategory ||
        null
    );
}

function applyCategoryColor(groups, category, colorHex) {
    groups.forEach((group) => {
        const groupCategory = getGroupCategory(group);
        if (groupCategory !== category) return;
        group.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            ensureUniqueMaterial(child);
            if (!child.userData.originalColor && child.material.color) {
                child.userData.originalColor = child.material.color.getHex();
            }
            child.material.color.setHex(colorHex);
        });
    });
}

function resetGroupColors(groups) {
    groups.forEach((group) => {
        group.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            if (child.userData.originalColor !== undefined) {
                child.material.color.setHex(child.userData.originalColor);
            }
        });
    });
}

function cacheOriginalColors(groups) {
    groups.forEach((group) => {
        group.traverse((child) => {
            if (!child.isMesh || !child.material || !child.material.color) return;
            if (child.userData.originalColor === undefined) {
                child.userData.originalColor = child.material.color.getHex();
            }
        });
    });
}

function getChangedElements(timeJson, beforeKey, afterKey) {
    const beforeElements = new Set(timeJson[beforeKey]?.Elements || []);
    const afterElements = new Set(timeJson[afterKey]?.Elements || []);
    const changed = new Set();
    for (const id of afterElements) {
        if (!beforeElements.has(id)) changed.add(id);
    }
    for (const id of beforeElements) {
        if (!afterElements.has(id)) changed.add(id);
    }
    return Array.from(changed);
}

function colorElementsById(meshDict, elementIds, colorHex) {
    elementIds.forEach((id) => {
        const group = meshDict[id];
        if (!group) return;
        group.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            ensureUniqueMaterial(child);
            if (!child.userData.originalColor && child.material.color) {
                child.userData.originalColor = child.material.color.getHex();
            }
            child.material.color.setHex(colorHex);
        });
    });
}

function ensureUniqueMaterial(mesh) {
    if (!mesh.material || mesh.userData.materialCloned) return;
    mesh.material = mesh.material.clone();
    mesh.userData.materialCloned = true;
}

function isolateByChange(state, timeJson, beforeMeshes, afterMeshes, beforeKey, afterKey, action) {
    const diff = diffElementVersions(timeJson, beforeKey, afterKey);
    state.isolatedCategories.clear();

    if (action === "added") {
        state.isolateIdsAfter = diff.addedIds;
        state.isolateIdsBefore = null;
        setVisibleByIds(afterMeshes, diff.addedIds);
    }

    if (action === "deleted") {
        state.isolateIdsBefore = diff.deletedIds;
        state.isolateIdsAfter = null;
        setVisibleByIds(beforeMeshes, diff.deletedIds);
    }

    if (action === "modified") {
        state.isolateIdsBefore = diff.modified.before;
        state.isolateIdsAfter = diff.modified.after;
        setVisibleByIds(beforeMeshes, diff.modified.before);
        setVisibleByIds(afterMeshes, diff.modified.after);
    }
}

function setVisibleByIds(meshes, ids, options = {}) {
    const { baseIds = null, ghostNonIsolated = false } = options;
    const selectedSet = new Set((ids || []).map((id) => String(id)));
    const baseSet = baseIds ? new Set((baseIds || []).map((id) => String(id))) : selectedSet;

    meshes.allGroup.forEach((group) => {
        const groupId = group?.name ? String(group.name) : null;
        const inBase = groupId && baseSet.has(groupId);
        if (ghostNonIsolated) {
            group.visible = Boolean(inBase);
            if (inBase) {
                const isSelected = selectedSet.has(groupId);
                setGroupGhosted(group, !isSelected);
            } else {
                setGroupGhosted(group, false);
            }
        } else {
            group.visible = groupId ? selectedSet.has(groupId) : false;
            setGroupGhosted(group, false);
        }
    });
}

function setGroupGhosted(group, isGhosted) {
    if (!group) return;
    group.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        if (child.userData?.isSelectionOutline) return;
        ensureUniqueMaterial(child);
        if (child.userData.originalOpacity === undefined) {
            child.userData.originalOpacity = child.material.opacity;
        }
        if (child.userData.originalTransparent === undefined) {
            child.userData.originalTransparent = child.material.transparent;
        }
        if (isGhosted) {
            child.material.opacity = 0.15;
            child.material.transparent = true;
        } else {
            if (child.userData.originalOpacity !== undefined) {
                child.material.opacity = child.userData.originalOpacity;
            }
            if (child.userData.originalTransparent !== undefined) {
                child.material.transparent = child.userData.originalTransparent;
            }
        }
    });
}

function diffElementVersions(timeJson, beforeKey, afterKey) {
    const beforeList = timeJson[beforeKey]?.Elements || [];
    const afterList = timeJson[afterKey]?.Elements || [];

    const beforeMap = buildBaseIdMap(beforeList);
    const afterMap = buildBaseIdMap(afterList);

    const addedIds = [];
    const deletedIds = [];
    const modified = { before: [], after: [] };
    const unchangedIds = [];

    for (const [baseId, beforeVersion] of beforeMap) {
        if (!afterMap.has(baseId)) {
            deletedIds.push(beforeVersion);
        } else {
            const afterVersion = afterMap.get(baseId);
            if (afterVersion !== beforeVersion) {
                modified.before.push(beforeVersion);
                modified.after.push(afterVersion);
            } else {
                unchangedIds.push(beforeVersion);
            }
        }
    }

    for (const [baseId, afterVersion] of afterMap) {
        if (!beforeMap.has(baseId)) {
            addedIds.push(afterVersion);
        }
    }

    return {
        addedIds,
        deletedIds,
        modified,
        unchangedIds,
        beforeCount: beforeList.length,
        afterCount: afterList.length,
    };
}

function buildBaseIdMap(list) {
    const map = new Map();
    list.forEach((elementId) => {
        const str = String(elementId);
        const idx = str.lastIndexOf("_");
        if (idx === -1) {
            map.set(str, str);
            return;
        }
        const baseId = str.slice(0, idx);
        map.set(baseId, str);
    });
    return map;
}

function syncCameras(source, target, syncToggle, state) {
    if (!syncToggle.checked) return;
    if (state.syncingCamera) return;
    state.syncingCamera = true;
    target.camera.position.copy(source.camera.position);
    target.controls.target.copy(source.controls.target);
    target.camera.quaternion.copy(source.camera.quaternion);
    target.controls.update();
    state.syncingCamera = false;
}

function saveTime(list, timeKey) {
    if (!timeKey || list.includes(timeKey)) return;
    list.push(timeKey);
}

function renderSaved(container, list, onSelect, onRemove) {
    if (!container) return;
    container.innerHTML = "";
    list.forEach((timeKey) => {
        const chip = document.createElement("div");
        chip.className = "saved-time";

        const label = document.createElement("button");
        label.type = "button";
        label.className = "saved-time__label";
        label.textContent = formatTimeLabel(timeKey);
        label.addEventListener("click", () => onSelect(timeKey));

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "saved-time__remove";
        remove.textContent = "×";
        remove.addEventListener("click", (event) => {
            event.stopPropagation();
            onRemove(timeKey);
        });

        chip.appendChild(label);
        chip.appendChild(remove);
        container.appendChild(chip);
    });
}

function captureCamera(viewer) {
    return {
        position: viewer.camera.position.clone(),
        quaternion: viewer.camera.quaternion.clone(),
        target: viewer.controls.target.clone(),
    };
}

function restoreCamera(viewer, snapshot) {
    if (!snapshot) return;
    viewer.camera.position.copy(snapshot.position);
    viewer.camera.quaternion.copy(snapshot.quaternion);
    viewer.controls.target.copy(snapshot.target);
    viewer.controls.update();
}

function addOutlines(groups) {
    const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x2a2a2a,
        transparent: true,
        opacity: 0.25,
    });

    groups.forEach((group) => {
        group.traverse((child) => {
            if (!child.isMesh || !child.geometry) return;
            if (child.userData && child.userData.hasOutline) return;
            const edges = new THREE.EdgesGeometry(child.geometry);
            const line = new THREE.LineSegments(edges, edgeMaterial);
            line.renderOrder = 1;
            child.add(line);
            child.userData.hasOutline = true;
        });
    });
}

function setupElementSelection({ before, after, beforeMeshes, afterMeshes, diffPanelWrapper }) {
    const popover = createElementPopover();
    let selectedGroup = null;

    const clearSelection = () => {
        if (selectedGroup) {
            applySelectionOutline(selectedGroup, false);
            selectedGroup = null;
        }
        hideElementPopover(popover);
    };

    const handleOutsideClick = (event) => {
        if (popover.contains(event.target)) return;
        if (event.target.closest(".viewer-surface")) return;
        if (diffPanelWrapper && diffPanelWrapper.contains(event.target)) {
            clearSelection();
            return;
        }
        clearSelection();
    };

    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", () => {
        clearSelection();
    });

    setupViewerSelection(before, beforeMeshes, "Before");
    setupViewerSelection(after, afterMeshes, "After");

    function setupViewerSelection(viewer, meshes, panelLabel) {
        const raycaster = new THREE.Raycaster();
        const meshObjects = collectMeshObjects(meshes.allGroup);
        let pointerDown = null;
        const dragThreshold = 6;

        viewer.renderer.domElement.addEventListener("mousedown", (event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            pointerDown = { x: event.clientX, y: event.clientY };
        });

        viewer.renderer.domElement.addEventListener("mouseup", (event) => {
            if (event.button !== 0) return;
            if (!pointerDown) return;
            const dx = event.clientX - pointerDown.x;
            const dy = event.clientY - pointerDown.y;
            pointerDown = null;
            if (dx * dx + dy * dy > dragThreshold * dragThreshold) {
                return;
            }
            const rect = viewer.renderer.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                -((event.clientY - rect.top) / rect.height) * 2 + 1
            );

            raycaster.setFromCamera(mouse, viewer.camera);
            const intersections = raycaster.intersectObjects(meshObjects, true);
            if (!intersections.length) {
                clearSelection();
                return;
            }

            const intersectedGroup = findSelectableGroupFromIntersections(intersections);

            if (!intersectedGroup) {
                clearSelection();
                return;
            }

            if (selectedGroup === intersectedGroup) {
                clearSelection();
                return;
            }

            clearSelection();
            selectedGroup = intersectedGroup;
            applySelectionOutline(selectedGroup, true);
            showElementPopover(popover, intersectedGroup.userData || {}, event.clientX, event.clientY, panelLabel);
        });
    }

    function collectMeshObjects(groups) {
        const objects = [];
        for (const group of groups) {
            if (!group) continue;
            group.traverse((child) => {
                if (child.isMesh) objects.push(child);
            });
        }
        return objects;
    }

    function findSelectableGroupFromIntersections(intersections) {
        for (const hit of intersections) {
            const group = findGroupWithInfo(hit.object);
            if (group && group.visible) return group;
        }
        return null;
    }

    function findGroupWithInfo(object) {
        let current = object;
        while (current) {
            if (hasElementInfo(current.userData)) return current;
            current = current.parent;
        }
        return null;
    }
}

function applySelectionOutline(group, isSelected) {
    if (!group) return;
    group.traverse((child) => {
        if (!child.isLineSegments || !child.material) return;
        if (isSelected) {
            if (!child.userData.originalMaterial) {
                child.userData.originalMaterial = child.material;
            }
            const highlight = child.material.clone();
            highlight.color.setHex(0xff3b30);
            highlight.opacity = 1;
            child.material = highlight;
        } else if (child.userData.originalMaterial) {
            child.material = child.userData.originalMaterial;
            delete child.userData.originalMaterial;
        }
    });
}

function createElementPopover() {
    const el = document.createElement("div");
    el.className = "element-popover";
    document.body.appendChild(el);
    return el;
}

function showElementPopover(popover, info, x, y, panelLabel) {
    if (!popover) return;
    if (!hasElementInfo(info)) {
        hideElementPopover(popover);
        return;
    }
    popover.innerHTML = buildElementPopoverContent(info, panelLabel);
    popover.classList.add("is-visible");
    positionElementPopover(popover, x, y);
}

function hideElementPopover(popover) {
    if (!popover) return;
    popover.classList.remove("is-visible");
    popover.innerHTML = "";
}

function positionElementPopover(el, x, y) {
    const padding = 12;
    const offset = 14;
    const rect = el.getBoundingClientRect();
    let left = x + offset;
    let top = y + offset;
    if (left + rect.width + padding > window.innerWidth) {
        left = x - rect.width - offset;
    }
    if (top + rect.height + padding > window.innerHeight) {
        top = y - rect.height - offset;
    }
    left = Math.max(padding, left);
    top = Math.max(padding, top);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
}

function buildElementPopoverContent(info, panelLabel) {
    const common = info.Common || {};
    const layers = Array.isArray(info.Layers) ? info.Layers : [];
    const parameters = info.Parameter || {};
    const titleParts = [common.ElementCategory, common.ElementType].filter(Boolean);
    const title = titleParts.length ? titleParts.join(" · ") : "Element";
    const id = common.ElementId ? `#${common.ElementId}` : "";
    const panel = panelLabel ? `<span class="element-popover__chip">${panelLabel}</span>` : "";

    const commonRows = [
        ["Element ID", common.ElementId],
        ["Family", common.ElementFamily],
        ["Type", common.ElementType],
        ["Timestamp", common.Timestamp],
    ]
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([label, value]) => elementPopoverRow(label, value))
        .join("");

    let layerRows = "";
    let totalVolume = 0;
    layers.forEach((layer) => {
        if (!layer || typeof layer !== "object") return;
        const name = layer["Material Name"] || layer["Material"] || "Unknown Material";
        const volume = layer["Material Volume"];
        if (typeof volume === "number" && Number.isFinite(volume)) {
            totalVolume += volume;
        }
        layerRows += `
            <div class="element-popover__row">
                <span class="element-popover__label">${escapeHtml(name)}</span>
                <span class="element-popover__value">${formatNumber(volume)}</span>
            </div>
        `;
    });

    if (!layerRows) {
        layerRows = `<div class="element-popover__empty">No layer data.</div>`;
    }

    const parameterCount = Object.keys(parameters || {}).length;
    const parameterRow = parameterCount
        ? `<div class="element-popover__row"><span class="element-popover__label">Parameters</span><span class="element-popover__value">${parameterCount}</span></div>`
        : "";

    return `
        <div class="element-popover__header">
            <div>
                <div class="element-popover__title">${escapeHtml(title)}</div>
                <div class="element-popover__subtitle">${escapeHtml(id)}</div>
            </div>
            ${panel}
        </div>
        <div class="element-popover__section">
            <div class="element-popover__section-title">Common</div>
            <div class="element-popover__grid">
                ${commonRows || `<div class="element-popover__empty">No common data.</div>`}
            </div>
        </div>
        <div class="element-popover__section">
            <div class="element-popover__section-title">Layers</div>
            <div class="element-popover__grid">
                ${layerRows}
            </div>
            <div class="element-popover__summary">Total Volume: ${formatNumber(totalVolume)}</div>
        </div>
        ${parameterRow ? `<div class="element-popover__section"><div class="element-popover__section-title">Parameters</div><div class="element-popover__grid">${parameterRow}</div></div>` : ""}
    `;
}

function hasElementInfo(info) {
    if (!info || typeof info !== "object") return false;
    const common = info.Common || {};
    const hasCommon = Object.keys(common).length > 0;
    const hasLayers = Array.isArray(info.Layers) && info.Layers.length > 0;
    const hasParams = info.Parameter && Object.keys(info.Parameter).length > 0;
    return hasCommon || hasLayers || hasParams;
}

function elementPopoverRow(label, value) {
    return `
        <div class="element-popover__row">
            <span class="element-popover__label">${escapeHtml(label)}</span>
            <span class="element-popover__value">${escapeHtml(String(value))}</span>
        </div>
    `;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

async function loadJson(jsonPath) {
    try {
        const response = await fetch(jsonPath);
        if (!response.ok) throw new Error("Failed to load Json");
        return await response.json();
    } catch (error) {
        console.error("Error loading Json:", error);
        return null;
    }
}

function attachSliderTooltip(slider) {
    const wrapper = slider.parentElement;
    if (!wrapper) return null;
    const tooltip = document.createElement("div");
    tooltip.className = "slider-tooltip";
    wrapper.style.position = "relative";
    wrapper.appendChild(tooltip);
    return tooltip;
}

function updateSliderFill(slider, direction) {
    const min = Number(slider.min || 0);
    const max = Number(slider.max || 100);
    const value = Number(slider.value || 0);
    const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
    const clamped = Math.min(100, Math.max(0, percent));
    const fill = direction === "right" ? 100 - clamped : clamped;
    slider.style.setProperty("--slider-fill", `${fill}%`);
}

function showTooltip(tooltip, slider, text) {
    tooltip.textContent = text;
    const min = Number(slider.min || 0);
    const max = Number(slider.max || 100);
    const val = (slider.value - min) / (max - min);
    const rect = slider.getBoundingClientRect();
    const thumbSize = 32;
    const trackWidth = rect.width - thumbSize;
    const left = val * trackWidth + thumbSize / 2;
    tooltip.style.left = `${left}px`;
    tooltip.style.transform = "translate(-50%, 0)";
    tooltip.classList.add("is-visible");
}

function hideTooltip(tooltip) {
    tooltip.classList.remove("is-visible");
}

function formatTimeLabel(value) {
    if (!value) return "";
    const match = String(value).match(/^(\d{4})[_-]?(\d{2})[_-]?(\d{2})[_-]?(\d{2})[_-]?(\d{2})[_-]?(\d{2})$/);
    if (!match) return String(value);
    const [, y, m, d, hh, mm, ss] = match;
    return `${y}.${m}.${d}\n${hh}:${mm}:${ss}`;
}

function formatTimeLabelSingleLine(value) {
    if (!value) return "";
    const match = String(value).match(/^(\d{4})[_-]?(\d{2})[_-]?(\d{2})[_-]?(\d{2})[_-]?(\d{2})[_-]?(\d{2})$/);
    if (!match) return String(value);
    const [, y, m, d, hh, mm, ss] = match;
    return `${y}.${m}.${d} ${hh}:${mm}:${ss}`;
}

function getStoredKey() {
    const key = localStorage.getItem("openai_api_key");
    return key && key.trim().length > 0 ? key : null;
}

async function requestLlmSummary(apiKey, context, images = {}) {
    const endpoint = "https://api.openai.com/v1/chat/completions";
    const imageParts = [];
    if (images.beforeImage) {
        imageParts.push({
            type: "image_url",
            image_url: { url: images.beforeImage },
        });
    }
    if (images.afterImage) {
        imageParts.push({
            type: "image_url",
            image_url: { url: images.afterImage },
        });
    }
    const summaryText = [
        "Summarize the current diff context with richer reasoning grounded in evidence.",
        "Prioritize what is visible in the images. If text conflicts with images, trust the images.",
        "Use BOTH images and the numeric context to infer: main changes, material/quantity shifts, and visible geometry differences.",
        "Be specific: mention categories/materials or quantities when they stand out. Avoid speculation.",
        "Output MUST be markdown using ONLY **bold** for headings (no other markdown).",
        "Start with a geometry/shape overview paragraph headed **Geometry Overview**.",
        "For **Geometry Overview**, use ONLY the images and do NOT use numeric quantities.",
        "If a category is not visually evident in the images, do not mention it in Geometry Overview.",
        "Focus on how the CURRENT geometry looks and how it changed from BEFORE to AFTER (shape, massing, openings, new or removed elements).",
        "Be more descriptive about visible form changes, not just counts or materials.",
        "Then split into paragraphs by category (e.g., **Walls**, **Floors**, **Ceilings**, **Openings**, **Structural**, **Other**).",
        "Each paragraph should include a short evidence-backed inference.",
        `Context JSON: ${JSON.stringify(context)}`,
    ].join("\n");
    const payload = {
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
            {
                role: "system",
                content:
                    "You summarize BIM diff states. Be concise and factual. Visual evidence has higher priority than text.",
            },
            {
                role: "user",
                content: [
                    { type: "text", text: summaryText },
                    ...imageParts,
                ],
            },
        ],
    };
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || "";
}
