import * as THREE from "three";
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadMeshes } from "./src/meshLoader.js";
import { sliderControls } from "./src/slider.js";
import { MakeChart } from "./src/makeChart.js";
import { clickEvent } from "./src/clickEvent.js";
import { rightPanelButtonClick } from "./src/rightPanelButton.js";
import { store, emit, on, keyToMs, buildLevels, resetProject } from "./src/store.js";
import { initPins } from "./src/pins.js";
import { initCompare } from "./src/compare.js";
import { initHistory } from "./src/history.js";
import { initCommitView } from "./src/commitView.js";
import { initAiSummary } from "./src/aiSummary.js";
import { initBriefing } from "./src/briefing.js";
import { initDetailsMotion } from "./src/motion.js";
import { initWalk } from "./src/walk.js";

let walk = null;   // 걷기 모드 — 창마다 하나(다시 불러와도 재사용)

export function main(
    shapeLog,
    timeLog,
    wallQ,
    ctWallQ,
    floorQ,
    ceilingQ,
    columnQ,
    stColumnQ,
    stairQ,
    railingQ,
    windowQ,
    doorQ) {
    const container = document.getElementById("render-target");
    if (walk?.isOn()) walk.setOn(false);   // 다시 불러올 때 이전 뷰어의 걷기 모드를 끈다
    if (typeof window.__fvCleanup === "function") { try { window.__fvCleanup(); } catch (e) {} } // clean previous load (avoid double render)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#edf0f4");

    const lightConfigs = [
        [0, 3, 0],
        [0, 3, 5],
        [5, 3, 0],
        [-5, 3, 5],
        [5, 3, -5],
        [0, 3, -5],
        [-5, 3, 0],
    ];

    lightConfigs.forEach(pos => {
        const light = new THREE.DirectionalLight(0xffffff, 0.7);
        light.position.set(...pos);
        light.castShadow = true;
        light.shadow.bias = -0.0005;
        light.shadow.mapSize.width = 1024; // 그림자 품질 낮추면 퍼지게 보임
        light.shadow.mapSize.height = 1024;
        scene.add(light);
    });

    // 조명 설정2
    const ambientLight = new THREE.AmbientLight(0x000000); // 부드러운 전체광
    scene.add(ambientLight);

    // renderer 설정
    const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true   // allow high-res toDataURL capture
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    container.appendChild(renderer.domElement);
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Camera 설정
    const camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.01, 5000);
    camera.position.set(0, 3, 10);
    camera.lookAt(0, 1, 0);

    // expose for the hidden high-resolution capture (Shift+click on the Door button)
    window.__fvViewer = { renderer, scene, camera, container };

    // Control 설정 — OrbitControls: 좌클릭 드래그 = 고정된 중심(target) 기준 회전.
    // (기존 MapControls 는 좌클릭이 패닝이라 시점이 자꾸 떠돌아 '길 잃는' 느낌이었음)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.minDistance = 2;
    controls.maxDistance = 100000;   // allow zooming out to see augmented (replicated) buildings
    controls.maxPolarAngle = Math.PI / 2;
    controls.rotateSpeed = 0.7;
    controls.zoomToCursor = false;   // 줌은 항상 중심(target)을 향하게 → 시점이 덜 흐트러짐

    // 분할 비교로 폭이 바뀌어도 렌더러/카메라가 따라가게
    const resizeObserver = new ResizeObserver(() => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width < 2 || height < 2) return;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    });
    resizeObserver.observe(container);


    // .d8888. d888888b .88b  d88. d8888b. db      d88888b      .d8888. d88888b d888888b d888888b d888888b d8b   db  d888b       d88888b d8b   db d8888b. .d8888.
    // 88'  YP   `88'   88'YbdP`88 88  `8D 88      88'          88'  YP 88'     `~~88~~' `~~88~~'   `88'   888o  88 88' Y8b      88'     888o  88 88  `8D 88'  YP
    // `8bo.      88    88  88  88 88oodD' 88      88ooooo      `8bo.   88ooooo    88       88       88    88V8o 88 88           88ooooo 88V8o 88 88   88 `8bo.
    //   `Y8b.    88    88  88  88 88~~~   88      88~~~~~        `Y8b. 88~~~~~    88       88       88    88 V8o88 88  ooo      88~~~~~ 88 V8o88 88   88   `Y8b.
    // db   8D   .88.   88  88  88 88      88booo. 88.          db   8D 88.        88       88      .88.   88  V888 88. ~8~      88.     88  V888 88  .8D db   8D
    // `8888Y' Y888888P YP  YP  YP 88      Y88888P Y88888P      `8888Y' Y88888P    YP       YP    Y888888P VP   V8P  Y888P       Y88888P VP   V8P Y8888D' `8888Y'

    const { allGroup, meshDict } = loadMeshes(shapeLog, scene, 0.2);
    const SHOW_OUTLINES = true;   // re-enabled for display (scalability already measured without outlines)
    if (SHOW_OUTLINES) addOutlines(allGroup);
    scene.updateMatrixWorld(true);
    fitCameraToView(camera, controls, allGroup);   // frame all loaded buildings
    const timeKeys = Object.keys(timeLog).sort();

    // 공용 상태: 타임라인 · 핀 · 분할 비교 · 층 필터가 같이 쓴다
    Object.assign(store, {
        shapeLog,
        timeLog,
        timeKeys,
        keyMs: timeKeys.map(keyToMs),
        allGroup,
        meshDict,
        viewer: { renderer, scene, camera, controls, container },
        levels: buildLevels(allGroup),
    });

    const charts = [
        [wallQ, "graph-wall"],
        [ctWallQ, "graph-curtainWall"],
        [floorQ, "graph-floor"],
        [ceilingQ, "graph-ceiling"],
        [columnQ, "graph-column"],
        [stColumnQ, "graph-structuralColumn"],
        [stairQ, "graph-stair"],
        [railingQ, "graph-railing"],
        [windowQ, "graph-forwindow"],
        [doorQ, "graph-door"],
    ].map(([quant, id]) => {
        const { chart1, myCanvas } = MakeChart(timeKeys, quant, id);
        return { chart: chart1, canvas: myCanvas };
    });

    rightPanelButtonClick();
    initPins();
    initCompare();
    initHistory();
    initCommitView();
    initAiSummary();
    initBriefing();
    initDetailsMotion(document);
    walk = walk || initWalk();
    sliderControls("fully-slider", timeKeys, timeLog, allGroup, meshDict, charts);
    clickEvent(renderer, camera, allGroup, { chip: document.getElementById("pick-main"), panel: true });
    emit("data");
    emit("time:main", store.mainIndex);

    // expose for the benchmark time-point sweep (active objects / update latency / fps per slider step)
    window.__fvBench = { slider: document.getElementById("fully-slider"), timeKeys, timeLog, allGroup };

    const exportButton = document.getElementById("export-button");
    exportButton?.addEventListener('click', () => {
        const answer = {
            "Wall": [], "Curtain Wall": [], "Floor": [], "Ceiling": [], "Column": [],
            "Structural Column": [], "Window": [], "Door": [], "Railing": [],
            "Stair": [], "Furniture": [], "Roof": [], "All": []
        };
        const bucket = {
            "Walls": "Wall", "Curtain Walls": "Curtain Wall", "Floors": "Floor", "Ceilings": "Ceiling",
            "Roofs": "Roof", "Columns": "Column", "Structural Columns": "Structural Column",
            "Windows": "Window", "Doors": "Door", "Railings": "Railing", "Stairs": "Stair", "Furniture": "Furniture",
        };

        for (const i of allGroup) {
            if (i.visible != true) continue;
            const id = i.userData.Common.ElementId;
            const b = bucket[i.userData.Common.ElementCategory];
            if (!b) continue;
            answer["All"].push(id);
            answer[b].push(id);
        }

        const blob = new Blob([JSON.stringify(answer, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "export.json";  // 다운로드 파일명
        link.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById("loading")?.classList.add("is-done");

    // 리본 [비교하기] 는 #compare 로 연다 → 바로 분할 비교.
    // A 시점을 "직전 핀"으로 잡으려면 핀 목록(pins.json)이 먼저 와야 하므로 로드를 기다린다.
    if (location.hash === "#compare") {
        let opened = false;
        const open = () => {
            if (opened) return;
            opened = true;
            off();
            store.openSplit?.();
        };
        const off = on("pins", open);
        setTimeout(open, 1500);   // pins.json 이 없거나 늦어도 분할은 연다
    }

    // ?selftest=ai → AI 기능 자체 점검 (가짜 응답으로). &live=1 이면 내 키로 실제 연결도 확인.
    const params = new URLSearchParams(location.search);
    if (params.get("selftest") === "ai") {
        import("./tests/ai-selftest.js")
            .then((m) => m.run({ render: true, live: params.has("live") }))
            .catch((e) => console.error("[selftest] 실행 실패", e));
    }

    // animate 실행
    let __raf = 0;
    window.__fvCleanup = () => {
        cancelAnimationFrame(__raf);
        try { resizeObserver.disconnect(); } catch (e) {}
        container.innerHTML = "";
        resetProject();   // 프로젝트에 매인 캐시 · 리스너(타임라인 · 썸네일 · 변경 계산 …) 정리
    };
    animate();

    function animate() {
        if (walk?.isOn()) walk.update(); else controls.update();
        __raf = requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }
}

// Fit the camera so the PRIMARY building fills the view (front-ish angle).
//
// The data may contain augmented replica buildings copied far away on a grid.
// Framing the whole field would push the camera thousands of units back
// ("too far"), so we frame only the connected building nearest the origin and
// still allow zooming out to see the replicas.
function fitCameraToView(camera, controls, groups) {
    // Per-group world-space boxes
    const boxes = [];
    for (const g of groups) {
        if (!g) continue;
        g.updateWorldMatrix(true, false);
        const b = new THREE.Box3().setFromObject(g);
        if (!isFinite(b.min.x) || !isFinite(b.max.x)) continue;
        boxes.push(b);
    }
    if (boxes.length === 0) return;

    // Full extent of everything (used for far-plane / max-zoom so replicas stay visible)
    const full = new THREE.Box3();
    for (const b of boxes) full.union(b);
    const fullDiag = full.getSize(new THREE.Vector3()).length() || 1;
    const height = Math.max(full.getSize(new THREE.Vector3()).y, 0.001);

    // Seed = box whose center is closest to the world origin (the original building)
    let seed = boxes[0], best = Infinity;
    for (const b of boxes) {
        const d = b.getCenter(new THREE.Vector3()).length();
        if (d < best) { best = d; seed = b; }
    }

    // Grow a connected cluster from the seed: keep unioning boxes that touch the
    // growing box (within a small gap). This captures one whole building and
    // stops at the empty gap before the replicas.
    const gap = height * 0.5;
    let box = seed.clone();
    const used = new Array(boxes.length).fill(false);
    let grew = true;
    while (grew) {
        grew = false;
        const eb = box.clone().expandByScalar(gap);
        for (let i = 0; i < boxes.length; i++) {
            if (used[i]) continue;
            if (eb.intersectsBox(boxes[i])) { box.union(boxes[i]); used[i] = true; grew = true; }
        }
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Fit the building's bounding sphere to the view. Using the sphere radius
    // (not just one axis) keeps the camera outside the building even when it is
    // deep in Z, so nothing clips. Divide by aspect when the viewport is narrower
    // than tall so the sides don't get cut off.
    const radius = 0.5 * size.length() || 1;
    const fov = camera.fov * Math.PI / 180;                 // vertical FOV
    const aspect = (camera.aspect && isFinite(camera.aspect)) ? camera.aspect : 1;
    const dist = (radius / Math.tan(fov / 2)) * 1.15 / Math.min(1, aspect);

    // View from the front, slightly above (건물 앞이 딱 보이게)
    const dir = new THREE.Vector3(0, 0.35, 1).normalize();
    camera.position.copy(center).add(dir.multiplyScalar(dist));
    camera.near = Math.max(dist / 1000, 0.05);
    camera.far = Math.max(dist * 100, fullDiag * 2);   // still see augmented field when zoomed out
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.minDistance = 0;
    controls.maxDistance = Math.max(dist * 40, fullDiag);
    controls.update();
}

// Add thin edge outlines to every mesh (same look as the landing embedded viewer)
function addOutlines(groups) {
    const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x2a2a2a,
        transparent: true,
        opacity: 0.25,
    });
    groups.forEach((group) => {
        group.traverse((child) => {
            if (!child.isMesh || !child.geometry) return;
            if (child.userData && child.userData.hasOutline) return;
            const edges = new THREE.EdgesGeometry(child.geometry);
            const line = new THREE.LineSegments(edges, edgeMaterial);
            line.renderOrder = 1;
            child.add(line);
            child.userData.hasOutline = true;
        });
    });
}
