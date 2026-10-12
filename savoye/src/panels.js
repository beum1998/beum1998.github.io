// ─────────────────────────────────────────────────────────────────────────────
// 패널 접기/펼치기 + 드래그 크기조절
//
// 우측 패널(수량·차트·요소·녹음·핀·비교)과 하단 패널(필터·타임라인)을
//   · 패널 가장자리에 붙은 손잡이로 접었다 폈다
//   · 경계선을 드래그해서 크기 조절
// 할 수 있게 한다. 손잡이는 패널에 붙어 함께 움직이고, 접히면 화면 가장자리에 남는다.
// 접기/펼치기는 CSS grid transition 으로 부드럽게 움직이며,
// 3D 뷰는 main.js / compare.js 의 ResizeObserver 가 렌더러·카메라를 맞춘다.
// ─────────────────────────────────────────────────────────────────────────────

import { icon } from "./icons.js";
import { emit } from "./store.js";

export function initPanels() {
    const root = document.getElementById('root');
    if (!root || root.dataset.panelsInit) return;
    root.dataset.panelsInit = '1';

    const DEF_RIGHT = 400, DEF_DOWN = 168;   // style.css 의 기본 grid 크기와 같게
    const MIN_RIGHT = 280, MAX_RIGHT = 900;
    const MIN_DOWN = 150, MAX_DOWN = 420;

    let rightW = DEF_RIGHT, downH = DEF_DOWN;
    let rightOpen = true, downOpen = true;

    // 스플리터(드래그 막대)
    const vsplit = mk('div', 'abl-split abl-split-v');
    const hsplit = mk('div', 'abl-split abl-split-h');

    // 패널에 붙은 손잡이 — 접혀도 화면 가장자리에 남는다
    const rTog = mk('button', 'abl-handle abl-handle-r');
    const dTog = mk('button', 'abl-handle abl-handle-d');
    rTog.type = dTog.type = 'button';
    rTog.innerHTML = icon('chevronRight', 14);
    dTog.innerHTML = icon('chevronDown', 14);
    rTog.title = '우측 패널 접기 / 펼치기';
    dTog.title = '하단 패널 접기 / 펼치기';
    root.append(vsplit, hsplit, rTog, dTog);

    function apply() {
        const rw = rightOpen ? rightW : 0;
        const dh = downOpen ? downH : 0;

        root.style.gridTemplateColumns = `1fr ${rw}px`;
        root.style.gridTemplateRows = `1fr ${dh}px`;
        root.classList.toggle('is-right-collapsed', !rightOpen);
        root.classList.toggle('is-down-collapsed', !downOpen);

        // 스플리터: 접혔을 땐 숨김
        vsplit.style.right = rw + 'px';
        vsplit.hidden = !rightOpen;
        hsplit.style.right = rw + 'px';
        hsplit.style.bottom = dh + 'px';
        hsplit.hidden = !downOpen;

        // 1px 겹치게 둬서 패널 경계선이 손잡이 밑을 가로지르지 않게 한다
        rTog.style.right = Math.max(0, rw - 1) + 'px';
        rTog.classList.toggle('is-collapsed', !rightOpen);
        rTog.setAttribute('aria-expanded', String(rightOpen));

        dTog.style.bottom = Math.max(0, dh - 1) + 'px';
        dTog.style.left = `calc((100% - ${rw}px) / 2)`;
        dTog.classList.toggle('is-collapsed', !downOpen);
        dTog.setAttribute('aria-expanded', String(downOpen));
        emit("panels", { rightOpen, downOpen });   // 떠 있는 목록(재생 속도 등)이 위치를 잃지 않게
    }

    rTog.addEventListener('click', () => { rightOpen = !rightOpen; apply(); });
    dTog.addEventListener('click', () => { downOpen = !downOpen; apply(); });

    dragResize(vsplit, 'x');
    dragResize(hsplit, 'y');

    // 경계선을 더블클릭하면 기본 크기로
    vsplit.addEventListener('dblclick', () => { rightW = DEF_RIGHT; rightOpen = true; apply(); });
    hsplit.addEventListener('dblclick', () => { downH = DEF_DOWN; downOpen = true; apply(); });

    function dragResize(handle, axis) {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            root.classList.add('abl-resizing');   // 드래그 중엔 transition 끄기(즉각 반응)
            const move = (ev) => {
                if (axis === 'x') {
                    rightOpen = true;
                    rightW = clamp(window.innerWidth - ev.clientX, MIN_RIGHT, MAX_RIGHT);
                } else {
                    downOpen = true;
                    downH = clamp(window.innerHeight - ev.clientY, MIN_DOWN, MAX_DOWN);
                }
                apply();
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                root.classList.remove('abl-resizing');
            };
            document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
    }

    // 창 크기가 줄어 패널이 화면을 넘치면 클램프
    window.addEventListener('resize', () => {
        rightW = clamp(rightW, MIN_RIGHT, Math.min(MAX_RIGHT, window.innerWidth - 200));
        downH = clamp(downH, MIN_DOWN, Math.min(MAX_DOWN, window.innerHeight - 200));
        apply();
    });

    apply();

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function mk(tag, cls) { const d = document.createElement(tag); d.className = cls; return d; }
}
