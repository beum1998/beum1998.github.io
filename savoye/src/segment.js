// ─────────────────────────────────────────────────────────────────────────────
// 구간의 계산 부분 (Segment computation)
//
// Design Commit(핀) 사이 한 구간에 대해 로그에서 규칙으로 계산하는 것을 한곳에 모았다.
// 서술(AI 입력) · 숫자 검사 · 화면이 모두 여기서 낸 분류와 수치를 쓴다 — 같은 낱말은 어디서나 같은 뜻이다.
//
//   구간        (from, to] — from 다음 기록 시점부터 to 까지. 첫 구간은 from = −1 이고 빈 모델에서 시작한다.
//   단계        연속한 두 기록 시점 사이의 변경 하나. 추가 · 삭제 · 수정이고, 수정은 입력 값 변경 / 결과값만 변경 /
//               부수적 갱신으로 나뉜다(changeDiff.stepsAt). 추가 · 삭제 · 입력 값 변경이 "설계자 자신의 단계"다.
//   순 단계     구간 양 끝에 모두 있는 요소의 시작 버전 → 끝 버전 비교. 구간 안에 단계가 하나라도 있으면 넷 중 하나:
//                 수정됨         순 단계가 입력 값 변경
//                 결과값만 변경   순 단계가 결과값만 변경(입력 값을 바꿨다 되돌렸는데 결과값이 달라진 채 남은 경우 포함)
//                 바꿨다 되돌림   순 단계에 차이가 없고, 중간 단계 가운데 자신의 단계가 하나 이상
//                 부수적 갱신     순 단계에 차이가 없고, 자신의 단계가 없음(화면의 "함께 갱신")
//               단계가 없는 요소는 유지이고 세지 않는다.
//   요소 수     추가 · 삭제 · 수정됨만 층 × 카테고리로 센다. 결과값만 변경 · 부수적 갱신은 구간 전체 수로 따로 준다.
//   경로 수치   순변화에는 보이지 않는 과정. 전체 순서에서 센다.
//                 만들고 지움     구간 시작에 없고, 구간 안에서 추가되고, 구간 끝에 없는 요소 (화면: 생성 후 삭제)
//                 바꿨다 되돌림   위의 것 (화면: 변경 후 되돌림)
//                 추가 뒤 고침    구간 시작에 없고 끝에 있으며, 마지막으로 추가된 뒤 입력 값 변경이 있었던 요소
//                                 (화면: 추가 후 다시 수정)
//               셋 다 구간 전체 수와 함께 층 × 카테고리로 나눈 수를 낸다(어디에서 시도했는지). 층 · 카테고리는 변경 순서와
//               같은 읽기 — 저작 도구가 그 요소에 준 레벨이고, 구간 끝에 없는 요소(만들고 지움)는 지워지기 전 마지막 버전의 것.
//   범위 밖     만들고 지운 요소 가운데, 구간 안에 기록된 그 요소의 버전이 한 번도 모델 범위 안에 든 적이 없는 요소는
//               구간의 계산에서 뺀다 — 건물에서 멀리 떨어진 곳에 놓였다가 지워진 것이라 설계 시도로 세지 않는다.
//               범위는 평면에 그릴지 정하는 것과 같은 판정이다(shoot.modelRangeOf: 상자 중심이 모델 구의 중심에서
//               max(반경 × 2, 8) 이내). 한 번이라도 범위 안에 있었으면 남기고, 형상이 없어 판정할 수 없는 버전이
//               하나라도 있으면 남긴다. 뺀 요소는 경로 수치 · 변경 순서의 묶음 · 자신의 단계 수 · 편집 수 어디에도
//               들지 않고, outside 한 칸에 따로 센다(뺀 것 + 남은 것 = 빼기 전). 순변화는 그 요소가 양 끝에 없으므로
//               그대로다. 구간 끝에 남아 있는 먼 요소(순변화의 추가)는 빼지 않는다.
//   변경 순서   설계자 자신의 단계만 담는다. 한 트랜잭션에 나온 (종류 · 층 · 카테고리) 조합의 집합이 그 서명이고,
//               서명이 같은 연속한 트랜잭션을 한 묶음으로 합친다. 자신의 단계가 없는 트랜잭션은 순서에 없다.
//               묶음은 요소가 아니라 단계를 센다 — 벽 12개를 옮겼다 되돌리면 순서에서는 24단계, 요소 수에서는 수정 0.
//               묶음은 줄이지 않고 전부 낸다(아래 changeSequence).
// ─────────────────────────────────────────────────────────────────────────────

import { store, baseId, levelOf, catInfo, formatKey } from "./store.js";
import { analyzeRework, cell } from "./rework.js";
import { stepsAt, diffVersions, changeClass, headline } from "./changeDiff.js";
import { modelRangeOf } from "./shoot.js";

const IDLE_GAP_MS = 10 * 60 * 1000;
/** 단계의 종류 이름(AI 입력 · 숫자 검사 · 화면 공용) */
export const KIND_LABEL = { add: "추가", del: "삭제", mod: "수정" };

/** 순 단계의 경우 → 분류된 차이의 칸 이름 */
const NET_BUCKET = { modified: "modified", derived: "derivedOnly", restored: "restored", incidental: "incidental" };

let owner = null;
const cache = new Map();

/** 이 핀이 덮는 구간(이전 핀 → 이 핀). 첫 핀은 빈 모델(−1)에서 시작한다. */
export function pinRange(pin) {
    let prev = null;
    for (const p of store.pins) if (p.index < pin.index) prev = p;
    return { prev, from: prev ? prev.index : -1, to: pin.index };
}

/** 기록 시점의 요소들(기본 ID → 버전 ID). 0번 앞(−1)은 빈 모델. */
function snapshot(index) {
    const m = new Map();
    if (index < 0) return m;
    for (const id of store.timeLog?.[store.timeKeys[index]]?.Elements || []) m.set(baseId(id), id);
    return m;
}

/** 양 끝에 모두 있는 요소의 순 단계 — 넷 중 하나(단계가 없으면 "unchanged") */
function netCase(beforeId, afterId, steps) {
    if (!steps?.length) return "unchanged";
    const cls = beforeId === afterId ? "incidental" : changeClass(diffVersions(beforeId, afterId));
    if (cls === "input") return "modified";
    if (cls === "derived") return "derived";
    return steps.some((s) => s.own) ? "restored" : "incidental";
}

/**
 * 구간 (from, to] 의 분류와 수치 전부. 같은 구간은 캐시한다(돌려준 것을 고치지 말 것).
 * @returns {{
 *   from: number, to: number,
 *   diff: { addedIds, deletedIds, modified: {before, after}, unchangedIds,
 *           derivedOnly: {before, after}, restored: {before, after}, incidental: {before, after}, classified: true },
 *   counts: { added, deleted, modified, derivedOnly, incidental, unchanged },
 *   path: { createdRemoved, restored, addedRevised },
 *   pathIds: { createdRemoved: string[], restored: string[], addedRevised: string[] },      // 기본 ID
 *   pathVersions: { createdRemoved: string[], restored: string[], addedRevised: string[] }, // 그 요소의 버전 ID
 *                 (만들고 지움은 지워지기 전 마지막 버전, 나머지는 구간 끝의 버전) — 층 · 카테고리를 읽고 평면에 그릴 때 쓴다
 *   pathRows: { lv, cat, createdRemoved, restored, addedRevised }[],   // 경로 수치를 층 × 카테고리로(합 = path)
 *   createdRemovedEdits: number,
 *   own: { total, flagged, unflagged, byKind: { 추가, 삭제, 수정 } },   // 설계자 자신의 단계 수(전파 표시 따로)
 *   notOwn: { derived, incidental },                                    // 자신의 단계가 아닌 단계 수
 *   outside: { elements, steps, otherSteps, add, mod, del, ids: string[], versions: string[] },
 *            // 모델 범위 밖에서 만들고 지운 요소 — 위의 어느 수에도 들지 않는다. steps 는 그 요소의 자신의 단계 수,
 *            // otherSteps 는 자신의 단계가 아닌 단계 수, add · mod · del 은 기록된 추가 · 새 버전 · 삭제 횟수,
 *            // ids 는 기본 ID, versions 는 지워지기 전 마지막 버전
 *   caseOf: Map<string, string>,                                        // 양 끝에 있는 요소의 순 단계 경우
 *   groups: { from, to, steps, flagged, items: { kind, lv, cat, n, flagged, example }[] }[],   // 압축 전 모든 묶음
 * }}
 *   diff 는 script/diffView.js 의 차이와 같은 모양이되, modified 에는 "수정됨"(순 단계가 입력 값 변경)만 담는다.
 */
export function segmentAccount(from, to) {
    const R = analyzeRework();
    if (owner !== R) { cache.clear(); owner = R; }
    const lo = Math.max(-1, Math.min(from, to));
    const hi = Math.min(R.n - 1, Math.max(from, to));
    const key = `${lo}|${hi}`;
    if (cache.has(key)) return cache.get(key);

    const start = snapshot(lo), end = snapshot(hi);

    // ── 요소별 단계 ──
    const byElement = new Map();
    for (let i = lo + 1; i <= hi; i++) {
        for (const s of stepsAt(i)) {
            if (!byElement.has(s.base)) byElement.set(s.base, []);
            byElement.get(s.base).push(s);
        }
    }

    // ── 모델 범위 밖에서 만들고 지운 요소 — 아래의 모든 계산에서 뺀다 ──
    // 만들고 지움의 정의 그대로(시작에 없고, 구간 안에서 추가되고, 끝에 없다) + 구간 안에 기록된 버전이 모두 범위 밖.
    // 판정할 수 없는 버전(형상 없음)이 하나라도 있으면 범위 안에 든 적이 없다고 말할 수 없으므로 남긴다
    const outside = { elements: 0, steps: 0, otherSteps: 0, add: 0, mod: 0, del: 0, ids: [], versions: [] };
    const skipped = new Set();
    for (const [b, steps] of byElement) {
        if (start.has(b) || end.has(b) || !steps.some((s) => s.kind === "add")) continue;
        const recorded = steps.filter((s) => s.id).map((s) => s.id);
        if (!recorded.every((id) => modelRangeOf(id) === false)) continue;
        skipped.add(b);
        outside.elements++;
        outside.ids.push(b);
        outside.versions.push(recorded[recorded.length - 1]);
        for (const s of steps) {
            outside[s.kind]++;
            if (s.own) outside.steps++; else outside.otherSteps++;
        }
    }

    // ── 전체 순서(압축 전): 자신의 단계 수, 순서의 묶음 ──
    const own = { total: 0, flagged: 0, unflagged: 0, byKind: {} };
    for (const k of Object.values(KIND_LABEL)) own.byKind[k] = { n: 0, flagged: 0 };
    const notOwn = { derived: 0, incidental: 0 };
    const groups = [];
    for (let i = lo + 1; i <= hi; i++) {
        const tally = new Map();
        for (const s of stepsAt(i)) {
            if (skipped.has(s.base)) continue;
            if (!s.own) { notOwn[s.cls]++; continue; }

            const kind = KIND_LABEL[s.kind];
            own.total++;
            own.byKind[kind].n++;
            if (s.flagged) { own.flagged++; own.byKind[kind].flagged++; } else own.unflagged++;

            // 층은 저작 도구가 그 요소에 준 레벨(삭제는 지워지기 전 버전의 것)
            const ud = store.meshDict[s.id ?? s.prevId]?.userData;
            const lv = levelOf(ud).name;
            const cat = catInfo(ud?.Common?.ElementCategory).label;
            const tk = `${kind}|${lv}|${cat}`;
            if (!tally.has(tk)) tally.set(tk, { kind, lv, cat, n: 0, flagged: 0, example: null });
            const t = tally.get(tk);
            t.n++;
            if (s.flagged) t.flagged++;
            if (s.kind === "mod" && !t.example) t.example = headline(diffVersions(s.prevId, s.id), 1);
        }
        if (!tally.size) continue;   // 자신의 단계가 없는 트랜잭션은 순서에 없다(범위 밖 요소의 단계뿐인 트랜잭션도)

        const sig = [...tally.keys()].sort().join(",");
        const last = groups[groups.length - 1];
        if (last && last.sig === sig) {
            for (const [tk, t] of tally) {
                const e = last.items.get(tk);
                e.n += t.n;
                e.flagged += t.flagged;
                e.example ||= t.example;
            }
            last.to = i;
        } else {
            groups.push({ sig, from: i, to: i, items: tally });
        }
    }
    for (const g of groups) {
        g.items = [...g.items.values()];
        g.steps = g.items.reduce((n, t) => n + t.n, 0);
        g.flagged = g.items.reduce((n, t) => n + t.flagged, 0);
    }

    // ── 순변화: 추가 · 삭제 · 양 끝에 있는 요소의 네 경우 ──
    const diff = {
        addedIds: [], deletedIds: [], modified: { before: [], after: [] }, unchangedIds: [],
        derivedOnly: { before: [], after: [] }, restored: { before: [], after: [] }, incidental: { before: [], after: [] },
        classified: true,
    };
    const caseOf = new Map();
    for (const [b, beforeId] of start) {
        const afterId = end.get(b);
        if (afterId === undefined) { diff.deletedIds.push(beforeId); continue; }
        const c = netCase(beforeId, afterId, byElement.get(b));
        if (c === "unchanged") { diff.unchangedIds.push(beforeId); continue; }
        caseOf.set(b, c);
        diff[NET_BUCKET[c]].before.push(beforeId);
        diff[NET_BUCKET[c]].after.push(afterId);
    }
    for (const [b, afterId] of end) if (!start.has(b)) diff.addedIds.push(afterId);

    // ── 경로 수치 ──
    const pathIds = { createdRemoved: [], restored: diff.restored.after.map(baseId), addedRevised: [] };
    const pathVersions = { createdRemoved: [], restored: [...diff.restored.after], addedRevised: [] };
    let createdRemovedEdits = 0;
    for (const [b, steps] of byElement) {
        if (start.has(b) || skipped.has(b)) continue;
        if (!end.has(b)) {
            if (!steps.some((s) => s.kind === "add")) continue;
            pathIds.createdRemoved.push(b);
            // 구간 끝에 없으므로 마지막 단계는 삭제다 — 지워지기 전 마지막 버전
            const last = steps[steps.length - 1];
            pathVersions.createdRemoved.push(last.id ?? last.prevId);
            createdRemovedEdits += steps.filter((s) => s.kind !== "del").length;
            continue;
        }
        let lastAdd = -1;
        steps.forEach((s, k) => { if (s.kind === "add") lastAdd = k; });
        if (steps.slice(lastAdd + 1).some((s) => s.cls === "input")) {
            pathIds.addedRevised.push(b);
            pathVersions.addedRevised.push(end.get(b));
        }
    }
    // 층 × 카테고리로 — 변경 순서와 같은 읽기(그 버전에 기록된 레벨 · 카테고리). 많은 칸부터
    const pathCells = new Map();
    for (const field of Object.keys(pathVersions)) {
        for (const id of pathVersions[field]) {
            const ud = store.meshDict[id]?.userData;
            const lv = levelOf(ud).name;
            const cat = catInfo(ud?.Common?.ElementCategory).label;
            const ck = `${lv}|${cat}`;
            if (!pathCells.has(ck)) pathCells.set(ck, { lv, cat, createdRemoved: 0, restored: 0, addedRevised: 0 });
            pathCells.get(ck)[field]++;
        }
    }
    const pathWeight = (r) => r.createdRemoved + r.restored + r.addedRevised;
    const pathRows = [...pathCells.values()].sort((a, b) => pathWeight(b) - pathWeight(a));

    const account = {
        from: lo,
        to: hi,
        diff,
        counts: {
            added: diff.addedIds.length,
            deleted: diff.deletedIds.length,
            modified: diff.modified.after.length,
            derivedOnly: diff.derivedOnly.after.length,
            incidental: diff.incidental.after.length,
            unchanged: diff.unchangedIds.length,
        },
        path: {
            createdRemoved: pathIds.createdRemoved.length,
            restored: pathIds.restored.length,
            addedRevised: pathIds.addedRevised.length,
        },
        pathIds,
        pathVersions,
        pathRows,
        createdRemovedEdits,
        own,
        notOwn,
        outside,
        caseOf,
        groups,
    };
    cache.set(key, account);
    return account;
}

/**
 * 다른 곳에서 만든 차이(분할 비교의 필터가 걸린 차이 등)를 같은 뜻으로 다시 나눈다.
 * from · to 는 그 차이가 비교한 두 기록 시점이다. 이미 분류된 차이는 그대로 돌려준다.
 */
export function classifyDiff(raw, from, to) {
    if (!raw || raw.classified) return raw;
    const { caseOf } = segmentAccount(from, to);
    const out = {
        ...raw,
        modified: { before: [], after: [] }, unchangedIds: [],
        derivedOnly: { before: [], after: [] }, restored: { before: [], after: [] }, incidental: { before: [], after: [] },
        classified: true,
    };
    const put = (beforeId, afterId) => {
        const c = caseOf.get(baseId(afterId));
        if (!c) { out.unchangedIds.push(beforeId); return; }
        out[NET_BUCKET[c]].before.push(beforeId);
        out[NET_BUCKET[c]].after.push(afterId);
    };
    (raw.modified?.after || []).forEach((afterId, i) => put(raw.modified.before[i], afterId));
    (raw.unchangedIds || []).forEach((id) => put(id, id));
    return out;
}

// ── 변경 순서 ────────────────────────────────────────────────────────────────
/**
 * 구간의 변경 순서(AI 입력 · 근거 · Commit 해석 화면 공용). 묶음을 줄이지 않고 전부 낸다.
 *
 * 상한을 두지 않는 까닭(2026-11-17 결정): 예전에는 단계 수가 많은 24묶음만 남겼는데, 24 는 조정해서 정한 값이
 * 아니었고, 긴 구간에서는 순서의 절반이 빠졌다(논문 예시 구간: 137묶음 · 393단계 가운데 187단계만 AI 에 전달).
 * 빠지는 것은 작은 묶음, 곧 한두 요소를 만들었다 지우거나 고쳐 보는 시도여서, 서술이 읽어야 할 과정이 먼저
 * 사라졌다. 전부 보내도 입력은 감당할 크기다 — 그 예시 구간의 순서는 JSON 으로 약 18,400자(24묶음일 때 약 3,800자),
 * 그 구간에 보내는 데이터 전체가 약 22,600자다(데모 로그, 2026-11-19 에 잰 값). 어떤 수를 골라도 근거를 댈 수
 * 없으므로 고르지 않는다. 구간이 훨씬 길어져 모델의 입력 한도에 걸리면 그때 한도를 근거로 다시 정한다.
 *
 * limit 을 주면 단계 수가 많은 limit 개만 원래 순서대로 남기고 빠진 수를 생략한_묶음_수 에 적는다 — 짧게 쓰는
 * "지난번 이후" 브리핑만 이 방식을 쓴다(Commit 해석 · 비교 · 녹음 요약은 쓰지 않는다).
 * @returns {{ 묶음: { 시각, 단계: { 종류, 층, 카테고리, 단계_수, 전파_가능, 예? }[] }[],
 *             생략한_묶음_수: number, 자신의_단계_수: { 전체, 전파_가능, 전파_아님 } }}
 *   단계_수 는 그 조합의 단계 수, 전파_가능 은 그 가운데 "전파되었을 수 있음" 표시가 붙은 단계 수.
 *   자신의_단계_수 는 구간 전체의 값이다(limit 과 상관없다).
 */
export function changeSequence(from, to, limit = Infinity) {
    const acc = segmentAccount(from, to);
    let kept = acc.groups;
    if (kept.length > limit) {
        const big = new Set([...kept].sort((a, b) => b.steps - a.steps).slice(0, limit));   // 같은 수면 앞선 묶음이 남는다
        kept = kept.filter((g) => big.has(g));
    }
    const when = (g) => {
        const a = formatKey(store.timeKeys[g.from]), b = formatKey(store.timeKeys[g.to]);
        if (a.short === b.short) return a.short;
        return a.date === b.date ? `${a.short} ~ ${b.time.slice(0, 5)}` : `${a.short} ~ ${b.short}`;
    };
    return {
        묶음: kept.map((g) => ({
            시각: when(g),
            단계: g.items.map((t) => ({
                종류: t.kind,
                층: t.lv,
                카테고리: t.cat,
                단계_수: t.n,
                전파_가능: t.flagged,
                ...(t.example ? { 예: t.example } : {}),
            })),
        })),
        생략한_묶음_수: acc.groups.length - kept.length,
        자신의_단계_수: { 전체: acc.own.total, 전파_가능: acc.own.flagged, 전파_아님: acc.own.unflagged },
    };
}

/** 순서의 한 조합을 한 줄로 — "03. First Floor 벽 수정 12단계 (전파 가능 3) · 높이 3,000 mm → 3,300 mm" */
export function sequenceLine(item) {
    return `${item.층} ${item.카테고리} ${item.종류} ${item.단계_수}단계`
        + (item.전파_가능 ? ` (전파 가능 ${item.전파_가능})` : "")
        + (item.예 ? ` · ${item.예}` : "");
}

/** 순서의 묶음들(예전에 저장된 모양 포함)을 화면용 { 시각, 줄[] } 로 */
export function sequenceRows(seq) {
    if (Array.isArray(seq?.묶음)) return seq.묶음.map((g) => ({ 시각: g.시각, 줄: g.단계.map(sequenceLine) }));
    return (seq?.단계 || []).map((s) => ({ 시각: s.시각, 줄: s.변경 || [] }));   // 예전 요약의 근거
}

// ── 구간의 편집 흐름 (핀 카드 · 재작업 분석 · CSV) ────────────────────────────
/**
 * 구간 (from, to] 의 기록된 편집 · 경로 수치 · 확정 · 실작업 시간. 첫 구간은 from = −1.
 *   add · mod · del   기록된 추가 · 새 버전 · 삭제 횟수(분류하기 전의 기록 그대로). edits = add + mod
 *                     모델 범위 밖에서 만들고 지운 요소의 것은 뺀다 — edits = keptEdits + revertedEdits 가 닫힌다
 *   outside           그렇게 뺀 요소 수 — outsideEdits 는 그 요소들에 기록된 추가 · 새 버전 횟수,
 *                     outsideEvents 는 삭제까지 더한 횟수. 위의 어느 수에도 들지 않는다(뺀 것 + 남은 것 = 기록 그대로)
 *   reverted          만들고 지운 요소(생성 후 삭제) — revertedEdits 는 그 요소들에 기록된 추가 · 새 버전 횟수
 *   restored          바꿨다 되돌린 요소
 *   addedRevised      추가 뒤 고친 요소
 *   settled           마지막 편집이 이 구간에 있고, 끝까지 그대로 남은 요소
 *   activeMs          구간 안 이벤트 사이 간격 중 10분 미만만 더한 시간(자리 비운 시간 제외).
 *                     시간은 기록 시점의 간격으로 재는 값이라 범위 밖 요소를 빼지 않는다(그 사이에도 설계자는 일했다)
 */
export function segmentRework(from, to) {
    const R = analyzeRework();
    const acc = segmentAccount(from, to);
    const lo = acc.from, hi = acc.to;

    let add = 0, mod = 0, del = 0, activeMs = 0, lastEvent = Math.max(0, lo);
    for (let i = lo + 1; i <= hi; i++) {
        const e = R.addAt[i] + R.modAt[i] + R.delAt[i];
        add += R.addAt[i];
        mod += R.modAt[i];
        del += R.delAt[i];
        if (e > 0) {
            const gap = store.keyMs[i] - store.keyMs[lastEvent];
            if (gap > 0 && gap < IDLE_GAP_MS) activeMs += gap;
            lastEvent = i;
        }
    }

    let settled = 0;
    for (const life of R.lives.values()) {
        if (life.alive && life.lastChange > lo && life.lastChange <= hi) settled++;
    }

    // 모델 범위 밖에서 만들고 지운 요소에 기록된 것은 뺀다(시간은 위에서 기록 그대로 쟀다)
    const out = acc.outside;
    add -= out.add;
    mod -= out.mod;
    del -= out.del;
    const edits = add + mod;
    return {
        add, mod, del,
        events: add + mod + del,
        edits,
        outside: out.elements,
        outsideEdits: out.add + out.mod,
        outsideEvents: out.add + out.mod + out.del,
        reverted: acc.path.createdRemoved,
        revertedEdits: acc.createdRemovedEdits,
        keptEdits: Math.max(0, edits - acc.createdRemovedEdits),
        restored: acc.path.restored,
        addedRevised: acc.path.addedRevised,
        settled,
        activeMs,
        spanMs: (store.keyMs[hi] ?? 0) - (store.keyMs[Math.max(0, lo)] ?? 0),
    };
}

/** 핀 구간별 CSV */
export function segmentsCsv() {
    const head = ["pin_order", "pin_id", "title", "stage", "source", "timestamp", "from_index", "to_index",
        "span_minutes", "active_minutes", "events", "adds", "modifications", "deletions",
        "reverted_elements", "reverted_edits", "settled_elements",
        "restored_elements", "added_then_revised_elements", "own_steps", "possibly_propagated_steps",
        // 모델 범위 밖에서 만들고 지운 요소 — 앞의 어느 열에도 들지 않는다(요소 수 · 추가와 새 버전 횟수 · 자신의 단계 수)
        "outside_created_removed_elements", "outside_edits", "outside_own_steps"];
    const lines = [head.join(",")];
    store.pins.forEach((pin, i) => {
        const { from } = pinRange(pin);
        const s = segmentRework(from, pin.index);
        const acc = segmentAccount(from, pin.index);
        lines.push([
            i + 1, pin.id, pin.title, pin.stage, pin.source, pin.ts, from, pin.index,
            (s.spanMs / 60000).toFixed(1), (s.activeMs / 60000).toFixed(1),
            s.events, s.add, s.mod, s.del, s.reverted, s.revertedEdits, s.settled,
            s.restored, s.addedRevised, acc.own.total, acc.own.flagged,
            s.outside, s.outsideEdits, acc.outside.steps,
        ].map(cell).join(","));
    });
    return lines.join("\r\n");
}
