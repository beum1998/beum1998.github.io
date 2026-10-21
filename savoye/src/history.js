// ─────────────────────────────────────────────────────────────────────────────
// 작업 이력 (History rail)
//
// 핀을 세로 줄기에 꿴 화면. 핀마다
//   · 왼쪽: 그 시점의 모델 사진 (모든 핀이 같은 카메라 각도로 자동 렌더)
//   · 가운데: 줄기와 노드, 핀 사이 구간 요약(경과 시간 · 변경 횟수 · 녹음)
//   · 오른쪽: 단계 · 제목 · 메모와 층 × 카테고리 변화, 바로가기 버튼
//
// 사진은 메인 뷰어의 장면을 그대로 빌려 화면 밖 렌더러로 한 장씩 찍는다.
// 가시성을 바꿨다가 같은 동기 블록 안에서 되돌리므로 메인 화면은 깜빡이지 않는다.
// 화면에 들어온 카드부터 찍고(지연 생성), 찍은 사진은 캐시한다.
// ─────────────────────────────────────────────────────────────────────────────

import { Color } from "three";
import { store, on, emit, catInfo, levelOf, formatKey, escapeHtml, onProjectReset, LAB } from "./store.js";
import { icon } from "./icons.js";
import { diffElementVersionsFromLists } from "./script/diffView.js";
import { captureViews, DEFAULT_DIR } from "./shoot.js";
import { mountPinSummary, getPinSummary, mountProjectSummary, getProjectSummary } from "./aiSummary.js";
import { downloadHistoryReport, downloadBackup, readBackupFile, restoreBackup, ratingLine } from "./report.js";
import { downloadRatings } from "./rating.js";
import { refreshPins } from "./pins.js";
import { pinFacts, statsHtml, chipsHtml, fmtDuration, modsHtml } from "./pinView.js";
import { renderAnalysis } from "./analysis.js";
import { EASE_IN, EASE_OUT, reduced, stagger } from "./motion.js";

const SHOT_SIZE = { w: 480, h: 340 };
const ADDED_TINT = new Color("#22c55e");

export function initHistory() {
    if (window.__ablHistoryInit) return;
    window.__ablHistoryInit = true;

    const root = document.getElementById("history");
    if (!root) return;

    const shots = new Map();          // pin.id → dataURL
    onProjectReset(() => shots.clear());
    let observer = null;
    let order = "desc";               // 최신순
    let view = "rail";                // rail(이력) | analysis(재작업 분석)
    let highlightAdded = true;
    let showAi = true;                // 카드마다 AI 해석(관찰 · 영향 · 추론)을 펼쳐 둘지
    let dir = DEFAULT_DIR;            // 모든 썸네일이 공유하는 카메라 방향

    store.openHistory = () => {
        root.hidden = false;
        if (!reduced()) root.animate(
            [{ opacity: 0, transform: "scale(.985) translateY(10px)" }, { opacity: 1, transform: "none" }],
            { duration: 320, easing: EASE_IN },
        );
        render();
    };
    store.closeHistory = () => {
        if (reduced()) { root.hidden = true; }
        else {
            root.animate(
                [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.99) translateY(6px)" }],
                { duration: 200, easing: EASE_OUT },
            ).finished.catch(() => { }).then(() => { root.hidden = true; });
        }
        observer?.disconnect();
    };

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !root.hidden) store.closeHistory();
    });

    on("pins", () => { if (!root.hidden) render(); });
    on("data", () => { if (!root.hidden) render(); });
    on("time:main", () => markCurrent());

    root.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "close") { store.closeHistory(); return; }
        if (act === "order") { order = order === "desc" ? "asc" : "desc"; render(); return; }
        if (act === "reshoot") { reshootFromCurrentView(); return; }
        if (act === "highlight") { highlightAdded = !highlightAdded; shots.clear(); render(); return; }
        if (act === "ai-all") { showAi = !showAi; render(); return; }
        if (act === "menu") { toggleMenu(); return; }
        if (act === "view") {
            const next = e.target.closest("[data-view]")?.dataset.view;
            if (next && next !== view) { view = next; root.scrollTop = 0; render(); }
            return;
        }
        if (act === "project") { openProject(); return; }
        if (act === "briefing") { closeMenu(); store.openBriefing?.(); return; }
        if (act === "report") { closeMenu(); toast(`보고서를 내려받았어요 — 브라우저에서 열고 인쇄(Ctrl+P)하면 PDF 가 돼요.`); downloadHistoryReport(); return; }
        if (act === "ratings") {
            closeMenu();
            const n = downloadRatings();
            toast(n ? `평가 ${n}건을 CSV 로 내려받았어요.` : "아직 평가한 요약이 없어요. 요약 아래 [정확·부분·오류] 를 눌러 남겨 보세요.");
            return;
        }
        if (act === "backup") { closeMenu(); downloadBackup(); toast("백업 파일을 내려받았어요. (API 키는 들어 있지 않아요)"); return; }
        if (act === "restore") { closeMenu(); pickBackup(); return; }

        const card = e.target.closest(".hseg[data-pin]");
        if (!card) return;
        const pin = store.pins.find((p) => p.id === card.dataset.pin);
        if (!pin) return;
        if (act === "goto" || act === "shot") {
            store.setMainIndex?.(pin.index);
            store.closeHistory();
        } else if (act === "compare") {
            const prev = prevPin(pin);
            store.closeHistory();
            store.openSplit?.({ beforeIndex: prev ? prev.index : 0, afterIndex: pin.index });
        } else if (act === "play") {
            const rec = store.recordings.find((r) => r.name === card.dataset.rec);
            if (rec) { store.closeHistory(); store.playRecording?.(rec); }
        } else if (act === "view") {
            store.closeHistory();
            store.openCommitView?.(pin);
        } else if (act === "ai") {
            openAi(card, pin);
        }
    });

    // ── 구간 요약 ────────────────────────────────────────────────────────────
    function prevPin(pin) {
        let hit = null;
        for (const p of store.pins) if (p.index < pin.index) hit = p;
        return hit;
    }

    /** 핀 탭 · 보고서와 같은 사실(pinView.pinFacts)을 쓴다 — 같은 핀은 어디서나 같은 숫자 */
    function summarize(pin) {
        const f = pinFacts(pin);
        return { ...f, events: f.rework.events };
    }

    function elementLine(id) {
        const g = store.meshDict[id];
        if (!g) return null;
        const c = g.userData?.Common || {};
        const ci = catInfo(c.ElementCategory);
        return `<li><i class="dot" style="--c:${ci.color}"></i>${escapeHtml(ci.label)} · ${escapeHtml(c.ElementType || c.ElementFamily || "")} <em>${escapeHtml(levelOf(g.userData).name)}</em></li>`;
    }

    function elementList(ids, label, cls, limit = 6) {
        if (!ids.length) return "";
        const lines = ids.map(elementLine).filter(Boolean);
        const shown = lines.slice(0, limit).join("");
        const more = lines.length > limit ? `<li class="hmore">+${lines.length - limit}개 더</li>` : "";
        return `<div class="hdet__group"><h4 class="${cls}">${label} ${lines.length}</h4><ul>${shown}${more}</ul></div>`;
    }

    // ── 그리기 ───────────────────────────────────────────────────────────────
    function render() {
        observer?.disconnect();
        if (view === "analysis") {
            root.innerHTML = header(store.pins.length) + `<div class="hanl"></div>`;
            renderAnalysis(root.querySelector(".hanl"), {
                onJump: (index) => { store.setMainIndex?.(index); store.closeHistory(); },
            });
            mountSavedProject();
            return;
        }
        if (!store.pins.length) {
            root.innerHTML = header(0) + `
                <div class="hempty">
                    <div class="empty__icon empty__icon--pin">${icon("pin", 22)}</div>
                    <div class="empty__title">아직 핀이 없어요</div>
                    <p class="empty__text">Revit 리본의 <b>기록 › 핀 찍기</b>로 작업 시점을 남기고,<br>저장한 뒤 <b>전처리</b>를 실행하면 여기에 이력이 그려져요.</p>
                </div>`;
            return;
        }

        const pins = order === "desc" ? [...store.pins].reverse() : [...store.pins];
        const maxEvents = Math.max(1, ...store.pins.map((p) => summarize(p).events));

        const body = pins.map((pin, i) => {
            const s = summarize(pin);
            const f = formatKey(pin.ts);
            const gap = gapRow(s, maxEvents, i, pins.length);
            const card = `
                <article class="hseg" data-pin="${escapeHtml(pin.id)}"${s.recs[0] ? ` data-rec="${escapeHtml(s.recs[0].name)}"` : ""}>
                    <div class="hshot" data-act="shot" data-pin-shot="${escapeHtml(pin.id)}" title="이 시점 보기">
                        <span class="hshot__ph">${icon("box", 20)}</span>
                    </div>
                    <div class="hrail"><span class="hnode"></span></div>
                    <div class="hcard card">
                        <div class="hcard__top">
                            ${pin.stage ? `<span class="tag tag--md tone-pin">${escapeHtml(pin.stage)}</span>` : ""}
                            <time>${f.date} ${f.time.slice(0, 5)}</time>
                            ${pin.author ? `<span class="hcard__author">${escapeHtml(pin.author)}</span>` : ""}
                        </div>
                        <h3 class="hcard__title">${escapeHtml(pin.title)}</h3>
                        ${pin.note ? `<p class="hcard__note">${escapeHtml(pin.note)}</p>` : ""}
                        ${statsHtml(s)}
                        ${modsHtml(s, { limit: 8 })}
                        <div class="hchips">${chipsHtml(s.rows, 8)}</div>
                        ${s.total ? `
                        <details class="hdet disc disc--rule">
                            <summary>${icon("chevronRight", 13)}요소 ${s.total}개 보기</summary>
                            <div class="hdet__body">
                                ${elementList(s.diff.addedIds, "추가", "is-add")}
                                ${elementList(s.diff.deletedIds, "삭제", "is-del")}
                                ${elementList(s.diff.modified.after, "수정", "is-mod")}
                            </div>
                        </details>` : ""}
                        <div class="hacts tone-pin">
                            <button class="btn btn--ghost btn--xs" type="button" data-act="goto">${icon("arrowRight", 13)}이 시점 보기</button>
                            <button class="btn btn--ghost btn--xs" type="button" data-act="compare">${icon("compare", 13)}${s.prev ? "이전 핀과 비교" : "처음과 비교"}</button>
                            <button class="btn btn--ghost btn--xs" type="button" data-act="view">${icon("doc", 13)}입력 · 해석 한 화면</button>
                            ${s.recs[0] ? `<button class="btn btn--ghost btn--xs" type="button" data-act="play">${icon("mic", 13)}녹음 ${s.recs.length}개</button>` : ""}
                        </div>
                        ${aiSectionHtml(pin, s)}
                    </div>
                </article>`;
            return order === "desc" ? card + gap : gap + card;
        }).join("");

        root.innerHTML = header(store.pins.length) + `<div class="hlist">${body}</div>`;
        markCurrent();
        observeShots();
        mountSavedSummaries();
        mountSavedProject();
        stagger(root.querySelectorAll(".hseg"), { step: 22 });
    }

    /**
     * 카드의 AI 해석 칸. 요약이 있으면 관찰 · 영향 · 추론 세 항목과 검산을 펼쳐 두고(aiSummary.mountPinSummary 가 채운다),
     * 없으면 "AI 해석" 버튼 하나. 머리의 [AI 해석] 토글로 모든 카드를 한 번에 접고 편다.
     */
    function aiSectionHtml(pin, s) {
        const saved = getPinSummary(pin.id);
        if (!showAi) return "";
        return `
            <section class="hai-sec" aria-label="AI 해석">
                <div class="hai-sec__head">
                    ${icon("sparkle", 13)}<b>AI 해석</b>
                    <span class="hai-sec__range">${s.prev ? `${escapeHtml(s.prev.title)} → 이 핀` : "처음 → 이 핀"}</span>
                    ${saved ? "" : `<button class="btn btn--soft btn--xs tone-accent" type="button" data-act="ai" title="${s.prev ? "이전 핀과 이 핀 사이의 변화를 AI가 해석해요" : "처음부터 이 핀까지의 변화를 AI가 해석해요"}">${icon("sparkle", 12)}해석 만들기</button>`}
                </div>
                <div class="hai aiblk"${saved ? "" : " hidden"}></div>
            </section>`;
    }

    function header(count) {
        const withAi = store.pins.filter((p) => getPinSummary(p.id)).length;
        return `
            <div class="hhead">
                <div class="hhead__title">${icon("pinSolid", 16)}<b>작업 이력</b><span>${count}개 핀</span></div>
                <div class="seg seg--head" role="tablist" aria-label="보기">
                    <button type="button" role="tab" class="seg__btn${view === "rail" ? " is-on" : ""}" aria-selected="${view === "rail"}" data-act="view" data-view="rail">${icon("pin", 13)}이력</button>
                    <button type="button" role="tab" class="seg__btn${view === "analysis" ? " is-on" : ""}" aria-selected="${view === "analysis"}" data-act="view" data-view="analysis">${icon("chart", 13)}재작업 분석</button>
                </div>
                <div class="hhead__actions">
                    ${view === "rail" ? `
                    <button class="btn btn--ghost btn--xs${showAi ? " is-on" : ""}" type="button" data-act="ai-all" aria-pressed="${showAi}" title="카드마다 AI 해석(관찰 · 영향 · 추론)을 펼쳐 두거나 접어요">${icon("sparkle", 13)}AI 해석${count ? `<em class="hai-n">${withAi}/${count}</em>` : ""}</button>
                    <button class="btn btn--ghost btn--xs" type="button" data-act="order">${icon("layers", 13)}${order === "desc" ? "최신순" : "오래된순"}</button>
                    <button class="btn btn--ghost btn--xs${highlightAdded ? " is-on" : ""}" type="button" data-act="highlight">${icon("focus", 13)}추가 요소 강조</button>
                    <button class="btn btn--ghost btn--xs" type="button" data-act="reshoot">${icon("refresh", 13)}현재 각도로 다시 찍기</button>` : ""}
                    ${LAB ? `<button class="btn btn--primary btn--xs" type="button" data-act="project">${icon("sparkle", 13)}프로젝트 진행 서술</button>` : ""}
                    <div class="hmenu">
                        <button class="btn btn--ghost btn--icon btn--sm" type="button" data-act="menu" title="${LAB ? "브리핑 · 내보내기 · 백업" : "브리핑"}" aria-label="${LAB ? "브리핑 · 내보내기 · 백업" : "브리핑"}">${icon("more", 15)}</button>
                        <div class="hmenu__pop menu" hidden>
                            <button class="menu__item" type="button" data-act="briefing">${icon("clock", 14)}<span>지난번 이후 브리핑</span><em>기준 시점부터 지금까지</em></button>
                            ${LAB ? `
                            <hr class="menu__sep">
                            <button class="menu__item" type="button" data-act="report">${icon("doc", 14)}<span>이력 보고서 (HTML)</span><em>인쇄하면 PDF</em></button>
                            <button class="menu__item" type="button" data-act="ratings">${icon("download", 14)}<span>요약 평가 내보내기 (CSV)</span><em>${escapeHtml(ratingLine())}</em></button>
                            <hr class="menu__sep">
                            <button class="menu__item" type="button" data-act="backup">${icon("download", 14)}<span>백업 (JSON)</span><em>회고 핀 · 요약 · 평가 · 전사</em></button>
                            <button class="menu__item" type="button" data-act="restore">${icon("upload", 14)}<span>백업 복원</span><em>지금 것과 합쳐요</em></button>` : ""}
                        </div>
                    </div>
                    <button class="btn btn--ghost btn--icon btn--sm" type="button" data-act="close" title="닫기" aria-label="닫기">${icon("x", 15)}</button>
                </div>
            </div>
            ${LAB ? `<div class="hproj aiblk"${getProjectSummary() ? "" : " hidden"}></div>` : ""}`;
    }

    function gapRow(s, maxEvents, i, n) {
        const isLast = order === "desc" ? i === n - 1 : i === n - 1;
        if (isLast && order === "asc") return "";
        const weight = Math.min(8, 2 + Math.round((s.events / maxEvents) * 6));
        const bits = [fmtDuration(s.gapMs), `편집 ${s.rework.edits.toLocaleString()}회`];
        if (s.rework.reverted) bits.push(`되돌림 ${s.rework.reverted}`);
        if (s.recs.length) bits.push(`녹음 ${s.recs.length}개`);
        return `
            <div class="hgap">
                <div></div>
                <div class="hgap__rail"><span style="--w:${weight}px"></span></div>
                <div class="hgap__label">${bits.join(" · ")}</div>
            </div>`;
    }

    function markCurrent() {
        if (root.hidden) return;
        let cur = null;
        for (const p of store.pins) if (p.index <= store.mainIndex) cur = p;
        root.querySelectorAll(".hseg").forEach((el) => {
            el.classList.toggle("is-current", cur && el.dataset.pin === cur.id);
        });
    }

    // ── 사진: 같은 각도로 자동 렌더 ───────────────────────────────────────────
    function observeShots() {
        observer?.disconnect();
        observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const host = entry.target;
                observer.unobserve(host);
                requestAnimationFrame(() => paint(host));
            }
        }, { root, rootMargin: "200px 0px" });
        root.querySelectorAll(".hshot").forEach((el) => observer.observe(el));
    }

    function paint(host) {
        const pin = store.pins.find((p) => p.id === host.dataset.pinShot);
        if (!pin || !store.viewer) return;
        let url = shots.get(pin.id);
        if (!url) {
            url = shoot(pin);
            if (!url) return;
            shots.set(pin.id, url);
        }
        host.innerHTML = `<img src="${url}" alt="${escapeHtml(pin.title)} 시점의 모델" loading="lazy">`;
    }

    function reshootFromCurrentView() {
        if (!store.viewer) return;
        const { camera, controls } = store.viewer;
        const v = camera.position.clone().sub(controls.target);
        dir = [v.x, v.y, v.z];
        shots.clear();
        root.querySelectorAll(".hshot").forEach((el) => {
            el.innerHTML = `<span class="hshot__ph">${icon("box", 20)}</span>`;
        });
        observeShots();
    }

    /** 그 시점의 모델을 공통 각도로 한 장. 추가된 요소는 초록으로. */
    function shoot(pin) {
        let tint = null;
        if (highlightAdded) {
            const prev = prevPin(pin);
            const diff = diffBetweenIndexes(prev ? prev.index : 0, pin.index);
            tint = new Map(diff.addedIds.map((id) => [id, ADDED_TINT]));
        }
        return captureViews({ index: pin.index, dirs: [dir], tint, size: SHOT_SIZE })[0] || null;
    }

    function diffBetweenIndexes(fromIndex, toIndex) {
        const A = store.timeLog[store.timeKeys[fromIndex]]?.Elements || [];
        const B = store.timeLog[store.timeKeys[toIndex]]?.Elements || [];
        return diffElementVersionsFromLists(A, B);
    }

    // ── 카드별 AI 요약 ────────────────────────────────────────────────────────
    // 요약은 핀에 저장된다. 저장된 게 있으면 카드를 그릴 때 바로 펼쳐 둔다.
    function openAi(card, pin) {
        const box = card.querySelector(".hai");
        if (!box) return;
        card.querySelector('.hai-sec__head [data-act="ai"]')?.remove();   // 만드는 동안 버튼은 치운다
        box.hidden = false;
        mountPinSummary(box, pin, { onChange: onSummaryChange });
    }

    /** 목록을 다시 그릴 때마다, 저장된 요약을 카드에 붙인다. */
    function mountSavedSummaries() {
        root.querySelectorAll(".hseg[data-pin]").forEach((card) => {
            const pin = store.pins.find((p) => p.id === card.dataset.pin);
            const box = card.querySelector(".hai");
            if (pin && box && getPinSummary(pin.id)) mountPinSummary(box, pin, { onChange: onSummaryChange });
        });
    }

    /** 요약이 새로 생기거나 지워지면 핀 탭도 같이 갱신한다. */
    function onSummaryChange() { emit("pins", store.pins); }

    // ── 프로젝트 전체 서술 ───────────────────────────────────────────────────
    function openProject() {
        const box = root.querySelector(".hproj");
        if (!box) return;
        box.hidden = false;
        mountProjectSummary(box, { onChange: () => { } });
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function mountSavedProject() {
        const box = root.querySelector(".hproj");
        if (box && getProjectSummary()) mountProjectSummary(box, { onChange: () => { } });
    }

    // ── 더보기 메뉴 ─────────────────────────────────────────────────────────
    function toggleMenu() {
        const pop = root.querySelector(".hmenu__pop");
        if (!pop) return;
        pop.hidden = !pop.hidden;
        if (!pop.hidden) {
            const away = (ev) => {
                if (ev.target.closest(".hmenu")) return;
                closeMenu();
                document.removeEventListener("click", away, true);
            };
            setTimeout(() => document.addEventListener("click", away, true), 0);
        }
    }
    function closeMenu() {
        const pop = root.querySelector(".hmenu__pop");
        if (pop) pop.hidden = true;
    }

    // ── 백업 복원 ───────────────────────────────────────────────────────────
    function pickBackup() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const json = await readBackupFile(file);
                const r = restoreBackup(json);
                refreshPins();
                render();
                toast(`복원했어요 — 핀 ${r.pins} · 요약 ${r.summaries} · 평가 ${r.ratings} · 전사 ${r.transcripts}${r.project ? " · 프로젝트 서술" : ""}`);
            } catch (e) {
                toast(e.message || "복원하지 못했어요.");
            }
        };
        input.click();
    }

    // ── 알림 한 줄 ──────────────────────────────────────────────────────────
    function toast(text) {
        let el = root.querySelector(".htoast");
        if (!el) {
            el = document.createElement("div");
            el.className = "htoast";
            root.append(el);
        }
        el.textContent = text;
        el.hidden = false;
        clearTimeout(el.__t);
        el.__t = setTimeout(() => { el.hidden = true; }, 5200);
    }
}
