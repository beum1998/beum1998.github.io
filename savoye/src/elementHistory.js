// ─────────────────────────────────────────────────────────────────────────────
// 요소 이력 (요소 탭의 "변경 이력")
//
// GitHub 의 blame 처럼, 요소 하나가 언제 · 무엇이 · 어떤 핀 구간에서 바뀌었는지를 최신순으로 보여준다.
// 문장이 길어지므로 화면은 다음 규칙을 지킨다.
//
//   · 한 줄에는 "항목 · 이전 → 이후 · 증감" 한두 개만, 나머지는 "외 n" → 펼치면 표
//   · 같은 핀 구간끼리 묶고, 구간 머리에 핀 제목
//   · 기록된 값이 안 바뀐 갱신은 기본으로 한 줄("함께 갱신 n회")로 접는다
//   · 처음엔 최근 6건, 더 보기로 10건씩
// ─────────────────────────────────────────────────────────────────────────────

import { store, formatKey, escapeHtml, onProjectReset } from "./store.js";
import { icon } from "./icons.js";
import { elementHistory, CASCADE_TEXT } from "./changeDiff.js";

const PAGE = 6;
const MORE = 10;

// 요소마다 펼친 줄 · 보이는 개수 · 필터를 기억(탭을 오가도 유지)
const ui = { onlyChanged: true, shown: new Map(), open: new Set() };
onProjectReset(() => { ui.shown.clear(); ui.open.clear(); });

const KIND = {
    add: { label: "생김", cls: "is-add" },
    revive: { label: "되살림", cls: "is-add" },
    del: { label: "삭제", cls: "is-del" },
    mod: { label: "수정", cls: "is-mod" },
};

export function renderElementHistory(host, base) {
    if (!host || base == null) return;
    const { life, entries } = elementHistory(String(base));
    if (!life) {
        host.innerHTML = "";
        return;
    }

    const quietCount = entries.filter((e) => e.kind === "mod" && e.diff?.quiet).length;
    const derivedCount = entries.filter((e) => e.kind === "mod" && e.diff?.derivedOnly).length;
    const modCount = entries.filter((e) => e.kind === "mod" && !e.diff?.quiet && !e.diff?.derivedOnly).length;

    // 최신순 + "함께 갱신" 연속 구간 접기
    const rows = [];
    const newest = [...entries].reverse();
    for (const e of newest) {
        // 값이 안 바뀐 갱신 · 결과값(면적 · 체적)만 바뀐 변경은 연달아 나오면 한 줄로 접는다
        const foldable = e.kind === "mod" && (e.diff?.quiet || e.diff?.derivedOnly);
        if (foldable && ui.onlyChanged) {
            const last = rows[rows.length - 1];
            const kind = e.diff.quiet ? "quiet" : "derived";
            if (last?.type === "fold") {
                last[kind]++; last.indices.push(e.index);
                if (e.cascade) last.reasons.add(e.cascade);
                continue;
            }
            rows.push({ type: "fold", quiet: kind === "quiet" ? 1 : 0, derived: kind === "derived" ? 1 : 0, indices: [e.index], reasons: new Set(e.cascade ? [e.cascade] : []), index: e.index });
            continue;
        }
        rows.push({ type: "entry", entry: e, index: e.index });
    }

    const limit = ui.shown.get(life.base) || PAGE;
    const visible = rows.slice(0, limit);
    const currentIndex = currentEntryIndex(entries);

    let lastPin = undefined;
    const body = visible.map((row) => {
        const pin = segmentPin(row.index);
        const head = pin !== lastPin ? segHeader(pin) : "";
        lastPin = pin;
        return head + (row.type === "fold" ? foldRow(row) : entryRow(row.entry, row.entry.index === currentIndex, life.base));
    }).join("");

    const hidden = rows.length - visible.length;
    host.innerHTML = `
        <header class="ehist__head">
            <h3>${icon("clock", 14)}변경 이력</h3>
            <span class="ehist__sum">값 변경 ${modCount}${derivedCount ? ` · 결과값만 ${derivedCount}` : ""}${quietCount ? ` · 함께 갱신 ${quietCount}` : ""} · ${life.alive ? "끝까지 남음" : "삭제됨"}</span>
            <label class="ehist__filter check" title="기록된 값이 바뀌지 않은 갱신을 한 줄로 접어요">
                <input type="checkbox" data-eh="filter"${ui.onlyChanged ? " checked" : ""}>
                <span>값이 바뀐 것만</span>
            </label>
        </header>
        <ol class="ehist__list">${body}</ol>
        ${hidden > 0 ? `<button class="ehist__older btn btn--sm btn--block" type="button" data-eh="more">${icon("chevronDown", 13)}이전 ${hidden}건 더 보기</button>` : ""}`;

    host.onclick = (e) => {
        const act = e.target.closest("[data-eh]")?.dataset.eh;
        if (act === "more") {
            ui.shown.set(life.base, limit + MORE);
            renderElementHistory(host, base);
        } else if (act === "jump") {
            store.setMainIndex?.(Number(e.target.closest("[data-index]").dataset.index));
        } else if (act === "expand") {
            const key = e.target.closest("[data-index]").dataset.index;
            const id = `${life.base}@${key}`;
            if (ui.open.has(id)) ui.open.delete(id); else ui.open.add(id);
            renderElementHistory(host, base);
        } else if (act === "pin") {
            store.setMainIndex?.(Number(e.target.closest("[data-pin-index]").dataset.pinIndex));
        } else if (act === "rec") {
            const rec = store.recordings.find((r) => r.name === e.target.closest("[data-rec]").dataset.rec);
            if (rec) store.playRecording?.(rec);
        }
    };
    host.onchange = (e) => {
        if (e.target.matches('[data-eh="filter"]')) {
            ui.onlyChanged = e.target.checked;
            renderElementHistory(host, base);
        }
    };

    function entryRow(entry, isCurrent, baseKey) {
        const f = formatKey(entry.key);
        const kind = KIND[entry.kind];
        const open = ui.open.has(`${baseKey}@${entry.index}`);
        const rec = recordingAt(entry.ms);
        const quiet = entry.kind === "mod" && entry.diff?.quiet;
        const items = entry.diff ? (entry.diff.items.length ? entry.diff.items : entry.diff.derived) : [];
        const canExpand = entry.diff && (entry.diff.items.length + entry.diff.derived.length) > 1;
        const derivedOnly = entry.diff?.derivedOnly;

        let text;
        if (entry.kind !== "mod") text = `<span class="ehist__plain">${kind.label}</span>`;
        else if (quiet) text = `<span class="ehist__plain is-muted">${escapeHtml(CASCADE_TEXT[entry.cascade] || CASCADE_TEXT.none)}</span>`;
        else text = items.slice(0, 1).map(changeHtml).join("") + (items.length > 1 ? `<span class="ehist__more">외 ${items.length - 1}</span>` : "");

        return `
            <li class="ehist__row ${kind.cls}${isCurrent ? " is-current" : ""}${quiet || derivedOnly ? " is-quiet" : ""}" data-index="${entry.index}">
                <span class="ehist__dot" aria-hidden="true"></span>
                <div class="ehist__main">
                    <button class="ehist__jump" type="button" data-eh="jump" title="이 시점으로 이동">
                        <span class="ehist__top">
                            <time>${f.date.slice(5)} ${f.time.slice(0, 5)}</time>
                            <span class="ehist__kind">${derivedOnly ? "결과값만" : kind.label}</span>
                            ${isCurrent ? `<span class="ehist__now tag tag--solid tone-accent">지금 보는 시점</span>` : ""}
                        </span>
                        <span class="ehist__text">${text}</span>
                    </button>
                    ${rec ? `<button class="ehist__chip chip chip--sm tone-rec" type="button" data-eh="rec" data-rec="${escapeHtml(rec.name)}" title="이 시각에 녹음 중이었어요">${icon("mic", 12)}${escapeHtml(rec.displayName || "녹음")}</button>` : ""}
                    ${open && entry.diff ? detailHtml(entry.diff) : ""}
                </div>
                ${canExpand ? `<button class="ehist__expand btn btn--ghost btn--icon btn--xs${open ? " is-open" : ""}" type="button" data-eh="expand" aria-expanded="${open}" title="${open ? "접기" : "바뀐 값 모두 보기"}">${icon("chevronDown", 14)}</button>` : ""}
            </li>`;
    }
}

function foldRow(row) {
    const parts = [];
    if (row.derived) parts.push(`결과값(면적 · 체적)만 변경 ${row.derived}회`);
    if (row.quiet) {
        const reason = row.reasons.has("host") ? "호스트 요소 변경 등" : row.reasons.has("co") ? "다른 요소 변경과 함께" : "값 변화 없이";
        parts.push(`함께 갱신 ${row.quiet}회(${reason})`);
    }
    return `
        <li class="ehist__row is-quiet is-folded" data-index="${row.indices[0]}">
            <span class="ehist__dot" aria-hidden="true"></span>
            <div class="ehist__main">
                <span class="ehist__plain is-muted">${parts.join(" · ")}</span>
            </div>
        </li>`;
}

/** "길이 2,805 mm → 6,505 mm (+3,700 mm)" 를 항목 · 이전 → 이후 · 증감 조각으로 */
function changeHtml(item) {
    if (item.before == null || item.after == null) {
        return `<span class="chg"><b class="chg__label">${escapeHtml(item.text)}</b></span>`;
    }
    const delta = item.delta != null && item.delta !== 0
        ? `<i class="chg__d">${item.delta > 0 ? "+" : "−"}${escapeHtml(fmt(Math.abs(item.delta)))}${item.unit ? ` ${escapeHtml(item.unit)}` : ""}</i>`
        : "";
    return `<span class="chg" title="${escapeHtml(item.text)}">
        <b class="chg__label">${escapeHtml(item.label)}</b>
        <span class="chg__before">${escapeHtml(item.before)}</span>
        <span class="chg__arrow" aria-label="에서">→</span>
        <span class="chg__after">${escapeHtml(item.after)}</span>${delta}
    </span>`;
}

function detailHtml(diff) {
    const row = (it) => `
        <tr>
            <th scope="row">${escapeHtml(it.label)}</th>
            <td>${it.before != null ? `<span class="chg__before">${escapeHtml(it.before)}</span> <span class="chg__arrow">→</span> <span class="chg__after">${escapeHtml(it.after)}</span>` : escapeHtml(it.text)}</td>
            <td class="n">${it.delta != null && it.delta !== 0 ? `${it.delta > 0 ? "+" : "−"}${escapeHtml(fmt(Math.abs(it.delta)))}` : ""}</td>
        </tr>`;
    return `
        <table class="ehist__detail">
            <tbody>${diff.items.map(row).join("")}</tbody>
            ${diff.derived.length ? `<tbody class="is-derived"><tr><td colspan="3" class="ehist__sub">결과로 바뀐 값</td></tr>${diff.derived.map(row).join("")}</tbody>` : ""}
        </table>`;
}

const nf = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
function fmt(n) { return nf.format(n); }

/** 이 시점이 속한 핀 구간 = 이 시점 이후 처음 나오는 핀 */
function segmentPin(index) {
    return store.pins.find((p) => p.index >= index) || null;
}

function segHeader(pin) {
    if (!pin) {
        return `<li class="ehist__seg"><span>마지막 핀 이후</span></li>`;
    }
    const order = store.pins.indexOf(pin) + 1;
    return `
        <li class="ehist__seg">
            <button type="button" data-eh="pin" data-pin-index="${pin.index}" title="핀 시점으로 이동">
                <span class="ehist__pinno num-dot">${order}</span><span class="ehist__pintitle">${escapeHtml(pin.title)}</span><em>구간</em>
            </button>
        </li>`;
}

function currentEntryIndex(entries) {
    let hit = null;
    for (const e of entries) if (e.index <= store.mainIndex) hit = e.index;
    return hit;
}

function recordingAt(ms) {
    return store.recordings.find((r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs) && ms >= r.startMs && ms <= r.endMs) || null;
}
