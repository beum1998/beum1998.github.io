// 비교 페이지: 우측 패널(Diff/Chat)을 접었다 폈다.
// 접으면 두 뷰어(Before/After)가 넓어지고, 화면 우측 가장자리의 토글로 다시 펼친다.
export function initComparePanels() {
    const layout = document.getElementById("diff-screen") || document.querySelector(".diff-layout");
    const rightPanel = document.getElementById("llm-panel");
    if (!layout || !rightPanel) return;
    if (layout.dataset.cmpInit) return;
    layout.dataset.cmpInit = "1";

    const tog = document.createElement("button");
    tog.className = "cmp-tog";
    tog.title = "우측 패널 접기/펼치기";
    const ic = document.createElement("span");
    ic.className = "cmp-tog-ic";
    tog.appendChild(ic);
    document.body.appendChild(tog);

    let open = true;
    function apply() {
        layout.classList.toggle("right-collapsed", !open);
        tog.classList.toggle("collapsed", !open);
        ic.textContent = open ? "❯" : "❮";
        // 그리드가 바뀌었으니 뷰어 렌더러가 크기를 다시 맞추도록 알림
        window.dispatchEvent(new Event("resize"));
        setTimeout(() => window.dispatchEvent(new Event("resize")), 260);
    }
    tog.addEventListener("click", () => { open = !open; apply(); });
    apply();
}
