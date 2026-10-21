// ─────────────────────────────────────────────────────────────────────────────
// 걷기 모드 — 1인칭 조작(W A S D 이동 · Q E 위아래 · 드래그 시선 · Esc 끄기)
//
// 켜면 OrbitControls 를 잠시 멈추고 카메라를 직접 움직인다. 끄면 켜기 전 카메라
// 위치 · 시선 · 중심(target)을 그대로 돌려놓는다. 이동 속도는 모델 반경에 비례해
// 작은 집이든 큰 병원이든 비슷한 체감으로 걷는다. Space 는 타임라인 재생 키라 쓰지 않는다.
// 분할 비교의 왼쪽 뷰어(compare.js)는 건드리지 않는다.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { store } from "./store.js";
import { modelSphere } from "./shoot.js";

const KEYS = { KeyW: "fwd", KeyS: "back", KeyA: "left", KeyD: "right", KeyQ: "down", KeyE: "up" };
const LOOK_SPEED = 0.0045;          // 드래그 1px 당 회전(라디안)
const PITCH_MAX = Math.PI / 2 - 0.05;
const HINT_MS = 3200;               // 안내 칩이 떠 있는 시간

export function initWalk() {
    const btn = document.getElementById("walk-toggle");
    const hint = document.getElementById("walk-hint");
    if (!btn) return null;

    const pressed = new Set();
    let on = false;
    let saved = null;               // 켜기 전 카메라 · 중심
    let yaw = 0, pitch = 0;
    let drag = null;                // { x, y } 마지막 포인터 위치
    let hintTimer = 0;
    let lastT = 0;

    const viewer = () => store.viewer;
    const isTyping = (t) => !!t?.closest?.("input, textarea, select, [contenteditable=true]");

    // 모델 반경 기준 걷는 속도(단위/초). 반경 10 짜리 집이면 초당 4 정도.
    function speed() {
        const r = modelSphere()?.radius || 10;
        return Math.max(r * 0.4, 0.5);
    }

    function setOn(next) {
        const v = viewer();
        if (!v || next === on) return;
        on = next;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        v.container.classList.toggle("is-walking", on);
        pressed.clear();
        drag = null;

        if (on) {
            saved = { pos: v.camera.position.clone(), quat: v.camera.quaternion.clone(), target: v.controls.target.clone() };
            v.controls.enabled = false;
            // 지금 보는 방향을 yaw · pitch 로 옮겨 시선이 튀지 않게
            const dir = new THREE.Vector3();
            v.camera.getWorldDirection(dir);
            yaw = Math.atan2(-dir.x, -dir.z);
            pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
            applyLook();
            lastT = performance.now();
            showHint();
        } else {
            if (saved) {
                v.camera.position.copy(saved.pos);
                v.camera.quaternion.copy(saved.quat);
                v.controls.target.copy(saved.target);
            }
            v.controls.enabled = true;
            v.controls.update();
            hideHint();
        }
        store.walking = on;
    }

    function applyLook() {
        viewer().camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
    }

    function showHint() {
        if (!hint) return;
        hint.hidden = false;
        clearTimeout(hintTimer);
        hintTimer = setTimeout(hideHint, HINT_MS);
    }
    function hideHint() { if (hint) hint.hidden = true; clearTimeout(hintTimer); }

    // 매 프레임: 눌린 키로 이동. main.js 의 animate 가 부른다.
    function update(now = performance.now()) {
        if (!on) return;
        const dt = Math.min((now - lastT) / 1000, 0.1);
        lastT = now;
        if (pressed.size === 0) return;
        const cam = viewer().camera;
        const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));   // 수평 앞 방향(걷기)
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const move = new THREE.Vector3();
        if (pressed.has("fwd")) move.add(fwd);
        if (pressed.has("back")) move.sub(fwd);
        if (pressed.has("right")) move.add(right);
        if (pressed.has("left")) move.sub(right);
        if (pressed.has("up")) move.y += 1;
        if (pressed.has("down")) move.y -= 1;
        if (move.lengthSq() === 0) return;
        const boost = pressed.has("fast") ? 3 : 1;
        cam.position.addScaledVector(move.normalize(), speed() * boost * dt);
    }

    // ── 키 ───────────────────────────────────────────────────────────────────
    window.addEventListener("keydown", (e) => {
        if (isTyping(e.target)) return;
        if (e.key === "Escape" && on) { setOn(false); e.preventDefault(); return; }
        if (!on) return;
        if (e.key === "Shift") { pressed.add("fast"); return; }
        const k = KEYS[e.code];
        if (!k) return;
        pressed.add(k);
        e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
        if (e.key === "Shift") { pressed.delete("fast"); return; }
        const k = KEYS[e.code];
        if (k) pressed.delete(k);
    });
    window.addEventListener("blur", () => pressed.clear());

    // ── 드래그 시선 ──────────────────────────────────────────────────────────
    const canvasOf = () => viewer()?.renderer?.domElement;
    const onMove = (e) => {
        if (!on || !drag) return;
        yaw -= (e.clientX - drag.x) * LOOK_SPEED;
        pitch = THREE.MathUtils.clamp(pitch - (e.clientY - drag.y) * LOOK_SPEED, -PITCH_MAX, PITCH_MAX);
        drag = { x: e.clientX, y: e.clientY };
        applyLook();
    };
    const onUp = () => { drag = null; };
    // 뷰어가 다시 만들어져도(파일 다시 불러오기) 캔버스를 매번 찾는다
    document.addEventListener("pointerdown", (e) => {
        if (!on || e.button !== 0 || e.target !== canvasOf()) return;
        drag = { x: e.clientX, y: e.clientY };
    }, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    btn.addEventListener("click", () => setOn(!on));

    // 분할 비교가 열리면(머리줄이 숨는다) 걷기를 끈다
    const root = document.getElementById("root");
    if (root) new MutationObserver(() => { if (on && root.classList.contains("is-split")) setOn(false); })
        .observe(root, { attributes: true, attributeFilter: ["class"] });

    const api = {
        update, setOn, isOn: () => on,
        look: (y, p) => { yaw = y; pitch = p; if (on) applyLook(); },
        press: (k, down = true) => { if (down) pressed.add(k); else pressed.delete(k); },
    };
    window.__fvWalk = api;   // 헤드리스 검증용
    return api;
}
