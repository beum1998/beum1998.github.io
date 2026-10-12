// ─────────────────────────────────────────────────────────────────────────────
// 요약 자동 검산 (Number check)
//
// AI 가 쓴 글 속 숫자를, AI 에게 넘겼던 근거(코드가 계산한 값)와 하나씩 대조한다.
//
//   일치        근거에 같은 값이 있다 ("벽 추가 12" 처럼 항목까지 묶이면 그 항목의 값과)
//   근거에 없음  어디에도 없는 숫자 — AI 가 계산했거나 지어냈을 수 있다
//   다름        항목(추가 · 삭제 · 수정 + 카테고리 · 층)까지 읽히는데 값이 다르다
//
// 날짜 · 시각 · 층 이름("03. First Floor", "2층") · 목록 번호처럼 수치가 아닌 숫자는 건너뛴다.
// 검산은 저장된 요약을 그릴 때마다 다시 하므로, 규칙을 고치면 예전 요약에도 적용된다.
// ─────────────────────────────────────────────────────────────────────────────

import { icon } from "./icons.js";

const KINDS = ["추가", "삭제", "수정"];
// 이름으로 묶이는 항목 — "55개가 생성된 뒤 삭제", "편집 130회", "49개는 추가 후 다시 수정" 처럼
// 추가 · 삭제 · 수정 낱말이 들어 있어도 순변화 개수가 아니라 구간 안의 과정(구간_내부_과정)을 말하는 경우
const NAMED = [
    { re: /생성\S*\s*(?:후|뒤)\s*삭제|만들었다\s*지운|되돌린/g, k: "생성_후_삭제된_객체", label: "생성 후 삭제" },
    { re: /편집/g, k: "그_객체의_편집_수", label: "생성 후 삭제된 객체의 편집" },
    { re: /추가\S*\s*(?:후|뒤)\s*(?:다시\s*)?(?:수정|고)/g, k: "추가_후_다시_수정된_객체", label: "추가 후 다시 수정" },
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
const SKIP_AFTER = /^\s*(층|번째|차\b|년|월|일|시간|시|분|초|문장|줄|단계|장)/;
const UNIT = /^\s*(mm|cm|m²|m³|㎡|㎥|m2|m3|m|%|°|개|회|건|곳|도)/;

// ── 근거 → 사실 목록 ─────────────────────────────────────────────────────────
/**
 * 근거 객체(AI 에 넘긴 데이터)를 훑어 숫자 사실로 만든다. 저장해도 작도록 짧은 키를 쓴다.
 * @returns {{v:number, k:string, p:string, c?:string, lv?:string}[]}  값 · 키 · 경로 · 카테고리 · 층
 */
export function collectFacts(context) {
    const facts = [];
    walk(context, "", {});
    return facts;

    function walk(node, path, inherited) {
        if (node == null) return;
        if (Array.isArray(node)) {
            node.forEach((x, i) => {
                const p = `${path}[${i}]`;
                if (typeof x === "number" && Number.isFinite(x)) facts.push({ v: x, k: "", p, ...inherited });
                else if (typeof x === "string") for (const t of tokens(x)) facts.push({ v: t.value, k: "", p, ...inherited });
                else walk(x, p, inherited);
            });
            return;
        }
        if (typeof node !== "object") return;
        const own = { ...inherited };
        if (typeof node.카테고리 === "string") own.c = node.카테고리;
        if (typeof node.층 === "string") own.lv = node.층;
        for (const [k, v] of Object.entries(node)) {
            const p = path ? `${path}.${k}` : k;
            if (typeof v === "number" && Number.isFinite(v)) {
                facts.push({ v, k, p, ...own });
            } else if (typeof v === "string") {
                if (/시각|시작|종료|^끝$|이전|현재|제목|이름|메모/.test(k)) continue;
                for (const t of tokens(v)) facts.push({ v: t.value, k: "", p, ...own });
            } else {
                walk(v, p, own);
            }
        }
    }
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

    // 구간 안의 과정을 이름으로 말하면 그 항목과 대조한다(숫자에서 가장 가까운 표현)
    const named = namedItem(text.slice(Math.max(sentence, prevEnd, tok.start - 24), tok.start), text.slice(tok.end, tok.end + 18).split(/[.!?;]\s|\n/)[0], facts);
    if (named) {
        const f = facts.filter((x) => x.k === named.k);
        if (f.some((x) => same(tok.value, tok.dec, x.v))) return { status: "ok", note: `${named.label} — 근거와 일치` };
        return { status: "bad", note: `${named.label} — 근거는 ${f.map((x) => x.v).join(" · ")}`, expected: f.map((x) => x.v) };
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
        const cands = facts.filter((f) => f.k === kind
            && (cat ? f.c === cat : true)
            && (lv ? f.lv === lv : true)
            && (!cat && !lv ? !f.c && !f.lv : true));
        const what = [lv && shortLevel(lv), cat, kind].filter(Boolean).join(" ");
        if (cands.length) {
            if (cands.some((f) => same(tok.value, tok.dec, f.v))) return { status: "ok", note: `${what} — 근거와 일치` };
            // 여러 층에 걸친 합("벽 추가 12")은 같은 표 안에서만 더한다
            const sums = new Map();
            for (const f of cands) {
                const table = f.p.replace(/\[\d+\][^[]*$/, "");
                sums.set(table, (sums.get(table) || 0) + f.v);
            }
            if ([...sums.values()].some((sum) => same(tok.value, tok.dec, sum))) return { status: "ok", note: `${what} — 근거 합계와 일치` };
            const expected = [...new Set(cands.map((f) => f.v))].slice(0, 3);
            return { status: "bad", note: `${what} — 근거는 ${expected.join(" · ")}${cands.length > 3 ? " 등" : ""}`, expected };
        }
    }
    if (facts.some((f) => same(tok.value, tok.dec, f.v))) return { status: "ok", note: "근거에 있는 값" };
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
 * @returns {{ html: string, stats: {ok:number, unv:number, bad:number, total:number}, items: object[] }}
 */
export function checkNumbers(html, facts) {
    const stats = { ok: 0, unv: 0, bad: 0, total: 0 };
    const items = [];
    if (!facts?.length) return { html, stats, items };

    const doc = new DOMParser().parseFromString(`<body>${html || ""}</body>`, "text/html");
    const vocab = vocabulary(facts);
    const blocks = [...doc.body.querySelectorAll("p, li")].filter((el) => !el.querySelector("p, li"));
    if (!blocks.length) blocks.push(doc.body);

    for (const block of blocks) {
        const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        const nodes = [];
        let text = "";
        while (walker.nextNode()) {
            const n = walker.currentNode;
            if (n.nodeType === 1) { if (n.tagName === "BR") text += "\n"; continue; }
            nodes.push({ node: n, start: text.length });
            text += n.nodeValue;
        }
        const toks = tokens(text);
        if (!toks.length) continue;
        let prevEnd = 0;
        const marks = toks.map((tok) => {
            const r = judge(tok, text, prevEnd, facts, vocab);
            prevEnd = tok.end;
            stats[r.status]++; stats.total++;
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
    return { html: doc.body.innerHTML, stats, items };
}

// ── 화면 조각 ────────────────────────────────────────────────────────────────
/** 요약 아래 한 줄: "숫자 검산 · 일치 12 · 근거에 없음 1 · 다름 0" + 표시 켜기 */
export function checkBarHtml(stats) {
    if (!stats?.total) return "";
    const state = stats.bad ? "bad" : stats.unv ? "unv" : "ok";
    const label = stats.bad ? "근거와 다른 숫자가 있어요" : stats.unv ? "근거에서 찾지 못한 숫자가 있어요" : "모든 숫자가 근거와 맞아요";
    return `
        <div class="nckbar nckbar--${state}" role="note">
            <span class="nckbar__icon" aria-hidden="true">${icon(state === "ok" ? "check" : "alert", 12)}</span>
            <span class="nckbar__label"><b>숫자 검산</b> ${label}</span>
            <span class="nckbar__counts">
                <span class="nckbar__n tag tag--num tone-add is-ok" title="근거와 일치">일치 ${stats.ok}</span>
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
    return `<span class="aiblk__tag aiblk__tag--nck-ok tag tone-add" title="숫자 ${stats.ok}개 모두 근거와 일치">검산 ✓</span>`;
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

