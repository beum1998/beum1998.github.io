// ─────────────────────────────────────────────────────────────────────────────
// 재작업 분석 (Rework analysis)
//
// 스냅샷(시점)마다 모델에 있던 요소 목록(ID_버전)을 앞에서부터 훑어,
// 요소 하나하나의 "수명"을 복원한다 — 언제 생겼고, 몇 번 고쳐졌고, 결국 남았는지.
//
// 이벤트 (연속한 두 스냅샷 비교)
//   추가  이전에 없던 요소가 생김
//   수정  같은 요소의 버전이 바뀜
//   삭제  있던 요소가 사라짐
//
// 지표 (논문에 그대로 쓰는 정의)
//   폐기율          끝까지 남지 못한 요소 / 한 번이라도 생긴 요소
//   헛수고 편집 비율 끝까지 남지 못한 요소에 들어간 편집(추가+수정) / 전체 편집(추가+수정)
//   요소당 평균 수정 끝까지 남은 요소의 수정 횟수 합 / 남은 요소 수
//   되살린 요소      지워졌다가 다시 나타난 요소
//   단명 요소        생긴 지 10분 안에 사라지고 다시 안 돌아온 요소
//
// 구간(핀과 핀 사이) 지표
//   되돌림  구간 안에서 편집했는데 구간 끝(핀 시점)에는 없는 요소
//   확정    마지막 편집이 이 구간에 있고, 끝까지 그대로 남은 요소
//   실작업  구간 안 이벤트 사이 간격 중 10분 미만만 더한 시간(자리 비운 시간 제외)
//
// 숫자는 전부 여기서 계산한다. 화면 · 보고서 · AI 는 이 값을 인용만 한다.
// ─────────────────────────────────────────────────────────────────────────────

import { store, baseId, levelOf, catInfo, onProjectReset } from "./store.js";

const SHORT_LIVED_MS = 10 * 60 * 1000;
const IDLE_GAP_MS = 10 * 60 * 1000;

let cache = null;
onProjectReset(() => { cache = null; });

/** 전체 이력을 한 번 훑어 요소별 수명과 전역 지표를 만든다(데이터가 같으면 캐시). */
export function analyzeRework() {
    const keys = store.timeKeys;
    if (cache && cache.keys === keys && cache.n === keys.length) return cache.result;

    const n = keys.length;
    const addAt = new Uint32Array(n);
    const modAt = new Uint32Array(n);
    const delAt = new Uint32Array(n);
    const lives = new Map();       // base → life
    let prev = new Map();          // base → versioned id

    for (let i = 0; i < n; i++) {
        const cur = new Map();
        for (const id of store.timeLog[keys[i]]?.Elements || []) cur.set(baseId(id), id);

        for (const [b, id] of cur) {
            const before = prev.get(b);
            let life = lives.get(b);
            if (before === undefined) {
                if (!life) {
                    life = { base: b, spans: [], changes: [], mods: 0, lastId: id, firstIdx: i, lastChange: i, alive: false };
                    lives.set(b, life);
                }
                life.spans.push([i, n - 1]);
                life.changes.push(i);
                life.lastChange = i;
                life.lastId = id;
                addAt[i]++;
            } else if (before !== id) {
                life.changes.push(i);
                life.mods++;
                life.lastChange = i;
                life.lastId = id;
                modAt[i]++;
            }
        }
        for (const b of prev.keys()) {
            if (cur.has(b)) continue;
            const life = lives.get(b);
            const span = life.spans[life.spans.length - 1];
            span[1] = i - 1;
            delAt[i]++;
        }
        prev = cur;
    }

    // 요소 정보 + 운명
    const lastKeyMs = store.keyMs[n - 1];
    const totals = {
        created: lives.size, final: 0, discarded: 0, revived: 0, shortLived: 0,
        edits: 0, wastedEdits: 0, modsAlive: 0,
    };
    for (const life of lives.values()) {
        const lastSpan = life.spans[life.spans.length - 1];
        life.alive = lastSpan[1] === n - 1 && prev.has(life.base);
        life.lastIdx = lastSpan[1];
        life.edits = life.changes.length;
        life.info = elementInfo(life.lastId);

        totals.edits += life.edits;
        if (life.spans.length > 1) totals.revived++;
        if (life.alive) {
            totals.final++;
            totals.modsAlive += life.mods;
        } else {
            totals.discarded++;
            totals.wastedEdits += life.edits;
            const lived = (store.keyMs[life.lastIdx] ?? lastKeyMs) - store.keyMs[lastSpan[0]];
            if (lived < SHORT_LIVED_MS) totals.shortLived++;
        }
    }
    totals.discardRate = ratio(totals.discarded, totals.created);
    totals.wastedRatio = ratio(totals.wastedEdits, totals.edits);
    totals.meanModsAlive = totals.final ? totals.modsAlive / totals.final : 0;

    const result = {
        n,
        lives,
        addAt, modAt, delAt,
        totals,
        byLevelCat: groupByLevelCat(lives),
        topRevised: [...lives.values()].sort((a, b) => b.mods - a.mods || b.edits - a.edits).slice(0, 12),
    };
    cache = { keys, n, result };
    return result;
}

/** 핀과 핀 사이(from, to] 구간의 편집 · 되돌림 · 확정 · 실작업 시간 */
export function segmentRework(from, to) {
    const R = analyzeRework();
    const lo = Math.max(0, from);
    const hi = Math.min(R.n - 1, to);

    let add = 0, mod = 0, del = 0, activeMs = 0, lastEvent = lo;
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
    // 첫 구간은 0번 스냅샷의 추가도 포함한다
    if (lo === 0 && from <= 0) add += R.addAt[0];

    const present = new Set((store.timeLog[store.timeKeys[hi]]?.Elements || []).map(baseId));
    let reverted = 0, revertedEdits = 0, settled = 0;
    for (const life of R.lives.values()) {
        let inRange = 0;
        for (const i of life.changes) if (i > from && i <= hi) inRange++;
        if (from <= 0) for (const i of life.changes) if (i === 0) inRange++;
        if (inRange && !present.has(life.base)) { reverted++; revertedEdits += inRange; }
        if (life.alive && life.lastChange <= hi && (life.lastChange > from || (from <= 0 && life.lastChange === 0))) settled++;
    }

    const edits = add + mod;
    return {
        add, mod, del,
        events: add + mod + del,
        edits,
        reverted,
        revertedEdits,
        keptEdits: Math.max(0, edits - revertedEdits),
        settled,
        activeMs,
        spanMs: (store.keyMs[hi] ?? 0) - (store.keyMs[lo] ?? 0),
    };
}

/** 요소 하나의 수명 (요소 수명선 · 툴팁 · CSV) */
export function lifeOf(base) {
    return analyzeRework().lives.get(String(base)) || null;
}

function elementInfo(id) {
    const ud = store.meshDict[id]?.userData;
    const c = ud?.Common || {};
    const lv = levelOf(ud);
    const ci = catInfo(c.ElementCategory);
    return {
        level: lv,
        cat: c.ElementCategory || "기타",
        catLabel: ci.label,
        catOrder: ci.order ?? 999,
        family: c.ElementFamily || "",
        type: c.ElementType || "",
    };
}

function groupByLevelCat(lives) {
    const rows = new Map();
    for (const life of lives.values()) {
        const { level, cat, catLabel, catOrder } = life.info;
        const key = `${level.key}|${cat}`;
        if (!rows.has(key)) {
            rows.set(key, { level, cat, catLabel, catOrder, created: 0, final: 0, discarded: 0, edits: 0, wastedEdits: 0, mods: 0 });
        }
        const r = rows.get(key);
        r.created++;
        r.edits += life.edits;
        r.mods += life.mods;
        if (life.alive) r.final++;
        else { r.discarded++; r.wastedEdits += life.edits; }
    }
    const levelOrder = new Map(store.levels.map((lv, i) => [lv.key, i]));
    return [...rows.values()]
        .map((r) => ({ ...r, discardRate: ratio(r.discarded, r.created), wastedRatio: ratio(r.wastedEdits, r.edits) }))
        .sort((a, b) => {
            const la = levelOrder.get(a.level.key) ?? 99;
            const lb = levelOrder.get(b.level.key) ?? 99;
            if (la !== lb) return lb - la;       // 위층 먼저 (이력 화면과 같은 순서)
            return a.catOrder - b.catOrder;
        });
}

function ratio(a, b) { return b ? a / b : 0; }

/** 요소별 CSV — 논문 분석용 원자료 */
export function elementsCsv() {
    const R = analyzeRework();
    const head = ["element_id", "category", "family", "type", "level", "first_seen", "last_seen", "alive_at_end",
        "spans", "edits", "modifications", "short_lived"];
    const lines = [head.join(",")];
    const sorted = [...R.lives.values()].sort((a, b) => a.firstIdx - b.firstIdx);
    for (const life of sorted) {
        const first = store.timeKeys[life.firstIdx];
        const last = store.timeKeys[life.lastIdx];
        const lived = store.keyMs[life.lastIdx] - store.keyMs[life.firstIdx];
        lines.push([
            life.base, life.info.catLabel, life.info.family, life.info.type, life.info.level.name,
            first, last, life.alive ? 1 : 0, life.spans.length, life.edits, life.mods,
            !life.alive && lived < SHORT_LIVED_MS ? 1 : 0,
        ].map(cell).join(","));
    }
    return lines.join("\r\n");
}

/** 핀 구간별 CSV */
export function segmentsCsv() {
    const head = ["pin_order", "pin_id", "title", "stage", "source", "timestamp", "from_index", "to_index",
        "span_minutes", "active_minutes", "events", "adds", "modifications", "deletions",
        "reverted_elements", "reverted_edits", "settled_elements"];
    const lines = [head.join(",")];
    store.pins.forEach((pin, i) => {
        const from = i > 0 ? store.pins[i - 1].index : 0;
        const s = segmentRework(from, pin.index);
        lines.push([
            i + 1, pin.id, pin.title, pin.stage, pin.source, pin.ts, from, pin.index,
            (s.spanMs / 60000).toFixed(1), (s.activeMs / 60000).toFixed(1),
            s.events, s.add, s.mod, s.del, s.reverted, s.revertedEdits, s.settled,
        ].map(cell).join(","));
    });
    return lines.join("\r\n");
}

function cell(v) {
    const s = v === undefined || v === null ? "" : String(v).replace(/\r?\n/g, " ");
    return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
