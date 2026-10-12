// ─────────────────────────────────────────────────────────────────────────────
// 재작업 분석 화면 (이력 화면의 "분석" 보기)
//
//   · 지표 타일   생성 · 최종 · 폐기율 · 헛수고 편집 · 요소당 평균 수정
//   · 핀 구간별 편집   구간마다 "남은 편집 / 되돌린 편집" 가로 누적 막대 (+ 표로 보기)
//   · 요소 수명선      요소마다 존재한 기간(막대)과 수정 시점(점), 핀 위치(세로선)
//                      층 × 카테고리로 묶어 접어 두고, 묶음 머리에는 편집 밀도 띠
//   · 층 × 카테고리 표 · 가장 많이 고친 요소 표
//
// 색은 "강조" 형식 하나만 쓴다 — 이야기의 주인공(버린 것/되돌린 것)은 강조색,
// 나머지는 회색. 범례 · 값 라벨 · 표가 함께 있어 색만으로 읽지 않게 한다.
// 숫자는 rework.js 가 계산한 값만 쓴다.
// ─────────────────────────────────────────────────────────────────────────────

import { store, catInfo, escapeHtml, formatKey, showTip, hideTip } from "./store.js";
import { icon } from "./icons.js";
import { analyzeRework, segmentRework, elementsCsv, segmentsCsv } from "./rework.js";
import { download, stamp, projectName } from "./rating.js";
import { fmtDuration, shortLevel } from "./pinView.js";

const state = {
    sort: "first",          // first | mods
    show: "all",            // all | discarded | revised
    segTable: false,
    open: new Set(),        // 펼친 묶음 key
};

const BINS = 120;

export function renderAnalysis(host, { onJump } = {}) {
    if (!host) return;
    if (!store.timeKeys.length) {
        host.innerHTML = `<div class="hempty"><div class="empty__title">분석할 기록이 없어요</div></div>`;
        return;
    }

    const R = analyzeRework();
    const t = R.totals;
    const segs = store.pins.map((pin, i) => {
        const from = i > 0 ? store.pins[i - 1].index : 0;
        return { pin, order: i + 1, s: segmentRework(from, pin.index) };
    });

    host.innerHTML = `
        <section class="anl-intro">
            <div>
                <h2>재작업 분석</h2>
                <p>스냅샷 ${R.n.toLocaleString()}개를 처음부터 훑어 요소마다 언제 생기고, 몇 번 고쳐지고, 결국 남았는지를 복원했어요.
                   <b>폐기율</b>은 끝까지 남지 못한 요소의 비율, <b>헛수고 편집</b>은 그런 요소에 들어간 편집의 비율이에요.</p>
            </div>
            <div class="anl-intro__acts">
                <button class="btn btn--ghost btn--xs" type="button" data-anl="csv-elements">${icon("download", 13)}요소별 CSV</button>
                <button class="btn btn--ghost btn--xs" type="button" data-anl="csv-segments">${icon("download", 13)}구간별 CSV</button>
            </div>
        </section>

        <section class="anl-kpis">
            ${tile("생성된 요소", t.created.toLocaleString(), "한 번이라도 모델에 있었던 요소")}
            ${tile("최종 요소", t.final.toLocaleString(), "마지막 시점에 남은 요소")}
            ${tile("폐기율", pct(t.discardRate), `${t.discarded}개가 끝까지 남지 못함 · 10분 안에 사라진 요소 ${t.shortLived}`)}
            ${tile("헛수고 편집", pct(t.wastedRatio), `편집 ${t.edits.toLocaleString()}회 중 ${t.wastedEdits.toLocaleString()}회`)}
            ${tile("요소당 평균 수정", `${t.meanModsAlive.toFixed(1)}회`, `남은 요소 기준 · 지웠다 되살린 요소 ${t.revived}`)}
        </section>

        <section class="anl-card card card--flat">
            <header class="anl-card__head">
                <div>
                    <h3>핀 구간별 편집</h3>
                    <p>구간 안에서 요소를 추가·수정한 횟수. 강조색은 손댔지만 그 핀 시점에는 남지 않은 요소에 들어간 편집이에요.</p>
                </div>
                <button class="btn btn--ghost btn--xs${state.segTable ? " is-on" : ""}" type="button" data-anl="seg-table">${icon("list", 13)}${state.segTable ? "막대로 보기" : "표로 보기"}</button>
            </header>
            ${segs.length ? (state.segTable ? segTable(segs) : segBars(segs)) : `<p class="anl-none">핀이 없어서 구간을 나눌 수 없어요.</p>`}
        </section>

        <section class="anl-card anl-card--life card card--flat">
            <header class="anl-card__head">
                <div>
                    <h3>요소 수명선</h3>
                    <p>막대는 요소가 모델에 있던 기간, 점은 수정된 시점, 세로선은 핀이에요. 묶음을 눌러 펼치고, 줄을 누르면 그 요소를 골라 변경 이력을 보여줘요.</p>
                </div>
            </header>
            <div class="anl-controls">
                <div class="seg" role="group" aria-label="정렬">
                    ${segBtn("sort", "first", "처음 생긴 순")}
                    ${segBtn("sort", "mods", "수정 많은 순")}
                </div>
                <div class="seg" role="group" aria-label="보기">
                    ${segBtn("show", "all", "전체")}
                    ${segBtn("show", "discarded", "버린 요소")}
                    ${segBtn("show", "revised", "3회 이상 수정")}
                </div>
                <span class="anl-controls__count"></span>
                <button class="btn btn--ghost btn--xs" type="button" data-anl="expand-all">${icon("layers", 13)}모두 펼치기</button>
                <button class="btn btn--ghost btn--xs" type="button" data-anl="collapse-all">접기</button>
            </div>
            <div class="anl-legend">
                <span><i class="lg-bar lg-bar--kept"></i>끝까지 남은 요소</span>
                <span><i class="lg-bar lg-bar--gone"></i>버린 요소</span>
                <span><i class="lg-dot"></i>수정 시점</span>
                <span><i class="lg-pin"></i>핀</span>
            </div>
            <div class="life" data-life></div>
        </section>

        <div class="anl-grid">
            <section class="anl-card card card--flat">
                <header class="anl-card__head"><div><h3>층 × 카테고리</h3><p>어디서 많이 만들고 버렸는지.</p></div></header>
                ${levelCatTable(R.byLevelCat)}
            </section>
            <section class="anl-card card card--flat">
                <header class="anl-card__head"><div><h3>가장 많이 고친 요소</h3><p>수정 횟수 순 · 누르면 그 요소의 변경 이력</p></div></header>
                ${topTable(R.topRevised)}
            </section>
        </div>`;

    // 수명선 머리 축이 이력 화면 머리 바로 아래에 붙도록 실제 높이를 넘긴다
    const head = host.closest("#history")?.querySelector(".hhead");
    if (head) host.style.setProperty("--hhead-h", head.offsetHeight + "px");

    renderLife(host.querySelector("[data-life]"), R, host);
    wire(host, R, onJump);
}

// ── 지표 타일 ───────────────────────────────────────────────────────────────
function tile(label, value, sub) {
    return `<div class="kpi card card--flat"><div class="kpi__label">${escapeHtml(label)}</div><div class="kpi__value">${escapeHtml(value)}</div><div class="kpi__sub">${escapeHtml(sub)}</div></div>`;
}

function pct(v) { return `${(v * 100).toFixed(1)}%`; }

// ── 핀 구간별 편집 ──────────────────────────────────────────────────────────
function segBars(segs) {
    const max = Math.max(1, ...segs.map((x) => x.s.edits));
    return `
        <div class="anl-legend anl-legend--tight">
            <span><i class="lg-bar lg-bar--kept"></i>남은 편집</span>
            <span><i class="lg-bar lg-bar--gone"></i>되돌린 편집</span>
        </div>
        <div class="sbars">
        ${segs.map(({ pin, order, s }) => {
            const widthPct = (s.edits / max) * 100;
            const share = s.edits ? Math.round((s.revertedEdits / s.edits) * 100) : 0;
            return `
            <div class="sbar" data-seg="${order - 1}">
                <div class="sbar__label" title="${escapeHtml(pin.title)}"><span class="sbar__n num-dot num-dot--soft">${order}</span><span class="sbar__t">${escapeHtml(pin.title)}</span></div>
                <div class="sbar__track">
                    <span class="sbar__bars" style="--w:${widthPct.toFixed(2)}">
                        ${s.keptEdits ? `<i class="sbar__fill sbar__fill--kept${s.revertedEdits ? "" : " is-end"}" style="flex-grow:${s.keptEdits}" tabindex="0" role="img" aria-label="${order}번 구간 남은 편집 ${s.keptEdits}회" data-tip="kept"></i>` : ""}
                        ${s.revertedEdits ? `<i class="sbar__fill sbar__fill--gone is-end" style="flex-grow:${s.revertedEdits}" tabindex="0" role="img" aria-label="${order}번 구간 되돌린 편집 ${s.revertedEdits}회" data-tip="gone"></i>` : ""}
                    </span>
                    <span class="sbar__value">${s.edits.toLocaleString()}${s.revertedEdits ? ` <em>되돌림 ${share}%</em>` : ""}</span>
                </div>
            </div>`;
        }).join("")}
        </div>`;
}

function segTable(segs) {
    return `
        <div class="anl-table-wrap"><table class="anl-table tbl">
            <thead><tr><th>#</th><th>핀</th><th>걸린 시간</th><th>실작업</th><th>편집</th><th>되돌린 편집</th><th>되돌린 요소</th><th>확정</th></tr></thead>
            <tbody>${segs.map(({ pin, order, s }) => `
                <tr><td>${order}</td><td class="t">${escapeHtml(pin.title)}</td>
                <td>${fmtDuration(s.spanMs)}</td><td>${fmtDuration(s.activeMs)}</td>
                <td class="n">${s.edits.toLocaleString()}</td><td class="n">${s.revertedEdits.toLocaleString()}</td>
                <td class="n">${s.reverted}</td><td class="n">${s.settled}</td></tr>`).join("")}
            </tbody>
        </table></div>`;
}

function segBtn(group, value, label) {
    return `<button type="button" class="seg__btn${state[group] === value ? " is-on" : ""}" data-anl-set="${group}" data-value="${value}">${label}</button>`;
}

// ── 요소 수명선 ─────────────────────────────────────────────────────────────
function renderLife(host, R, root) {
    if (!host) return;
    const n = Math.max(1, R.n - 1);
    const x = (i) => (i / n) * 100;

    let lives = [...R.lives.values()];
    if (state.show === "discarded") lives = lives.filter((l) => !l.alive);
    else if (state.show === "revised") lives = lives.filter((l) => l.mods >= 3);

    const count = root.querySelector(".anl-controls__count");
    if (count) count.textContent = `${R.lives.size}개 중 ${lives.length}개`;

    // 층 × 카테고리로 묶기 (층 위 → 아래, 카테고리 순)
    const levelOrder = new Map(store.levels.map((lv, i) => [lv.key, i]));
    const groups = new Map();
    for (const l of lives) {
        const key = `${l.info.level.key}|${l.info.cat}`;
        if (!groups.has(key)) groups.set(key, { key, level: l.info.level, cat: l.info.cat, catLabel: l.info.catLabel, catOrder: l.info.catOrder, items: [] });
        groups.get(key).items.push(l);
    }
    const ordered = [...groups.values()].sort((a, b) => {
        const la = levelOrder.get(a.level.key) ?? 99;
        const lb = levelOrder.get(b.level.key) ?? 99;
        if (la !== lb) return lb - la;
        return a.catOrder - b.catOrder;
    });
    for (const g of ordered) {
        g.items.sort(state.sort === "mods"
            ? (a, b) => b.mods - a.mods || a.firstIdx - b.firstIdx
            : (a, b) => a.firstIdx - b.firstIdx);
    }

    // 머리 축: 시작 · 끝 날짜 + 핀 번호
    const axis = `
        <div class="life__axis">
            <div class="life__label life__label--axis">요소</div>
            <div class="life__track life__track--axis">
                ${store.pins.map((p, i) => `<span class="life__pinmark" style="left:${x(p.index)}%" title="${escapeHtml(p.title)}">${i + 1}</span>`).join("")}
                <span class="life__tick life__tick--start">${formatKey(store.timeKeys[0]).date}</span>
                <span class="life__tick life__tick--end">${formatKey(store.timeKeys[R.n - 1]).date}</span>
            </div>
        </div>`;

    const pinLines = `<div class="life__pins" aria-hidden="true">${store.pins.map((p) => `<i style="left:${x(p.index)}%"></i>`).join("")}</div>`;

    const body = ordered.map((g) => {
        const open = state.open.has(g.key);
        const gone = g.items.filter((l) => !l.alive).length;
        const edits = g.items.reduce((s, l) => s + l.edits, 0);

        // 묶음 머리의 편집 밀도 띠 (한 가지 색, 많을수록 진하게)
        const bins = new Uint16Array(BINS);
        for (const l of g.items) for (const i of l.changes) bins[Math.min(BINS - 1, Math.floor((i / (n + 1)) * BINS))]++;
        const peak = Math.max(1, ...bins);
        const strip = [...bins].map((c, b) => c
            ? `<i style="left:${(b / BINS) * 100}%;width:${100 / BINS}%;opacity:${(0.18 + 0.82 * (c / peak)).toFixed(2)}"></i>`
            : "").join("");

        const rows = open ? g.items.map((l) => lifeRow(l, x)).join("") : "";
        return `
            <div class="life__group${open ? " is-open" : ""}" data-group="${escapeHtml(g.key)}">
                <button class="life__ghead" type="button" data-anl="group" data-key="${escapeHtml(g.key)}" aria-expanded="${open}">
                    <span class="life__label">
                        ${icon("chevronRight", 12)}
                        <i class="dot" style="--c:${catInfo(g.cat).color}"></i>
                        <b>${escapeHtml(shortLevel(g.level.name))} · ${escapeHtml(g.catLabel)}</b>
                        <em>${g.items.length}${gone ? ` · 버림 ${gone}` : ""} · 편집 ${edits}</em>
                    </span>
                    <span class="life__track life__strip">${strip}</span>
                </button>
                ${open ? `<div class="life__rows">${rows}</div>` : ""}
            </div>`;
    }).join("");

    host.innerHTML = axis + `<div class="life__body">${pinLines}${body || `<p class="anl-none">조건에 맞는 요소가 없어요.</p>`}</div>`;
}

function lifeRow(l, x) {
    const name = l.info.type || l.info.family || l.base;
    const spans = l.spans.map(([a, b]) => {
        const left = x(a);
        const width = Math.max(0.35, x(b) - x(a));
        return `<i class="life__span${l.alive ? "" : " is-gone"}" style="left:${left}%;width:${width}%"></i>`;
    }).join("");
    // 첫 등장(추가)은 막대 시작으로 이미 보이므로, 점은 수정만
    const mods = l.changes.slice(1).filter((i) => !l.spans.some(([a]) => a === i));
    const dots = mods.map((i) => `<i class="life__dot" style="left:${x(i)}%"></i>`).join("");
    return `
        <div class="life__row" data-base="${escapeHtml(l.base)}" tabindex="0">
            <span class="life__label"><span class="life__name">${escapeHtml(name)}</span><em>${l.mods ? `수정 ${l.mods}` : ""}</em></span>
            <span class="life__track">${spans}${dots}</span>
        </div>`;
}

// ── 표 ──────────────────────────────────────────────────────────────────────
function levelCatTable(rows) {
    return `
        <div class="anl-table-wrap"><table class="anl-table tbl">
            <thead><tr><th>층</th><th>카테고리</th><th>생성</th><th>최종</th><th>버림</th><th>폐기율</th><th>편집</th><th>헛수고 편집</th></tr></thead>
            <tbody>${rows.map((r) => `
                <tr>
                    <td class="t">${escapeHtml(shortLevel(r.level.name))}</td>
                    <td class="t"><i class="dot" style="--c:${catInfo(r.cat).color}"></i>${escapeHtml(r.catLabel)}</td>
                    <td class="n">${r.created}</td><td class="n">${r.final}</td><td class="n">${r.discarded}</td>
                    <td class="meter-cell"><span class="meter"><i style="width:${(r.discardRate * 100).toFixed(1)}%"></i></span><span class="n">${pct(r.discardRate)}</span></td>
                    <td class="n">${r.edits}</td><td class="n">${r.wastedEdits}</td>
                </tr>`).join("")}
            </tbody>
        </table></div>`;
}

function topTable(lives) {
    return `
        <div class="anl-table-wrap"><table class="anl-table anl-table--click tbl">
            <thead><tr><th>#</th><th>요소</th><th>층</th><th>수정</th><th>편집</th><th>상태</th></tr></thead>
            <tbody>${lives.map((l, i) => `
                <tr data-base="${escapeHtml(l.base)}" tabindex="0">
                    <td class="n">${i + 1}</td>
                    <td class="t"><i class="dot" style="--c:${catInfo(l.info.cat).color}"></i>${escapeHtml(l.info.catLabel)} · ${escapeHtml(l.info.type || l.info.family || l.base)}</td>
                    <td class="t">${escapeHtml(shortLevel(l.info.level.name))}</td>
                    <td class="n">${l.mods}</td><td class="n">${l.edits}</td>
                    <td>${l.alive ? `<span class="state tag tag--md">남음</span>` : `<span class="state tag tag--md tone-accent">버림</span>`}</td>
                </tr>`).join("")}
            </tbody>
        </table></div>`;
}

// ── 상호작용 ────────────────────────────────────────────────────────────────
function wire(host, R, onJump) {
    host.onclick = (e) => {
        const btn = e.target.closest("[data-anl], [data-anl-set]");
        if (btn?.dataset.anlSet) {
            state[btn.dataset.anlSet] = btn.dataset.value;
            if (btn.dataset.anlSet === "show" && state.show !== "all") {
                // 걸러 보기를 켜면 결과가 있는 묶음을 펼쳐 바로 보이게
                for (const l of R.lives.values()) state.open.add(`${l.info.level.key}|${l.info.cat}`);
            }
            renderAnalysis(host, { onJump });
            return;
        }
        const act = btn?.dataset.anl;
        if (act === "csv-elements") { download("﻿" + elementsCsv(), `${projectName()}_요소별재작업_${stamp()}.csv`, "text/csv;charset=utf-8"); return; }
        if (act === "csv-segments") { download("﻿" + segmentsCsv(), `${projectName()}_구간별재작업_${stamp()}.csv`, "text/csv;charset=utf-8"); return; }
        if (act === "seg-table") { state.segTable = !state.segTable; renderAnalysis(host, { onJump }); return; }
        if (act === "group") {
            const key = btn.dataset.key;
            if (state.open.has(key)) state.open.delete(key); else state.open.add(key);
            renderLife(host.querySelector("[data-life]"), R, host);
            return;
        }
        if (act === "expand-all") {
            for (const l of R.lives.values()) state.open.add(`${l.info.level.key}|${l.info.cat}`);
            renderLife(host.querySelector("[data-life]"), R, host);
            return;
        }
        if (act === "collapse-all") { state.open.clear(); renderLife(host.querySelector("[data-life]"), R, host); return; }

        const row = e.target.closest("[data-base]");
        if (row) jumpTo(row.dataset.base);
    };

    host.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        const row = e.target.closest("[data-base]");
        if (row) { e.preventDefault(); jumpTo(row.dataset.base); }
    };

    function jumpTo(base) {
        const l = R.lives.get(base);
        if (!l) return;
        hideTip();
        onJump?.(l.alive ? l.lastChange : l.lastIdx);
        store.selectElement?.(base);   // 요소 탭에서 변경 이력을 바로 보게
    }

    // 툴팁 — 마우스 위치 기준, 키보드 포커스에도 같은 내용
    const tipFor = (el) => {
        const row = el.closest?.(".life__row");
        if (row) return lifeTip(R.lives.get(row.dataset.base));
        const fill = el.closest?.(".sbar__fill");
        if (fill) {
            const seg = Number(fill.closest(".sbar").dataset.seg);
            const pin = store.pins[seg];
            const from = seg > 0 ? store.pins[seg - 1].index : 0;
            const s = segmentRework(from, pin.index);
            const kind = fill.dataset.tip;
            return `<div class="tip-pin"><b>${kind === "gone" ? s.revertedEdits.toLocaleString() : s.keptEdits.toLocaleString()}회 · ${kind === "gone" ? "되돌린 편집" : "남은 편집"}</b>
                <span>#${seg + 1} ${escapeHtml(pin.title)}</span>
                <span>편집 ${s.edits.toLocaleString()} · 되돌린 요소 ${s.reverted} · 확정 ${s.settled}</span></div>`;
        }
        return null;
    };
    host.onpointermove = (e) => {
        const html = tipFor(e.target);
        if (!html) { hideTip(); return; }
        showTip(pointAnchor(e.clientX, e.clientY), html);
    };
    host.onpointerleave = () => hideTip();
    // focusin 은 on* 속성이 없어 리스너로 단다 — 다시 그릴 때 겹치지 않게 최신 tipFor 만 쓴다
    host.__anlTipFor = tipFor;
    if (!host.__anlFocus) {
        host.__anlFocus = true;
        host.addEventListener("focusin", (e) => {
            const html = host.__anlTipFor?.(e.target);
            if (html) showTip(e.target, html);
        });
        host.addEventListener("focusout", () => hideTip());
    }
}

function lifeTip(l) {
    if (!l) return null;
    const first = formatKey(store.timeKeys[l.firstIdx]);
    const last = formatKey(store.timeKeys[l.lastIdx]);
    const lived = store.keyMs[l.lastIdx] - store.keyMs[l.firstIdx];
    return `<div class="tip-pin">
        <b>${escapeHtml(l.info.catLabel)} · ${escapeHtml(l.info.type || l.info.family || l.base)}</b>
        <span>${escapeHtml(l.info.level.name)} · ID ${escapeHtml(l.base)}</span>
        <span>${first.date} ${first.time.slice(0, 5)} 생김 → ${l.alive ? "끝까지 남음" : `${last.date} ${last.time.slice(0, 5)} 사라짐`}</span>
        <span>편집 ${l.edits} (수정 ${l.mods})${l.spans.length > 1 ? ` · 되살림 ${l.spans.length - 1}` : ""}${l.alive ? "" : ` · 존재 ${fmtDuration(lived)}`}</span>
    </div>`;
}

function pointAnchor(x, y) {
    return { getBoundingClientRect: () => ({ left: x, top: y - 6, width: 0, height: 0, bottom: y + 14, right: x }) };
}
