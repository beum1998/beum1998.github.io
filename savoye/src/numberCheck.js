// ─────────────────────────────────────────────────────────────────────────────
// 요약 자동 검산 (Number check)
//
// AI 가 쓴 글 속 숫자를, AI 에게 넘겼던 근거(코드가 계산한 값)와 하나씩 대조한다.
//
// 숫자를 항목에 묶는 길은 둘이다.
//
//   ① 키로 묶는다(먼저)   근거의 숫자 하나하나가 계산 항목이고 키를 가진다 — collectFacts 가 낸 n 번째 사실의 키가 k{n}.
//                        AI 에 보내는 데이터에는 숫자마다 그 키가 붙어 가고("추가":"56[#k3]", keyContext),
//                        답변은 숫자를 쓸 때 그 키를 함께 옮긴다("벽 56[#k3]개"). 검사는 키가 가리키는 항목 하나의
//                        계산값과만 견준다 — 맞으면 일치, 다르면 다름. 낱말을 읽지 않으므로 같은 글이면 늘 같은 판정이다.
//   ② 낱말로 묶는다       키가 없는 숫자(키를 빼먹었거나, 키 기능 전에 만든 요약)와 근거에 없는 키가 붙은 숫자에만 쓴다.
//                        숫자 둘레의 말이 가리키는 항목을 찾는 예전 규칙이다(아래).
//
// 숫자마다 판정은 셋이다 — 일치 · 다름 · 근거에 없음. 일치는 두 가지로 나눠 적는다.
//
//   일치(묶임)   키가 가리키는 항목의 계산값과 맞는다. 또는 숫자 둘레의 말이 항목을 가리키고("벽 추가 12",
//               "생성 후 삭제 55") 그 항목의 계산값과 맞는다
//   값만 일치    항목에 묶이지 않은 숫자인데 근거 어딘가에 같은 값이 있다 — 작은 숫자는 우연히 맞을 수 있어 약한 일치다
//   다름        키가 가리키는 항목의 계산값과 다르다. 또는 말로 항목까지 읽히는데 그 항목의 어느 계산값과도 맞지 않는다
//   근거에 없음  항목에 묶이지 않고, 근거 어디에도 없는 숫자 — AI 가 계산했거나 지어냈을 수 있다
//
// 낱말로 숫자를 묶을 수 있는 항목
//   · 경로 수치      생성 후 삭제 · 변경 후 되돌림 · 추가 후 다시 수정 — 카테고리 · 층이 함께 읽히면 그 칸(과 칸의 합)도 본다
//   · 수정이 아닌 갱신  결과값만 변경 · 함께 갱신
//   · 변경 종류      추가 · 삭제 · 수정 — 숫자에 가장 가까이 적힌 카테고리 · 층으로 좁힌다
// 변경 종류에 묶인 숫자는 그 항목의 계산값 전부와 견준다: 요소 수(층 × 카테고리 칸), 모든 층의 합,
// 변경 순서 묶음의 단계 수. 하나와 맞으면 일치다(순서는 요소가 아니라 단계를 세므로 요소 수와 다를 수 있다).
//
// 날짜 · 시각 · 층 이름("03. First Floor", "2층") · 목록 번호처럼 수치가 아닌 숫자는 건너뛴다.
// 검산은 저장된 요약을 그릴 때마다 다시 하므로, 규칙을 고치면 예전 요약에도 적용된다.
// ─────────────────────────────────────────────────────────────────────────────

import { icon } from "./icons.js";

const KINDS = ["추가", "삭제", "수정"];
// 이름으로 묶이는 항목 — 추가 · 삭제 · 수정 낱말이 들어 있어도 순변화 개수가 아니라
// 구간 안의 과정(구간_내부_과정)이나 수정이 아닌 갱신(수정이_아닌_갱신)을 말하는 경우
const NAMED = [
    { re: /생성\S*\s*(?:후|뒤)\s*삭제|만들\S*\s*지(?:운|웠|움|우)/g, k: "생성_후_삭제된_객체", label: "생성 후 삭제" },
    { re: /(?:변경|수정)\S*\s*(?:후|뒤)\s*(?:다시\s*)?(?:되돌|복원|원래)|바꿨다\S*\s*되돌|되돌(?:린|림|렸|려)|원래대로/g, k: "변경_후_되돌린_객체", label: "변경 후 되돌림" },
    { re: /추가\S*\s*(?:후|뒤)\s*(?:다시\s*)?(?:수정|고)/g, k: "추가_후_다시_수정된_객체", label: "추가 후 다시 수정" },
    { re: /결과\s*값만/g, k: "결과값만_바뀐_요소", label: "결과값만 변경" },
    { re: /함께\s*갱신|부수적\s*갱신/g, k: "함께_갱신된_요소", label: "함께 갱신" },
    // 예전에 저장된 요약의 근거에만 있는 값 — 지금은 보내지 않는다(근거에 이 값이 있을 때만 묶인다)
    { re: /편집/g, k: "그_객체의_편집_수", label: "생성 후 삭제된 객체의 편집" },
];
const NUM = /[+\-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[+\-−]?\d+(?:\.\d+)?/g;
// 수치가 아닌 숫자 덩어리 — 먼저 가린다
const MASKS = [
    /\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/g,          // 2025.06.12
    /\d{1,2}[.\-/]\d{1,2}\s+\d{1,2}:\d{2}/g,      // 06.12 17:44
    /\d{1,2}:\d{2}(?::\d{2})?/g,                  // 17:44(:58)
    /\d{1,2}\s*월\s*\d{1,2}\s*일/g,               // 6월 12일
    /\d+\s*\.\s*[A-Za-z][A-Za-z ]*/g,             // 03. First Floor
    /(?:Level|레벨)\s*\d+/gi,                     // Level 2
    /[A-Za-z_][\w\-]*\d[\w\-.]*/g,                // gpt-5, A1, W200
];
// "24단계"는 변경 순서의 단계 수일 수 있어 건너뛰지 않는다
const SKIP_AFTER = /^\s*(층|번째|차\b|년|월|일|시간|시|분|초|문장|줄|장)/;
const UNIT = /^\s*(mm|cm|m²|m³|㎡|㎥|m2|m3|m|%|°|개|회|건|곳|도)/;

// ── 키 ───────────────────────────────────────────────────────────────────────
// 글 속의 키 표시는 "[#k12]" — 숫자 바로 뒤에 붙는다. 12 는 collectFacts 가 낸 사실의 순서(1부터)다.
const KEY = /[ \t]?\[#k(\d+)\]/g;
const keyTag = (n) => `[#k${n}]`;
/** 숫자와 키 사이에 올 수 있는 글자 수 — "3,000 mm[#k4]" 처럼 단위 뒤에 붙여도 그 숫자의 키로 본다 */
const KEY_REACH = 12;

/** 글에서 키 표시를 지운다(화면 · 보고서 · 평가에 쓰는 글) */
export function stripKeys(text) {
    return String(text ?? "").replace(KEY, "");
}

// ── 근거 → 사실 목록 ─────────────────────────────────────────────────────────
/**
 * 근거 객체(AI 에 넘긴 데이터)를 훑어 숫자 사실로 만든다. 저장해도 작도록 짧은 이름을 쓴다.
 * 변경 순서의 한 조합({ 종류, 층, 카테고리, 단계_수 })은 그 종류의 "단계 수" 사실(s: 1)이 된다.
 * 사실의 순서가 곧 그 사실의 키다 — n 번째(1부터) 사실의 키가 k{n}. 그래서 순서를 바꾸거나 걸러 내지 않는다.
 * @returns {{v:number, k:string, p:string, c?:string, lv?:string, m?:string, s?:1}[]}
 *   값 · 항목 이름 · 경로 · 카테고리 · 층 · 지표나 수정 항목의 이름 · 단계 수 표시
 */
export function collectFacts(context) {
    return scan(context, false).facts;
}

/**
 * AI 에 보낼 데이터 — 근거의 숫자마다 바로 뒤에 그 사실의 키를 붙인 사본을 만든다.
 *   숫자 값      56                → "56[#k3]"
 *   글 속 숫자   "0 mm → 3,000 mm" → "0[#k8] mm → 3,000[#k9] mm"   (사실로 세는 숫자에만 — 날짜 · 층 이름 등은 그대로)
 * facts 는 collectFacts(context) 와 같다(같은 훑기에서 나온다).
 * @returns {{ data: object, facts: object[] }}
 */
export function keyContext(context) {
    return scan(context, true);
}

/**
 * keyContext 가 만든 사본을 숫자 값으로 되돌린다(점검 · 모의 응답용). 키만 붙은 숫자 글은 숫자로, 나머지 글은 키만 지운다.
 * 처음부터 숫자만으로 된 글("200")이었던 값은 숫자가 된다 — 원래 객체와 글자까지 같지는 않다.
 */
export function unkeyContext(data) {
    if (typeof data === "string") {
        const m = /^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\[#k\d+\]$/i.exec(data);
        return m ? Number(m[1]) : stripKeys(data);
    }
    if (Array.isArray(data)) return data.map(unkeyContext);
    if (data && typeof data === "object") return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, unkeyContext(v)]));
    return data;
}

function scan(context, keyed) {
    const facts = [];
    const data = walk(context, "", {});
    return { data, facts };

    // 사실 하나를 더하고 그 키 표시를 돌려준다
    function fact(f) {
        facts.push(f);
        return keyTag(facts.length);
    }
    function number(v, k, p, ctx, step) {
        const tag = fact(step ? { v, k, s: 1, p, ...ctx } : { v, k, p, ...ctx });
        return keyed ? `${v}${tag}` : v;
    }
    function string(text, p, ctx) {
        let out = "", at = 0;
        for (const t of tokens(text)) {
            const tag = fact({ v: t.value, k: "", p, ...ctx });
            if (keyed) { out += text.slice(at, t.end) + tag; at = t.end; }
        }
        return keyed ? out + text.slice(at) : text;
    }

    function walk(node, path, inherited) {
        if (node == null) return node;
        if (Array.isArray(node)) {
            return node.map((x, i) => {
                const p = `${path}[${i}]`;
                if (typeof x === "number" && Number.isFinite(x)) return number(x, "", p, inherited);
                if (typeof x === "string") return string(x, p, inherited);
                return walk(x, p, inherited);
            });
        }
        if (typeof node !== "object") return node;
        const own = { ...inherited };
        if (typeof node.카테고리 === "string") own.c = node.카테고리;
        if (typeof node.층 === "string") own.lv = node.층;
        // 물량의 지표 · 수정 항목의 이름 — 키로 묶인 숫자의 설명에 쓴다
        if (typeof node.지표 === "string") own.m = node.지표;
        else if (typeof node.항목 === "string") own.m = node.항목;
        const stepKind = KINDS.includes(node.종류) ? node.종류 : null;
        const out = {};
        for (const [k, v] of Object.entries(node)) {
            const p = path ? `${path}.${k}` : k;
            if (typeof v === "number" && Number.isFinite(v)) {
                out[k] = stepKind && k === "단계_수" ? number(v, stepKind, p, own, true) : number(v, k, p, own);
            } else if (typeof v === "string") {
                out[k] = /시각|시작|종료|^끝$|이전|현재|제목|이름|메모/.test(k) ? v : string(v, p, own);
            } else {
                out[k] = walk(v, p, own);
            }
        }
        return out;
    }
}

/** 키로 묶인 사실을 사람이 읽을 이름으로 — "층 카테고리별 변화 · First Floor 벽 · 추가" */
function factLabel(f) {
    const parts = f.p.split(".");
    const top = parts[0].replace(/\[\d+\]$/, "").replace(/_/g, " ");
    const leaf = f.s ? `${f.k} 단계 수` : parts[parts.length - 1].replace(/\[\d+\]$/, "").replace(/_/g, " ");
    const where = [f.lv && shortLevel(f.lv), f.c, f.m].filter(Boolean).join(" ");
    return [top, where, leaf !== top ? leaf : ""].filter(Boolean).join(" · ");
}

// ── 글 → 숫자 토큰 ───────────────────────────────────────────────────────────
function tokens(text) {
    let masked = text;
    for (const re of MASKS) masked = masked.replace(re, (m) => " ".repeat(m.length));
    const out = [];
    for (const m of masked.matchAll(NUM)) {
        const start = m.index, end = start + m[0].length;
        const before = masked[start - 1] || "";
        const after = text.slice(end);
        if (/[\w.]/.test(before)) continue;
        if (/^[A-Za-z]/.test(after) && !UNIT.test(after)) continue;   // "3F" 같은 이름
        if (SKIP_AFTER.test(after)) continue;
        if (/^[.)]\s/.test(after) && /(^|\n)\s*$/.test(text.slice(0, start))) continue;   // 목록 번호
        const raw = m[0].replace(/,/g, "").replace("−", "-");
        const value = Math.abs(Number(raw));
        if (!Number.isFinite(value)) continue;
        const dec = (raw.split(".")[1] || "").length;
        out.push({ start, end, value, dec, unit: (after.match(UNIT) || [])[1] || "" });
    }
    return out;
}

// ── 대조 ─────────────────────────────────────────────────────────────────────
function same(a, dec, b) {
    const tol = Math.max(0.5 * 10 ** -dec, Math.abs(b) * 0.001) + 1e-9;
    return Math.abs(a - Math.abs(b)) <= tol;
}

function judge(tok, text, prevEnd, facts, vocab) {
    // 항목(추가 · 삭제 · 수정)은 바로 앞 숫자 뒤에서만, 카테고리 · 층은 조금 더 넓게 가장 가까운 것
    // 줄 · 문장을 넘어 문맥을 가져오지 않는다
    const line = text.lastIndexOf("\n", tok.start - 1) + 1;
    const head = text.slice(line, tok.start);
    const sentence = line + Math.max(0, ...[...head.matchAll(/[.!?;]\s/g)].map((m) => m.index + m[0].length));
    const near = text.slice(Math.max(sentence, prevEnd, tok.start - 40), tok.start);
    const wide = text.slice(Math.max(sentence, tok.start - 60), tok.start);
    const afterText = text.slice(tok.end, tok.end + 8).split(/[\d,.·\n]/)[0];

    // 구간 안의 과정 · 수정이 아닌 갱신을 이름으로 말하면 그 항목과 대조한다(숫자에서 가장 가까운 표현).
    // 뒤쪽은 쉼표 · 가운뎃점에서 끊는다 — "결과값만 변경은 4개, 함께 갱신은 9개"의 4 를 뒤의 이름에 묶지 않게
    const named = namedItem(text.slice(Math.max(sentence, prevEnd, tok.start - 24), tok.start), text.slice(tok.end, tok.end + 18).split(/[.!?;]\s|\n|[,·]/)[0], facts);
    if (named) {
        const f = facts.filter((x) => x.k === named.k);
        const hit = (v) => same(tok.value, tok.dec, v);
        // 구간 전체 수(층 · 카테고리가 없는 값)와 먼저 견준다
        const totals = f.filter((x) => !x.c && !x.lv);
        if (totals.some((x) => hit(x.v))) return { status: "ok", note: `${named.label} — 근거와 일치` };
        // 층 × 카테고리로 나뉜 항목(경로 수치)은, 카테고리 · 층이 함께 읽히면 그 칸과 칸의 합도 본다
        const cat = closest(vocab.cats.map((c) => [c, c]), wide, afterText);
        const lv = closest(vocab.levels.filter((l) => l.short).map((l) => [l.name, l.short]), wide, afterText);
        const cells = cat || lv ? f.filter((x) => (x.c || x.lv) && (cat ? x.c === cat : true) && (lv ? x.lv === lv : true)) : [];
        if (cells.length) {
            const what = [lv && shortLevel(lv), cat, named.label].filter(Boolean).join(" ");
            if (cells.some((x) => hit(x.v))) return { status: "ok", note: `${what} — 근거와 일치` };
            if (hit(cells.reduce((n, x) => n + x.v, 0))) return { status: "ok", note: `${what} — 근거 합계와 일치` };
        }
        const shown = (totals.length ? totals : f).map((x) => x.v);
        return { status: "bad", note: `${named.label} — 근거는 ${shown.join(" · ")}`, expected: shown };
    }

    // "3개 삭제" 처럼 바로 뒤에 붙은 항목이 먼저, 없으면 앞쪽에서 가장 가까운 항목
    let kind = KINDS.find((k) => afterText.includes(k)) || null;
    if (!kind) {
        let at = -1;
        for (const k of KINDS) {
            const i = near.lastIndexOf(k);
            if (i > at) { at = i; kind = k; }
        }
    }
    if (kind) {
        const cat = closest(vocab.cats.map((c) => [c, c]), wide, afterText);
        const lv = closest(vocab.levels.filter((l) => l.short).map((l) => [l.name, l.short]), wide, afterText);
        const match = (f) => f.k === kind && (cat ? f.c === cat : true) && (lv ? f.lv === lv : true);
        // 요소 수: 카테고리 · 층이 없으면 전체 수만 본다. 단계 수: 변경 순서의 조합 가운데 이 항목에 드는 것
        const counts = facts.filter((f) => !f.s && match(f) && (!cat && !lv ? !f.c && !f.lv : true));
        const steps = facts.filter((f) => f.s && match(f));
        const what = [lv && shortLevel(lv), cat, kind].filter(Boolean).join(" ");
        if (counts.length || steps.length) {
            const hit = (v) => same(tok.value, tok.dec, v);
            if (counts.some((f) => hit(f.v))) return { status: "ok", note: `${what} — 근거와 일치` };
            // 여러 층에 걸친 합("벽 추가 12")은 같은 표 안에서만 더한다
            const sums = new Map();
            for (const f of counts) {
                const table = f.p.replace(/\[\d+\][^[]*$/, "");
                sums.set(table, (sums.get(table) || 0) + f.v);
            }
            if ([...sums.values()].some(hit)) return { status: "ok", note: `${what} — 근거 합계와 일치` };
            // 변경 순서는 단계를 센다: 조합 하나의 단계 수, 또는 한 묶음 안에서 이 항목에 드는 단계 수
            if (steps.some((f) => hit(f.v))) return { status: "ok", note: `${what} — 변경 순서의 단계 수와 일치` };
            const perGroup = new Map();
            for (const f of steps) {
                const group = f.p.replace(/\.단계\[\d+\][^[]*$/, "");
                perGroup.set(group, (perGroup.get(group) || 0) + f.v);
            }
            if ([...perGroup.values()].some(hit)) return { status: "ok", note: `${what} — 변경 순서 묶음의 단계 수와 일치` };

            const expected = [...new Set(counts.map((f) => f.v))].slice(0, 3);
            const stepValues = [...new Set(steps.map((f) => f.v))].slice(0, 3);
            const parts = [];
            if (expected.length) parts.push(`근거는 ${expected.join(" · ")}${counts.length > 3 ? " 등" : ""}`);
            if (stepValues.length) parts.push(`변경 순서의 단계 수는 ${stepValues.join(" · ")}${steps.length > 3 ? " 등" : ""}`);
            return { status: "bad", note: `${what} — ${parts.join(", ")}`, expected: expected.length ? expected : stepValues };
        }
    }
    // 항목에 묶이지 않은 숫자는 근거의 모든 값과 견준다 — 맞아도 묶인 일치와 따로 적는다
    if (facts.some((f) => same(tok.value, tok.dec, f.v))) return { status: "any", note: "항목에 묶이지 않은 숫자 — 근거에 같은 값이 있어요(작은 숫자는 우연히 맞을 수 있어요)" };
    return { status: "unv", note: "근거 데이터에 없는 숫자 — 직접 계산했거나 다른 출처일 수 있어요" };
}

/** NAMED 가운데 숫자에 가장 가까운 표현(앞쪽은 끝에서, 뒤쪽은 처음에서 잰 거리). 근거에 그 항목이 있을 때만 */
function namedItem(before, after, facts) {
    let best = null;
    for (const n of NAMED) {
        if (!facts.some((f) => f.k === n.k)) continue;
        for (const m of before.matchAll(n.re)) {
            const d = before.length - (m.index + m[0].length);
            if (!best || d < best.d) best = { ...n, d };
        }
        for (const m of after.matchAll(n.re)) {
            const d = m.index;
            if (!best || d < best.d) best = { ...n, d };
        }
    }
    return best;
}

/** [값, 찾을 글자] 중 숫자에 가장 가까이(앞쪽 끝 · 뒤쪽 처음) 나온 것 */
function closest(pairs, before, after) {
    let best = null, dist = Infinity;
    for (const [value, needle] of pairs) {
        const i = before.lastIndexOf(needle);
        if (i >= 0 && before.length - (i + needle.length) < dist) { dist = before.length - (i + needle.length); best = value; }
        const j = after.indexOf(needle);
        if (j >= 0 && j < dist) { dist = j; best = value; }
    }
    return best;
}

function shortLevel(name) {
    return String(name || "").replace(/^\s*\d+\s*\.\s*/, "");
}

function vocabulary(facts) {
    const cats = [...new Set(facts.map((f) => f.c).filter(Boolean))].sort((a, b) => b.length - a.length);
    const levels = [...new Set(facts.map((f) => f.lv).filter(Boolean))]
        .map((name) => ({ name, short: shortLevel(name) }))
        .sort((a, b) => b.short.length - a.short.length);
    return { cats, levels };
}

/**
 * 정리된(safeHtml 을 거친) 요약 HTML 속 숫자에 표시를 달고 통계를 낸다.
 * 글자는 문단(p · li) 단위로 이어 읽는다 — "<strong>벽</strong> 12개 추가" 처럼 태그를 넘는 문맥도 본다.
 * 글에 키 표시("56[#k3]")가 있으면 그 숫자는 키가 가리키는 사실 하나와만 견주고, 표시는 돌려주는 HTML 에서 지운다.
 * @returns {{ html: string, stats: {ok:number, any:number, unv:number, bad:number, total:number, keyed:number}, items: object[] }}
 *   stats.ok 는 항목에 묶인 일치, stats.any 는 값만 일치(묶이지 않은 숫자의 일치) — 따로 센다
 *   stats.keyed 는 키로 묶은 숫자 수(일치 · 다름에 들어 있다). items[].via 는 "key"(키) 또는 "words"(낱말)
 */
export function checkNumbers(html, facts) {
    const stats = { ok: 0, any: 0, unv: 0, bad: 0, total: 0, keyed: 0 };
    const items = [];
    if (!facts?.length) return { html: stripKeys(html), stats, items };

    const doc = new DOMParser().parseFromString(`<body>${html || ""}</body>`, "text/html");
    const vocab = vocabulary(facts);
    const blocks = [...doc.body.querySelectorAll("p, li")].filter((el) => !el.querySelector("p, li"));
    if (!blocks.length) blocks.push(doc.body);

    for (const block of blocks) {
        const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        const nodes = [];
        let text = "";
        const keys = [];   // { at: 키가 있던 자리(키를 지운 글에서), n: 키 번호 }
        while (walker.nextNode()) {
            const n = walker.currentNode;
            if (n.nodeType === 1) { if (n.tagName === "BR") text += "\n"; continue; }
            // 키 표시는 글에서 지우고 자리만 기억한다 — 아래의 낱말 규칙은 키가 없던 때와 같은 글을 읽는다
            let clean = "", last = 0;
            for (const m of n.nodeValue.matchAll(KEY)) {
                clean += n.nodeValue.slice(last, m.index);
                keys.push({ at: text.length + clean.length, n: Number(m[1]) });
                last = m.index + m[0].length;
            }
            if (last) n.nodeValue = clean + n.nodeValue.slice(last);
            nodes.push({ node: n, start: text.length });
            text += n.nodeValue;
        }
        const toks = tokens(text);
        if (!toks.length) continue;
        // 키는 바로 앞 숫자의 것 — 사이에 다른 숫자가 없고 가까울 때만(숫자 하나에 키 하나, 먼저 붙은 것)
        for (const key of keys) {
            const tok = toks.findLast((t) => t.end <= key.at);
            if (!tok || tok.key || key.at - tok.end > KEY_REACH || /\d/.test(text.slice(tok.end, key.at))) continue;
            tok.key = key.n;
        }
        let prevEnd = 0;
        const marks = toks.map((tok) => {
            const r = judgeKeyed(tok, facts) || { via: "words", ...judge(tok, text, prevEnd, facts, vocab) };
            if (tok.key && r.via === "words") r.note += " (붙어 있던 키는 근거에 없어 낱말로 대조했어요)";
            prevEnd = tok.end;
            stats[r.status]++; stats.total++;
            if (r.via === "key") stats.keyed++;
            items.push({ text: text.slice(tok.start, tok.end), ...r });
            return { ...tok, ...r };
        });
        // 숫자는 한 글자 노드 안에 있다(태그가 숫자를 가르지 않는다) — 노드마다 뒤에서부터 감싼다
        for (const { node, start } of nodes) {
            const end = start + node.nodeValue.length;
            const inside = marks.filter((m) => m.start >= start && m.end <= end).reverse();
            for (const m of inside) {
                const mid = node.splitText(m.start - start);
                mid.splitText(m.end - m.start);
                const span = doc.createElement("span");
                span.className = `nck nck--${m.status}`;
                span.title = m.note;
                mid.replaceWith(span);
                span.append(mid);
            }
        }
    }
    // 숫자가 없는 문단이나 문단 밖에 남은 키 표시까지 지운다
    return { html: stripKeys(doc.body.innerHTML), stats, items };
}

/**
 * 키가 붙은 숫자 — 키가 가리키는 사실 하나의 계산값과만 견준다. 낱말은 읽지 않는다.
 * 키가 없거나 근거에 없는 키면 null(낱말 규칙으로 넘긴다).
 */
function judgeKeyed(tok, facts) {
    const f = tok.key ? facts[tok.key - 1] : null;
    if (!f) return null;
    const what = factLabel(f);
    if (same(tok.value, tok.dec, f.v)) return { status: "ok", via: "key", note: `${what} — 키로 대조해 근거와 일치` };
    return { status: "bad", via: "key", note: `${what} — 키가 가리키는 근거는 ${f.v}`, expected: [f.v] };
}

// ── 화면 조각 ────────────────────────────────────────────────────────────────
/** 요약 아래 한 줄: "숫자 검산 · 일치 12 · 값만 일치 3 · 근거에 없음 1 · 다름 0" + 표시 켜기 */
export function checkBarHtml(stats) {
    if (!stats?.total) return "";
    const state = stats.bad ? "bad" : stats.unv ? "unv" : "ok";
    const label = stats.bad ? "근거와 다른 숫자가 있어요" : stats.unv ? "근거에서 찾지 못한 숫자가 있어요" : "모든 숫자가 근거와 맞아요";
    return `
        <div class="nckbar nckbar--${state}" role="note">
            <span class="nckbar__icon" aria-hidden="true">${icon(state === "ok" ? "check" : "alert", 12)}</span>
            <span class="nckbar__label"><b>숫자 검산</b> ${label}</span>
            <span class="nckbar__counts">
                <span class="nckbar__n tag tag--num tone-add is-ok" title="항목에 묶여 그 계산값과 일치한 숫자 — 답변이 숫자와 함께 낸 키로 묶고, 키가 없으면 둘레의 낱말(변경 종류 · 카테고리 · 층, 구간 안의 과정 등)로 묶어요. 이 요약에서 키로 묶은 숫자는 ${stats.keyed ?? 0}개(일치 · 다름 포함)">일치 ${stats.ok}</span>
                ${stats.any ? `<span class="nckbar__n tag tag--num tone-neutral is-any" title="항목에 묶이지 않은 숫자 — 근거 어딘가에 같은 값이 있어요. 작은 숫자는 우연히 맞을 수 있어요">값만 일치 ${stats.any}</span>` : ""}
                ${stats.unv ? `<span class="nckbar__n tag tag--num tone-mod is-unv" title="근거 데이터에 없는 숫자">근거에 없음 ${stats.unv}</span>` : ""}
                ${stats.bad ? `<span class="nckbar__n tag tag--num tone-del is-bad" title="항목은 같은데 값이 다른 숫자">다름 ${stats.bad}</span>` : ""}
            </span>
            <button class="nckbar__toggle btn btn--xs" type="button" data-nck="toggle" aria-pressed="false">모든 숫자 표시</button>
        </div>`;
}

/** 접힌 미리보기 머리의 작은 표 */
export function checkTagHtml(stats) {
    if (!stats?.total) return "";
    if (stats.bad) return `<span class="aiblk__tag aiblk__tag--nck-bad tag tone-del" title="근거와 다른 숫자 ${stats.bad}개">검산 · 다름 ${stats.bad}</span>`;
    if (stats.unv) return `<span class="aiblk__tag aiblk__tag--nck-unv tag tone-mod" title="근거에서 찾지 못한 숫자 ${stats.unv}개">검산 · 확인 ${stats.unv}</span>`;
    return `<span class="aiblk__tag aiblk__tag--nck-ok tag tone-add" title="숫자 ${stats.ok + (stats.any || 0)}개 모두 근거와 일치 (항목에 묶인 일치 ${stats.ok} · 값만 일치 ${stats.any || 0})">검산 ✓</span>`;
}

/** "모든 숫자 표시" 토글 — 요약 블록 어디에 붙여도 된다(위임) */
export function wireCheckToggle(root) {
    if (!root) return;
    root.classList.remove("nck-all");   // 다시 그리면 버튼도 꺼진 모습으로 돌아온다
    if (root.__nckWired) return;
    root.__nckWired = true;
    root.addEventListener("click", (e) => {
        const btn = e.target.closest('[data-nck="toggle"]');
        if (!btn) return;
        e.stopPropagation();
        const on = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", String(on));
        btn.textContent = on ? "표시 끄기" : "모든 숫자 표시";
        root.classList.toggle("nck-all", on);
    });
}

