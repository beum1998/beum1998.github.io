// ─────────────────────────────────────────────────────────────────────────────
// AI 요약 HTML 정리 (Sanitize)
//
// AI 가 돌려준 글은 renderMarkdown 에서 이스케이프되지만, 저장된 요약은
// 브라우저 저장소나 백업 파일(JSON)에서 다시 읽혀 화면에 들어간다.
// 그 경로로 누군가 만든 HTML(<img onerror> 등)이 섞여 들어와도 실행되지 않도록,
// 화면에 넣기 직전에 "굵게 · 줄바꿈 · 문단 · 목록"만 남기고 모두 걷어낸다.
//
// 파싱은 실행되지 않는 문서(DOMParser)에서 한다 — 일반 div 에 innerHTML 을 넣으면
// 이미지가 로드되며 onerror 가 실행될 수 있기 때문이다.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED = new Set(["STRONG", "B", "EM", "I", "BR", "P", "UL", "OL", "LI"]);

function parse(html) {
    return new DOMParser().parseFromString(`<body>${html ?? ""}</body>`, "text/html").body;
}

/** 허용한 태그만 남기고, 속성은 전부 지운다. */
export function safeHtml(html) {
    const body = parse(html);
    clean(body);
    return body.innerHTML;
}

function clean(node) {
    for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) continue;                    // 글자
        if (child.nodeType !== 1) { child.remove(); continue; } // 주석 등
        const tag = child.tagName.toUpperCase();   // SVG 같은 외부 요소는 소문자로 온다
        if (!ALLOWED.has(tag)) {
            if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|NOSCRIPT|SVG|MATH)$/.test(tag)) {
                child.remove();                                  // 내용까지 버린다
            } else {
                clean(child);
                child.replaceWith(...child.childNodes);          // 태그만 벗기고 글자는 남긴다
            }
            continue;
        }
        for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
        clean(child);
    }
}

/** HTML 에서 글자만 (CSV · AI 재료용). 실행되지 않는 문서에서 읽는다. */
export function textOf(html) {
    return (parse(html).textContent || "").replace(/\s+/g, " ").trim();
}
