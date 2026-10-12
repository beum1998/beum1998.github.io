// ─────────────────────────────────────────────────────────────────────────────
// Commit 해석 화면
//
// Design Commit(핀) 하나를 골라, AI 가 받은 입력과 내놓은 해석을 한 화면에 모은다.
//   · Design Commit 기록 — 구간의 시작 · 종료 시점, 이 Commit 과 앞선 Commit 의 Commit Message
//   · 구간별 형상 정보 — 3D(남측)와 바뀐 층의 평면(변경 전 / 변경 후), 변경 순서,
//                        구간 안에서 생성 후 삭제된 객체 · 추가 후 다시 수정된 객체
//   · 구간별 물량 정보 — 변경 요소 수와 카테고리별 물량 차이
//   · AI 해석 결과 — Observed Change / Spatial Impact / Inferred Design Decision + 숫자 검산
// 이미지와 데이터는 buildPinInput 이 만든 것 그대로라, AI 에 보낸 것과 같다.
// ─────────────────────────────────────────────────────────────────────────────

import { store, on, emit, formatKey, escapeHtml, onProjectReset } from "./store.js";
import { icon } from "./icons.js";
import { buildPinInput, mountPinSummary, getPinSummary } from "./aiSummary.js";
import { planLevels } from "./shoot.js";
import { EASE_IN, EASE_OUT, reduced } from "./motion.js";

export function initCommitView() {
    if (window.__ablCommitViewInit) return;
    window.__ablCommitViewInit = true;

    const root = document.getElementById("commit-view");
    if (!root) return;

    const cache = new Map();          // pin.id|from|to → buildPinInput 결과
    onProjectReset(() => cache.clear());
    let current = null;               // 지금 보는 핀
    let token = 0;                    // 늦게 끝난 렌더가 다른 핀 화면을 덮지 않게

    store.openCommitView = (pin) => {
        if (!pin) return;
        current = pin;
        root.hidden = false;
        if (!reduced()) root.animate(
            [{ opacity: 0, transform: "scale(.985) translateY(10px)" }, { opacity: 1, transform: "none" }],
            { duration: 320, easing: EASE_IN },
        );
        render();
    };
    store.closeCommitView = () => {
        current = null;
        if (reduced()) { root.hidden = true; return; }
        root.animate(
            [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.99) translateY(6px)" }],
            { duration: 200, easing: EASE_OUT },
        ).finished.catch(() => { }).then(() => { root.hidden = true; });
    };

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !root.hidden) store.closeCommitView();
    });
    on("pins", () => {
        if (root.hidden || !current) return;
        current = store.pins.find((p) => p.id === current.id) || null;
        if (current) render(); else store.closeCommitView();
    });

    root.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (!act || !current) return;
        if (act === "close") { store.closeCommitView(); return; }
        if (act === "goto") { store.setMainIndex?.(current.index); store.closeCommitView(); return; }
        if (act === "prev" || act === "next") {
            const i = store.pins.findIndex((p) => p.id === current.id);
            const next = store.pins[act === "prev" ? i - 1 : i + 1];
            if (next) { current = next; root.scrollTop = 0; render(); }
        }
    });

    function inputOf(pin) {
        const prevIndex = [...store.pins].reverse().find((p) => p.index < pin.index)?.index ?? 0;
        const key = `${pin.id}|${prevIndex}|${pin.index}`;
        if (!cache.has(key)) cache.set(key, buildPinInput(pin));
        return cache.get(key);
    }

    function render() {
        const pin = current;
        const my = ++token;
        const i = store.pins.findIndex((p) => p.id === pin.id);
        root.innerHTML = header(pin, i) + `
            <div class="cv">
                <div class="cv__busy busy"><span class="spinner"></span>AI 에 보내는 이미지와 데이터를 만드는 중…</div>
            </div>`;
        // 화면 밖 렌더가 무거우니 한 프레임 쉬고 만든다(머리가 먼저 보이게)
        requestAnimationFrame(() => setTimeout(() => {
            if (my !== token || root.hidden) return;
            let input;
            try { input = inputOf(pin); }
            catch (err) {
                root.querySelector(".cv").innerHTML = `<p class="notice tone-del">${icon("alert", 13)}${escapeHtml(err.message || String(err))}</p>`;
                return;
            }
            root.querySelector(".cv").innerHTML = body(pin, input);
            mountPinSummary(root.querySelector(".cv-ai"), pin, { onChange: () => emit("pins", store.pins) });
        }, 30));
    }

    function header(pin, i) {
        const f = formatKey(pin.ts);
        return `
            <div class="hhead">
                <div class="hhead__title">${icon("sparkle", 16)}<b>Commit 해석</b><span>${i + 1} / ${store.pins.length} · ${f.date} ${f.time.slice(0, 5)}</span></div>
                <div class="hhead__actions">
                    <button class="btn btn--ghost btn--xs" type="button" data-act="prev"${i > 0 ? "" : " disabled"}>${icon("stepBack", 13)}앞 Commit</button>
                    <button class="btn btn--ghost btn--xs" type="button" data-act="next"${i < store.pins.length - 1 ? "" : " disabled"}>뒤 Commit${icon("stepFwd", 13)}</button>
                    <button class="btn btn--ghost btn--xs" type="button" data-act="goto">${icon("arrowRight", 13)}이 시점 보기</button>
                    <button class="btn btn--ghost btn--icon btn--sm" type="button" data-act="close" title="닫기" aria-label="닫기">${icon("x", 15)}</button>
                </div>
            </div>`;
    }

    function body(pin, input) {
        return commitHtml(pin, input) + shapeHtml(pin, input) + quantityHtml(input) + `
            <div class="sec-head"><h3>AI 해석 결과</h3><span class="cv__hint">Observed Change, Spatial Impact, Inferred Design Decision</span></div>
            <div class="cv-ai aiblk card"${getPinSummary(pin.id) ? "" : ""}></div>`;
    }

    // ── Commit Message ──────────────────────────────────────────────────────
    function commitHtml(pin, input) {
        const t = input.context.시점;
        const one = (label, p, when, tone) => `
            <div class="cv-msg ${tone}">
                <div class="cv-msg__top"><span class="tag">${label}</span><time>${escapeHtml(when)}</time>${p?.stage ? `<span class="tag tone-neutral">${escapeHtml(p.stage)}</span>` : ""}</div>
                ${p ? `<h3 class="cv-msg__title">${escapeHtml(p.title)}</h3>${p.note ? `<p class="cv-msg__note">${escapeHtml(p.note)}</p>` : `<p class="cv-msg__note cv-msg__note--none">메모 없음</p>`}`
                    : `<h3 class="cv-msg__title cv-msg__title--none">기록 시작</h3>`}
            </div>`;
        return `
            <div class="sec-head sec-head--flush"><h3>Design Commit 기록</h3><span class="cv__hint">구간 ${escapeHtml(t.이전.시각)} ~ ${escapeHtml(t.현재.시각)}</span></div>
            <div class="cv-msgs">
                ${one("앞선 Commit", input.prev, t.이전.시각, "tone-neutral")}
                <span class="cv-msgs__arrow">${icon("arrowRight", 16)}</span>
                ${one("이 Commit", pin, t.현재.시각, "tone-pin")}
            </div>`;
    }

    // ── 구간별 형상 정보: 모델과 층별 평면(열 = 3D + 층(높이 순), 행 = 변경 전 / 변경 후) + 변경 순서 ──
    function shapeHtml(pin, input) {
        const order = planLevels().map((l) => l.key);
        const levels = [...input.plans.levels].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
        const cols = [
            { head: "3D 모델", sub: "남측", before: input.beforeShot[0], after: input.views[0] },
            ...levels.map((l) => ({ head: `${l.name} 평면`, sub: l.role, before: l.before, after: l.after })),
        ];
        const cell = (src, alt) => src
            ? `<figure class="cv-shot"><img src="${src}" alt="${escapeHtml(alt)}"></figure>`
            : `<figure class="cv-shot cv-shot--none"><span>인접 층은 변경 후만 보냄</span></figure>`;
        return `
            <div class="sec-head"><h3>구간별 형상 정보</h3>
                <span class="cv-legend">
                    <span class="tag tone-add">추가</span><span class="tag tone-mod">수정</span><span class="tag tone-del">삭제 (변경 전 평면)</span>
                    <em>평면은 층고 40% 높이의 수평 단면, 북쪽이 위</em>
                </span>
            </div>
            <div class="cv-shots card" style="--cols:${cols.length}">
                <span></span>
                ${cols.map((c) => `<div class="cv-shots__head"><b>${escapeHtml(c.head)}</b><span>${escapeHtml(c.sub)}</span></div>`).join("")}
                <div class="cv-shots__row">변경 전</div>
                ${cols.map((c) => cell(c.before, `${c.head} 변경 전`)).join("")}
                <div class="cv-shots__row">변경 후</div>
                ${cols.map((c) => cell(c.after, `${c.head} 변경 후`)).join("")}
            </div>
            ${processHtml(pin, input)}`;
    }

    function processHtml(pin, input) {
        const c = input.context;
        const seq = c.변경_순서?.단계 || [];
        const skipped = c.변경_순서?.생략한_작은_단계 || 0;
        const proc = c.구간_내부_과정 || {};
        return `
            <div class="cv-proc">
                <div class="card cv-proc__counts">
                    <div class="metric"><span>생성 후 삭제된 객체</span><b>${(proc.생성_후_삭제된_객체 ?? 0).toLocaleString()}</b></div>
                    <div class="metric"><span>추가 후 다시 수정된 객체</span><b>${(proc.추가_후_다시_수정된_객체 ?? 0).toLocaleString()}</b></div>
                    <div class="metric"><span>값이 바뀐 수정</span><b>${(c.수정_내용?.값이_바뀐_요소 ?? 0).toLocaleString()}</b></div>
                </div>
                <div class="card cv-proc__seq">
                    <div class="cv-info__title">변경 순서<span>${seq.length}단계${skipped ? `, 작은 단계 ${skipped}개 생략` : ""}</span></div>
                    <ol class="cv-seq">
                        ${seq.map((st) => `<li><time>${escapeHtml(st.시각)}</time><span>${st.변경.map(escapeHtml).join("<br>")}</span></li>`).join("")}
                    </ol>
                </div>
            </div>`;
    }

    // ── 구간별 물량 정보: 변경 요소 수 · 카테고리별 물량 차이 ──────────────────
    function quantityHtml(input) {
        const c = input.context;
        const n = c.변경_요소_수;
        const fmt = (v) => typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 3 }) : escapeHtml(String(v ?? ""));
        const sign = (v) => (v > 0 ? "+" : "") + fmt(v);
        const qty = (c.물량_변화 || []).slice(0, 12);
        return `
            <div class="sec-head"><h3>구간별 물량 정보</h3><span class="cv__hint">객체 상태의 변화로 코드가 계산한 값</span></div>
            <div class="cv-qty">
                <div class="card cv-qty__counts">
                    <div class="metric tone-add"><span>추가</span><b>${fmt(n.추가)}</b></div>
                    <div class="metric tone-del"><span>삭제</span><b>${fmt(n.삭제)}</b></div>
                    <div class="metric tone-mod"><span>수정</span><b>${fmt(n.수정)}</b></div>
                </div>
                <div class="card cv-qty__table">
                    ${qty.length ? `<table class="tbl tbl--xs">
                        <thead><tr><th>카테고리</th><th>지표</th><th class="n">변경 전</th><th class="n">변경 후</th><th class="n">차이</th></tr></thead>
                        <tbody>${qty.map((q) => `<tr><td>${escapeHtml(q.카테고리)}</td><td>${escapeHtml(q.지표)}</td><td class="n">${fmt(q.A)}</td><td class="n">${fmt(q.B)}</td><td class="n ${q.증감 > 0 ? "cv-up" : q.증감 < 0 ? "cv-down" : ""}">${sign(q.증감)}</td></tr>`).join("")}</tbody>
                    </table>` : `<p class="cv__hint">물량 변화 없음</p>`}
                </div>
            </div>`;
    }
}
