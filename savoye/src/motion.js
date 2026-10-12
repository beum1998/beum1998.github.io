// ─────────────────────────────────────────────────────────────────────────────
// 움직임 (Motion)
//
// 펼쳐지고 접히는 것들이 "스윽" 움직이게 하는 공용 레이어.
// 원칙은 셋:
//   · 높이는 0 → 실제 높이로 애니메이션한다(auto 는 애니메이션이 안 되므로 측정해서 쓴다).
//   · 나타날 땐 살짝 아래에서 올라오며 투명도와 스케일이 함께 붙는다(Apple 시트 느낌).
//   · 들어올 땐 천천히 감속(스프링), 나갈 땐 짧고 단호하게.
//
// 접근성: 사용자가 "동작 줄이기"를 켜 두었으면 전부 즉시 전환한다.
// 이미 애니메이션 중인 요소는 현재 높이에서 이어받아, 연타해도 튀지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

/** 들어오는 동작 — 끝에서 부드럽게 붙는 감속 곡선 (Apple 의 시트 전환과 같은 결) */
export const EASE_IN = "cubic-bezier(.32, .72, 0, 1)";
/** 나가는 동작 — 초반에 빠르게 빠진다 */
export const EASE_OUT = "cubic-bezier(.4, 0, .2, 1)";
/** 살짝 튕기는 스프링 — 버튼 · 칩처럼 작은 것에만 */
export const SPRING = "cubic-bezier(.34, 1.4, .64, 1)";

export const D_IN = 420;
export const D_OUT = 260;

export function reduced() {
    // 안 보이는 탭에서는 애니메이션이 진행되지 않는다(높이가 0 인 채로 멈춘다) — 그럴 땐 즉시 전환.
    if (document.hidden) return true;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** 진행 중인 높이 애니메이션을 정리하고 현재 높이를 돌려준다. */
function takeOver(el) {
    const running = el.getAnimations?.() || [];
    let h = null;
    for (const a of running) {
        if (a.id !== "abl-reveal") continue;
        h = el.getBoundingClientRect().height;
        a.cancel();
    }
    return h;
}

/**
 * 펼치기 — 숨어 있던 요소를 높이 0에서 내용 높이까지 밀어 올린다.
 * 끝나면 높이를 풀어 주므로(auto) 안에서 내용이 바뀌어도 잘리지 않는다.
 */
export function expand(el, { duration = D_IN, fade = true } = {}) {
    if (!el) return Promise.resolve();
    el.hidden = false;
    el.style.removeProperty("display");
    if (reduced()) { clear(el); return Promise.resolve(); }

    const from = takeOver(el) ?? 0;
    clear(el);
    const to = el.getBoundingClientRect().height;
    if (to <= 0) return Promise.resolve();

    const anim = el.animate(
        [
            { height: from + "px", opacity: fade ? 0 : 1, transform: "translateY(-4px) scale(.995)" },
            { height: to + "px", opacity: 1, transform: "none" },
        ],
        { duration, easing: EASE_IN, fill: "backwards" },
    );
    anim.id = "abl-reveal";
    el.style.overflow = "hidden";
    return anim.finished.catch(() => { }).then(() => { el.style.removeProperty("overflow"); });
}

/** 접기 — 현재 높이에서 0까지 닫고, 끝나면 hidden 으로 되돌린다. */
export function collapse(el, { duration = D_OUT, hide = true } = {}) {
    if (!el || el.hidden) return Promise.resolve();
    if (reduced()) { if (hide) el.hidden = true; return Promise.resolve(); }

    const from = takeOver(el) ?? el.getBoundingClientRect().height;
    const anim = el.animate(
        [
            { height: from + "px", opacity: 1, transform: "none" },
            { height: "0px", opacity: 0, transform: "translateY(-4px)" },
        ],
        { duration, easing: EASE_OUT, fill: "forwards" },
    );
    anim.id = "abl-reveal";
    el.style.overflow = "hidden";
    return anim.finished.catch(() => { }).then(() => {
        anim.cancel();
        el.style.removeProperty("overflow");
        if (hide) el.hidden = true;
    });
}

export function toggleReveal(el, show) {
    return show ? expand(el) : collapse(el);
}

function clear(el) {
    el.style.removeProperty("height");
    el.style.removeProperty("opacity");
    el.style.removeProperty("transform");
    el.style.removeProperty("overflow");
}

/**
 * 내용이 바뀌는 자리를 매끄럽게 이어 준다 — 바뀌기 전 높이를 재고,
 * 바꾼 뒤 새 높이로 흐르게 한다(로딩 → 결과처럼 높이가 크게 뛰는 곳에 쓴다).
 */
export function morph(el, mutate) {
    if (!el || reduced()) { mutate(); return Promise.resolve(); }
    const from = el.getBoundingClientRect().height;
    takeOver(el);
    mutate();
    clear(el);
    const to = el.getBoundingClientRect().height;
    if (Math.abs(to - from) < 1) return Promise.resolve();

    const anim = el.animate(
        [{ height: from + "px" }, { height: to + "px" }],
        { duration: D_IN, easing: EASE_IN },
    );
    anim.id = "abl-reveal";
    el.style.overflow = "hidden";
    return anim.finished.catch(() => { }).then(() => el.style.removeProperty("overflow"));
}

/** 새로 그려진 목록이 아래에서 차례로 떠오르게 한다(계단식). */
export function stagger(items, { step = 26, distance = 10, duration = 380 } = {}) {
    if (reduced()) return;
    [...items].slice(0, 14).forEach((el, i) => {
        el.animate(
            [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: "none" }],
            { duration, delay: i * step, easing: EASE_IN, fill: "backwards" },
        );
    });
}

/** 탭 내용이 바뀔 때의 짧은 크로스페이드 */
export function swapIn(el, { distance = 8, duration = 320 } = {}) {
    if (!el || reduced()) return;
    el.animate(
        [{ opacity: 0, transform: `translateY(${distance}px) scale(.995)` }, { opacity: 1, transform: "none" }],
        { duration, easing: EASE_IN },
    );
}

/**
 * <details> 를 손으로 열고 닫는다.
 * 브라우저 기본 동작은 즉시 열림이라, 열 때는 그대로 두고 높이만 애니메이션하고,
 * 닫을 때는 애니메이션이 끝난 뒤에 open 을 끈다.
 */
export function initDetailsMotion(scope = document) {
    if (scope.__ablDetailsMotion) return;
    scope.__ablDetailsMotion = true;

    scope.addEventListener("click", (e) => {
        const summary = e.target.closest("summary");
        const det = summary?.parentElement;
        if (!det || det.tagName !== "DETAILS" || reduced()) return;
        if (!scope.contains(det) || det.closest(".cmp-scope")) return;

        const body = bodyOf(det);
        if (!body) return;
        e.preventDefault();

        if (det.open) {
            collapse(body, { hide: false }).then(() => {
                det.open = false;
                body.style.removeProperty("height");
                body.style.removeProperty("opacity");
                body.style.removeProperty("transform");
            });
        } else {
            det.open = true;
            expand(body);
        }
    });

    /** summary 를 뺀 나머지를 감싸는 한 덩어리. 없으면 만들어 준다. */
    function bodyOf(det) {
        let wrap = det.querySelector(":scope > .det-body");
        if (wrap) return wrap;
        const rest = [...det.childNodes].filter((n) => !(n.nodeType === 1 && n.tagName === "SUMMARY"));
        if (!rest.length) return null;
        wrap = document.createElement("div");
        wrap.className = "det-body";
        det.append(wrap);
        wrap.append(...rest);
        return wrap;
    }
}
