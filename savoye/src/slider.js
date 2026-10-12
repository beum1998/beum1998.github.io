// ─────────────────────────────────────────────────────────────────────────────
// 타임라인 (메인 뷰어)
//
//   · 하단 슬라이더 = 로그 타임라인 키. 이동하면 3D 가시성 · 수량 탭 · 시각 표시 갱신
//   · 재생 컨트롤(역재생 / 한 칸 / 재생·일시정지 / 한 칸 / 속도), 키보드 ← → Space, 속도 < >
//   · 층 필터(한 층만 보기)와 카테고리 칩(표시/숨김) — 두 뷰어와 비교 집계에 공통 적용
//   · 슬라이더 위 핀 마커(pins.js), 아래 녹음 구간(클릭하면 재생)
//   · 시각 칩 클릭 → 날짜·시간으로 이동
// ─────────────────────────────────────────────────────────────────────────────

import {
    store, emit, on, CATEGORIES, catInfo, formatKey, levelOf, passesFilters, indexAtOrBefore,
    escapeHtml, fmtNum, showTip, hideTip, onProjectReset,
} from "./store.js";
import { icon } from "./icons.js";
import { quantityOf } from "./quantity.js";

// 재생 속도 — 1× 는 초당 10단계(기록 시점 10개). 고른 값은 브라우저에 남긴다
const STEPS_PER_SEC = 10;
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
const SPEED_KEY = "abl_play_speed";
function readSpeed() {
    try { const v = Number(localStorage.getItem(SPEED_KEY)); return SPEEDS.includes(v) ? v : 1; } catch { return 1; }
}
function speedLabel(s) { return `${s}×`; }
function speedHint(s) {
    const perSec = STEPS_PER_SEC * s;
    return perSec >= 1 ? `초당 ${perSec}단계` : `${Math.round(1 / perSec)}초에 1단계`;
}

// sliderControls 는 폴더를 다시 열 때마다(main() 마다) 다시 불린다. 이전 호출이 건 리스너가
// 남아 있으면 버튼이 두 번 반응하고(눌러도 그대로), 옛 타임라인 길이를 계속 쓰게 된다.
// 그래서 이번 호출에서 건 것만 모아 두었다가, 다음 호출 · 프로젝트 정리 때 걷어낸다.
const bindings = [];

function bind(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    bindings.push(() => target.removeEventListener(type, fn, opts));
}

function sub(evt, fn) { bindings.push(on(evt, fn)); }

function unbindAll() {
    for (const off of bindings.splice(0)) { try { off(); } catch (e) { console.warn("[slider] 정리 실패", e); } }
}

onProjectReset(unbindAll);

// 층 필터가 걸렸을 때 카테고리 물량을 그 층만으로 볼지(level) 모델 전체로 볼지(all). 고른 값은 브라우저에 남긴다
const QTY_SCOPE_KEY = "abl_qty_scope";
function readQtyScope() {
    try { return localStorage.getItem(QTY_SCOPE_KEY) === "all" ? "all" : "level"; } catch { return "level"; }
}

const METRIC_LABELS = {
    "All Numbers": "개수",
    "All Volume": "전체 체적",
    "All Length": "전체 길이",
    "Column Length": "기둥 길이",
    "Column Volume": "기둥 체적",
    "Stair Length": "계단 길이",
    "Stair Run Length": "계단 경사부 길이",
    "Stair Landing Length": "계단참 길이",
    "Railing Length": "난간 길이",
};

export function sliderControls(sliderName, timeKeys, timeJson, allGroup, meshDict, charts = []) {
    const slider = document.getElementById(sliderName);
    const timeBtn = document.getElementById("time-button");
    const mainTime = document.getElementById("main-time");
    const infoTarget = document.getElementById("info-target");
    const playBtn = document.getElementById("play");
    const rewindBtn = document.getElementById("rewind");
    const speedBtn = document.getElementById("speed-button");
    const speedPop = document.getElementById("speed-pop");
    const incBtn = document.getElementById("increase-1");
    const decBtn = document.getElementById("decrease-1");
    const recTrack = document.getElementById("tl-recs");
    const last = Math.max(0, timeKeys.length - 1);

    unbindAll();   // 이전 로드가 건 리스너 · 재생 루프 정리

    const openCats = new Set();
    let qtyScope = readQtyScope();
    let timer = null;          // requestAnimationFrame id
    let playing = false;       // 재생이 시점을 옮기는 중(그 외의 이동은 재생을 멈춘다)
    let dir = 1;
    let speed = readSpeed();   // 1× = 초당 10단계

    slider.min = 0;
    slider.max = last;
    slider.value = last;

    store.setMainIndex = (i) => {
        const v = Math.max(0, Math.min(last, Math.round(Number(i) || 0)));
        slider.value = v;
        slider.dispatchEvent(new Event("input"));
    };

    setupCategoryChips();
    setupLevelChips();
    renderScale();

    bind(slider, "input", onInput);
    // 슬라이더를 잡거나, 핀 · 요소 이력 · 브리핑 등 다른 곳에서 시점을 옮기면 재생을 멈춘다
    bind(slider, "pointerdown", () => { if (timer) stop(); });
    sub("time:main", () => { if (timer && !playing) stop(); });
    bindings.push(() => stop());   // 정리할 때 재생 루프도 멈춘다
    onInput();

    sub("filters", () => { applyVisibility(); renderQuantity(); });
    sub("visibility", applyVisibility);
    sub("recordings", renderRecordingRanges);
    sub("tab", (t) => { if (t === "chart") charts.forEach((c) => c.chart?.draw()); });

    function onInput() {
        const idx = Math.max(0, Math.min(last, parseInt(slider.value, 10) || 0));
        store.mainIndex = idx;
        const key = timeKeys[idx];
        slider.style.setProperty("--pct", `${last ? (idx / last) * 100 : 100}%`);
        applyVisibility();
        renderTime(key);
        renderQuantity();
        if (store.tab === "chart") charts.forEach((c) => c.chart?.draw());
        emit("time:main", idx);
    }

    function applyVisibility() {
        // 분할 비교 중에는 기존 비교 화면의 규칙(격리 · Ghost others)이 메인 뷰어 가시성을 정한다
        if (store.split && store.applyMainVisibility) {
            store.applyMainVisibility();
            return;
        }
        const key = timeKeys[store.mainIndex];
        const ids = timeJson[key]?.Elements || [];
        const iso = store.isolateMain;
        for (const g of allGroup) g.visible = false;
        for (const id of ids) {
            const g = meshDict[id];
            if (!g || g.userData?.visible === false || !passesFilters(g)) continue;
            if (iso && !iso.has(id)) continue;
            g.visible = true;
        }
    }

    function renderTime(key) {
        const f = formatKey(key);
        timeBtn.innerHTML = `<span class="time-chip__date">${icon("calendar", 12)}${f.date}</span><span class="time-chip__time">${f.time}</span>`;
        if (mainTime) mainTime.textContent = `${f.date} ${f.time}`;
    }

    function renderScale() {
        const s = document.getElementById("tl-start");
        const e = document.getElementById("tl-end");
        if (s) s.textContent = formatKey(timeKeys[0]).short;
        if (e) e.textContent = formatKey(timeKeys[last]).short;
    }

    // ── 수량 탭 ────────────────────────────────────────────────────────────────
    function renderQuantity() {
        if (!infoTarget) return;
        const key = timeKeys[store.mainIndex];
        const ids = timeJson[key]?.Elements || [];
        const levelName = store.levels.find((lv) => lv.key === store.levelFilter)?.name || store.levelFilter;
        const byLevelQty = Boolean(store.levelFilter) && qtyScope === "level";
        const quantity = byLevelQty
            ? quantityOf(ids.map((id) => meshDict[id]?.userData).filter((u) => u && levelOf(u).key === store.levelFilter))
            : timeJson[key]?.Quantity || {};
        const scroll = infoTarget.scrollTop;

        // 층별 요소 수 (카테고리 누적 막대)
        const byLevel = new Map();
        let visibleTotal = 0;
        for (const id of ids) {
            const g = meshDict[id];
            if (!g) continue;
            const cat = g.userData?.Common?.ElementCategory;
            if (store.hiddenCats.has(cat)) continue;
            const lv = levelOf(g.userData);
            if (!byLevel.has(lv.key)) byLevel.set(lv.key, { total: 0, cats: new Map() });
            const row = byLevel.get(lv.key);
            row.total++;
            row.cats.set(cat, (row.cats.get(cat) || 0) + 1);
            visibleTotal++;
        }
        const levelRows = store.levels.filter((lv) => byLevel.has(lv.key)).reverse();   // 위층이 위로
        const maxTotal = Math.max(1, ...levelRows.map((lv) => byLevel.get(lv.key).total));

        const levelHtml = levelRows.length ? levelRows.map((lv) => {
            const row = byLevel.get(lv.key);
            const segs = [...row.cats.entries()]
                .sort((a, b) => catInfo(a[0]).order - catInfo(b[0]).order)
                .map(([cat, n]) => `<i style="--c:${catInfo(cat).color};flex-grow:${n}"></i>`).join("");
            const focus = store.levelFilter === lv.key;
            const dim = store.levelFilter && !focus;
            return `<button class="lvl-row${focus ? " is-focus" : ""}${dim ? " is-dim" : ""}" type="button" data-level="${escapeHtml(lv.key)}"
                        title="${focus ? "전체 층 보기" : "이 층만 보기"}">
                <span class="lvl-row__name">${escapeHtml(lv.name)}</span>
                <span class="lvl-row__bar"><span class="lvl-row__fill" style="width:${(row.total / maxTotal) * 100}%">${segs}</span></span>
                <span class="lvl-row__n">${row.total}</span>
            </button>`;
        }).join("") : `<div class="empty empty--inline">이 시점에는 표시할 요소가 없어요.</div>`;

        // 카테고리 물량 카드
        const cats = Object.keys(quantity).filter((c) => !store.hiddenCats.has(c))
            .sort((a, b) => catInfo(a).order - catInfo(b).order);
        const catHtml = cats.map((cat) => {
            const q = quantity[cat] || {};
            const ci = catInfo(cat);
            const entries = Object.entries(q);
            const head = entries.filter(([k]) => METRIC_LABELS[k] && k !== "Stair Run Length" && k !== "Stair Landing Length");
            const rest = entries.filter(([k]) => !head.some(([h]) => h === k));
            const isCountCat = cat === "Windows" || cat === "Doors";
            const open = openCats.has(cat);
            const fmt = (k, v) => (k === "All Numbers" || isCountCat) ? String(v) : fmtNum(v);
            return `<div class="q-card card${open ? " is-open" : ""}">
                <button class="q-card__head" type="button" data-cat="${escapeHtml(cat)}" ${rest.length ? "" : "disabled"}>
                    <i class="dot" style="--c:${ci.color}"></i>${escapeHtml(ci.label)}<span>${escapeHtml(cat)}</span>
                    ${rest.length ? `<em class="q-card__chev">${icon("chevronDown", 14)}</em>` : ""}
                </button>
                <div class="q-card__metrics">
                    ${head.map(([k, v]) => `<div class="metric"><span>${METRIC_LABELS[k]}</span><b>${fmt(k, v)}</b></div>`).join("")}
                </div>
                ${rest.length ? `<div class="q-card__rest">${rest.map(([k, v]) =>
                    `<div class="qrow"><span class="qrow__name" title="${escapeHtml(k)}">${escapeHtml(METRIC_LABELS[k] || k)}</span><span class="qrow__v">${fmt(k, v)}</span></div>`).join("")}</div>` : ""}
            </div>`;
        }).join("");

        infoTarget.innerHTML = `
            <div class="sec-head">
                <h3>층별 요소</h3>
                <span class="sec-sub">${visibleTotal}개${store.levelFilter ? " · 층 필터 적용 중" : ""}</span>
            </div>
            <div class="card lvl-table">${levelHtml}</div>
            <div class="sec-head sec-head--qty">
                <h3>카테고리 물량</h3>
                ${store.levelFilter ? `<div class="seg seg--sm" role="group" aria-label="물량 범위">
                    <button class="seg__btn${byLevelQty ? " is-on" : ""}" type="button" data-qty-scope="level" aria-pressed="${byLevelQty}"
                        title="${escapeHtml(levelName)} 요소만 더한 물량">${escapeHtml(levelName)}</button>
                    <button class="seg__btn${byLevelQty ? "" : " is-on"}" type="button" data-qty-scope="all" aria-pressed="${!byLevelQty}"
                        title="층 필터와 관계없이 모델 전체 물량(전처리 값)">전체</button>
                </div>` : `<span class="sec-sub">전처리 물량 기준</span>`}
            </div>
            ${byLevelQty ? `<p class="qty-note">${escapeHtml(levelName)}에 속한 요소만 더한 값이에요(층은 로그의 레벨 기준).</p>` : ""}
            ${catHtml || `<div class="empty empty--inline">${byLevelQty ? "이 층에는 물량을 세는 요소가 없어요." : "이 로그에는 물량 정보가 없어요."}</div>`}`;
        infoTarget.scrollTop = scroll;
    }

    if (infoTarget) bind(infoTarget, "click", (e) => {
        const scopeBtn = e.target.closest("[data-qty-scope]");
        if (scopeBtn) {
            qtyScope = scopeBtn.dataset.qtyScope;
            try { localStorage.setItem(QTY_SCOPE_KEY, qtyScope); } catch { }
            renderQuantity();
            return;
        }
        const lvl = e.target.closest("[data-level]");
        if (lvl) {
            const k = lvl.dataset.level;
            store.setLevelFilter?.(store.levelFilter === k ? null : k);
            return;
        }
        const head = e.target.closest(".q-card__head");
        if (head && !head.disabled) {
            const cat = head.dataset.cat;
            if (openCats.has(cat)) openCats.delete(cat); else openCats.add(cat);
            head.parentElement.classList.toggle("is-open", openCats.has(cat));
        }
    });

    // ── 필터 칩 ────────────────────────────────────────────────────────────────
    function setupCategoryChips() {
        const present = new Set(allGroup.map((g) => g.userData?.Common?.ElementCategory));
        for (const c of CATEGORIES) {
            const btn = document.getElementById(c.id);
            if (!btn) continue;
            btn.style.setProperty("--c", c.color);
            btn.hidden = !present.has(c.key);
            if (btn.dataset.wired) continue;
            btn.dataset.wired = "1";
            btn.addEventListener("click", () => {
                if (store.hiddenCats.has(c.key)) store.hiddenCats.delete(c.key); else store.hiddenCats.add(c.key);
                btn.classList.toggle("hidden-cat", store.hiddenCats.has(c.key));
                btn.classList.toggle("is-off", store.hiddenCats.has(c.key));
                btn.setAttribute("aria-pressed", String(!store.hiddenCats.has(c.key)));
                emit("filters");
            });
        }
    }

    function setupLevelChips() {
        const group = document.getElementById("level-group");
        const box = document.getElementById("level-chips");
        if (!box) return;
        const levels = store.levels;
        if (group) group.hidden = levels.length <= 1;
        // 층이 많으면 칩 대신 드롭다운 — 카테고리 칩이 화면 밖으로 밀리지 않게
        const compact = levels.length > 4;
        const render = () => {
            if (compact) {
                box.className = "level-select" + (store.levelFilter ? " is-on" : "");
                box.innerHTML = `<select class="field field--sm field--pill${store.levelFilter ? " is-on" : ""}" aria-label="층 선택">
                    <option value="">전체 층</option>
                    ${levels.map((lv) => `<option value="${escapeHtml(lv.key)}"${store.levelFilter === lv.key ? " selected" : ""}>${escapeHtml(lv.name)}</option>`).join("")}
                </select>`;
                return;
            }
            box.className = "seg";
            box.innerHTML = [`<button type="button" class="seg__btn${store.levelFilter ? "" : " is-on"}" data-level="">전체</button>`]
                .concat(levels.map((lv) => `<button type="button" class="seg__btn${store.levelFilter === lv.key ? " is-on" : ""}" data-level="${escapeHtml(lv.key)}">${escapeHtml(lv.name)}</button>`))
                .join("");
        };
        store.setLevelFilter = (key) => {
            store.levelFilter = key || null;
            render();
            emit("filters");
        };
        box.onclick = (e) => {
            const b = e.target.closest("button[data-level]");
            if (b) store.setLevelFilter(b.dataset.level || null);
        };
        box.onchange = (e) => {
            if (e.target.matches("select")) store.setLevelFilter(e.target.value || null);
        };
        render();

        // 필터 줄이 넘치면 세로 휠로도 가로 스크롤
        const row = box.closest(".filter-row");
        if (row && !row.dataset.wheel) {
            row.dataset.wheel = "1";
            row.addEventListener("wheel", (e) => {
                if (row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
                row.scrollLeft += e.deltaY;
                e.preventDefault();
            }, { passive: false });
            const edge = () => row.classList.toggle("is-overflow-end", row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
            row.addEventListener("scroll", edge);
            new ResizeObserver(edge).observe(row);
        }
    }

    // ── 녹음 구간 (타임라인 아래) ──────────────────────────────────────────────
    function renderRecordingRanges(list) {
        if (!recTrack) return;
        const n = Math.max(1, last);
        recTrack.innerHTML = (list || []).map((rec, i) => {
            if (!Number.isFinite(rec.startMs)) return "";
            const a = indexAtOrBefore(rec.startMs);
            const b = Number.isFinite(rec.endMs) ? indexAtOrBefore(rec.endMs) : a;
            return `<button class="rec-range" type="button" data-i="${i}" aria-label="녹음 ${i + 1} 재생" title="녹음 ${i + 1} 재생" style="--x1:${(a / n).toFixed(5)};--x2:${(Math.max(a, b) / n).toFixed(5)}"></button>`;
        }).join("");
        recTrack.onmouseover = (e) => {
            const r = e.target.closest(".rec-range");
            const rec = r && list[+r.dataset.i];
            if (rec) showTip(r, `<div class="tip-pin"><b>${icon("mic", 12)} ${escapeHtml(rec.displayName || rec.name)}</b><span>클릭해서 재생</span></div>`);
        };
        recTrack.onmouseout = hideTip;
        recTrack.onclick = (e) => {
            const r = e.target.closest(".rec-range");
            if (r) { hideTip(); store.playRecording?.(list[+r.dataset.i]); }
        };
    }

    // ── 재생 ───────────────────────────────────────────────────────────────────
    function step(delta) {
        store.setMainIndex(store.mainIndex + delta);
    }

    function setPlayIcon(playing) {
        playBtn.innerHTML = icon(playing ? "pause" : "play", 18);
        playBtn.classList.toggle("is-playing", playing);
        playBtn.title = playing ? "일시정지 (Space)" : "재생 (Space)";
        rewindBtn.classList.toggle("is-on", playing && dir < 0);
        rewindBtn.title = playing && dir < 0 ? "거꾸로 재생 멈춤" : "거꾸로 재생";
    }

    // 속도는 프레임마다 쌓아서 정수 단계만큼 넘긴다 — 0.25× 도 끊기지 않고, 8× 도 건너뛰며 따라간다
    function play(d) {
        stop();
        dir = d;
        if (d > 0 && store.mainIndex >= last) store.setMainIndex(0);
        if (d < 0 && store.mainIndex <= 0) store.setMainIndex(last);
        let prev = performance.now();
        let acc = 0;
        const tick = (now) => {
            // 탭을 가렸다 돌아오면 쌓인 시간만큼 건너뛰지 않게 한 프레임 최대 0.1초만 센다
            acc += (Math.min(now - prev, 100) / 1000) * STEPS_PER_SEC * speed;
            prev = now;
            const n = Math.floor(acc);
            if (n > 0) {
                acc -= n;
                const next = store.mainIndex + dir * n;
                if (next < 0 || next > last) {
                    store.setMainIndex(next < 0 ? 0 : last);
                    stop();
                    return;
                }
                playing = true;
                store.setMainIndex(next);
                playing = false;
            }
            timer = requestAnimationFrame(tick);
        };
        timer = requestAnimationFrame(tick);
        setPlayIcon(true);
    }

    function stop() {
        if (timer) cancelAnimationFrame(timer);
        timer = null;
        setPlayIcon(false);
    }

    bind(playBtn, "click", () => (timer ? stop() : play(1)));
    bind(rewindBtn, "click", () => (timer && dir < 0 ? stop() : play(-1)));

    // ── 재생 속도 ──
    function setSpeed(value) {
        speed = SPEEDS.includes(value) ? value : 1;
        try { localStorage.setItem(SPEED_KEY, String(speed)); } catch { }
        speedBtn.textContent = speedLabel(speed);
        speedBtn.classList.toggle("is-changed", speed !== 1);
        speedBtn.classList.toggle("is-on", speed !== 1);
        speedBtn.setAttribute("aria-label", `재생 속도 ${speedLabel(speed)}`);
        renderSpeedPop();
    }
    function renderSpeedPop() {
        speedPop.innerHTML = `
            <div class="menu__head">재생 속도</div>
            ${SPEEDS.map((s) => `<button type="button" role="menuitemradio" aria-checked="${s === speed}" data-speed="${s}" class="menu__item speed__opt${s === speed ? " is-on" : ""}">${speedLabel(s)}<em>${speedHint(s)}</em></button>`).join("")}
            <div class="menu__foot"><kbd>&lt;</kbd> <kbd>&gt;</kbd> 로 바꾸기</div>`;
    }
    // 하단 패널이 넘침을 자르므로 목록은 body 에 두고 버튼 위에 고정 위치로 띄운다
    document.body.append(speedPop);
    function placeSpeedPop() {
        const r = speedBtn.getBoundingClientRect();
        const half = speedPop.offsetWidth / 2 || 88;
        speedPop.style.left = `${Math.max(8 + half, Math.min(window.innerWidth - 8 - half, r.left + r.width / 2))}px`;
        speedPop.style.top = `${r.top - 10}px`;
    }
    bind(window, "resize", () => { if (!speedPop.hidden) placeSpeedPop(); });
    function toggleSpeedPop(open = speedPop.hidden) {
        speedPop.hidden = !open;
        if (open) placeSpeedPop();
        speedBtn.setAttribute("aria-expanded", String(open));
        if (open) speedPop.querySelector(".is-on")?.focus();
    }
    function nudgeSpeed(delta) {
        const i = SPEEDS.indexOf(speed);
        setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + delta))]);
        showTip(speedBtn, `<div class="tip-pin"><b>재생 속도 ${speedLabel(speed)}</b><span>${speedHint(speed)}</span></div>`);
        clearTimeout(nudgeSpeed.t);
        nudgeSpeed.t = setTimeout(hideTip, 900);
    }
    bind(speedBtn, "click", (e) => { e.stopPropagation(); toggleSpeedPop(); });
    bind(speedPop, "click", (e) => {
        const opt = e.target.closest("[data-speed]");
        if (!opt) return;
        setSpeed(Number(opt.dataset.speed));
        toggleSpeedPop(false);
        speedBtn.focus();
    });
    bind(speedPop, "keydown", (e) => {
        const opts = [...speedPop.querySelectorAll("[data-speed]")];
        const i = opts.indexOf(document.activeElement);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault(); e.stopPropagation();
            opts[(i + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length]?.focus();
        } else if (e.key === "Escape") {
            e.stopPropagation();
            toggleSpeedPop(false);
            speedBtn.focus();
        }
    });
    bind(document, "click", (e) => { if (!speedPop.hidden && !e.target.closest("#speed, #speed-pop")) toggleSpeedPop(false); });
    bind(document, "keydown", (e) => { if (e.key === "Escape" && !speedPop.hidden) { toggleSpeedPop(false); speedBtn.focus(); } });
    // 패널을 접거나 크기를 바꾸면 버튼이 움직이므로 목록을 닫는다
    sub("panels", () => { if (!speedPop.hidden) toggleSpeedPop(false); });
    setSpeed(speed);
    bind(incBtn, "click", () => { stop(); step(1); });
    bind(decBtn, "click", () => { stop(); step(-1); });
    setPlayIcon(false);

    bind(window, "keydown", (e) => {
        if (e.target.closest?.("input, textarea, select, [contenteditable=true]")) return;
        if (e.key === "ArrowRight") { stop(); step(e.shiftKey ? 10 : 1); e.preventDefault(); }
        else if (e.key === "ArrowLeft") { stop(); step(e.shiftKey ? -10 : -1); e.preventDefault(); }
        else if (e.code === "Space") { timer ? stop() : play(1); e.preventDefault(); }
        else if ((e.key === "<" || e.key === ">") && !e.ctrlKey && !e.metaKey && !e.altKey) { nudgeSpeed(e.key === ">" ? 1 : -1); e.preventDefault(); }
    });

    // ── 차트 클릭 → 이동 ───────────────────────────────────────────────────────
    for (const { chart, canvas } of charts) {
        if (!chart || !canvas) continue;
        // 캔버스는 다시 불러와도 같은 요소를 재사용한다(차트만 새로 만든다) — 이전 핸들러는 걷어낸다
        bind(canvas, "click", (event) => {
            const points = chart.getElementsAtEventForMode(event, "index", { intersect: false }, true);
            if (points.length) store.setMainIndex(points[0].index);
        });
    }

    // ── 날짜·시간으로 이동 ─────────────────────────────────────────────────────
    const modal = document.getElementById("dateTimeModal");
    const dateInput = document.getElementById("dateInput");
    const timeInput = document.getElementById("timeInput");

    bind(timeBtn, "click", () => {
        const p = String(timeKeys[store.mainIndex] || "").split("_");
        if (p.length >= 6) {
            dateInput.value = `${p[0]}-${p[1]}-${p[2]}`;
            timeInput.value = `${p[3]}:${p[4]}:${p[5]}`;
        }
        modal.classList.add("is-open");
        setTimeout(() => dateInput.focus(), 50);
    });
    const close = () => modal.classList.remove("is-open");
    bind(document.getElementById("cancel-button"), "click", close);
    bind(modal, "mousedown", (e) => { if (e.target === modal) close(); });
    bind(modal, "keydown", (e) => { if (e.key === "Escape") close(); });
    bind(document.getElementById("okay-button"), "click", () => {
        close();
        if (!dateInput.value) return;
        const [y, mo, d] = dateInput.value.split("-").map(Number);
        const [h = 0, mi = 0, s = 0] = (timeInput.value || "00:00:00").split(":").map(Number);
        const target = new Date(y, mo - 1, d, h, mi, s).getTime();
        // 가장 가까운 시점
        let best = 0, bestDiff = Infinity;
        store.keyMs.forEach((ms, i) => {
            const diff = Math.abs(ms - target);
            if (diff < bestDiff) { bestDiff = diff; best = i; }
        });
        store.setMainIndex(best);
    });
}
