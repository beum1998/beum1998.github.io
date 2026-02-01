import * as THREE from "three";
import { loadMeshes } from "./meshLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { sliderControls } from "./slider.js";
import { initPartialClipping } from "./initPartial.js";
import { clickEvent } from "./clickElement.js";

export async function main(containerId, sliderId, isPartial) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#F5F5DC");

    const lightPositions = [
        [0, 3, 0],
        [0, 3, 5],
        [5, 3, 0],
        [-5, 3, 5],
        [5, 3, -5],
        [0, 3, -5],
        [-5, 3, 0],
    ];

    lightPositions.forEach((pos) => {
        const light = new THREE.DirectionalLight(0xffffff, 0.7);
        light.position.set(...pos);
        light.castShadow = true;
        light.shadow.bias = -0.0005;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;
        scene.add(light);
    });

    const ambientLight = new THREE.AmbientLight(0x000000);
    scene.add(ambientLight);

    const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: containerId === "fully-target",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(75, 1, 0.01, 5000);
    camera.position.set(0, 3, 10);
    camera.lookAt(0, 1, 0);

    const resize = () => {
        const width = container.clientWidth || 1;
        const height = container.clientHeight || 1;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
    };

    if ("ResizeObserver" in window) {
        const observer = new ResizeObserver(resize);
        observer.observe(container);
    } else {
        window.addEventListener("resize", resize);
    }
    resize();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI / 2;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.target.set(0, 0, 0);
    controls.update();

    const shapeJson = await loadJson("./src/finalLogs/shapeLogs1.json");
    const timeJson = await loadJson("./src/finalLogs/timeLogs1.json");
    if (!shapeJson || !timeJson) return;

    const timekeys = Object.keys(timeJson).sort();
    if (!timekeys.length) return;
    const { allGroup, meshDict } = loadMeshes(shapeJson, scene, 0.2);
    addOutlines(allGroup);
    const latestTime = timekeys[timekeys.length - 1];
    const visibleBounds = getBoundsForTime(timeJson, latestTime, meshDict);
    const bounds = visibleBounds || getModelBounds(allGroup);
    if (bounds) {
        const center = bounds.getCenter(new THREE.Vector3());
        fitCameraToBounds(camera, controls, bounds);
        controls.target.copy(center);
        camera.lookAt(center);
        controls.update();
    }

    if (isPartial) {
        initPartialClipping(scene, meshDict, timeJson, timekeys, allGroup, renderer, camera, controls);
    } else {
        const elementTarget = document.getElementById("element-target");
        if (elementTarget) {
            elementTarget.innerHTML = `<h2 id="select-element">Select the Element in Scene!</h2>`;
        }
        clickEvent(renderer, camera, allGroup);
    }

    sliderControls(sliderId, timekeys, timeJson, allGroup, meshDict, isPartial);

    const animate = () => {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    };
    animate();
}

function getModelBounds(groups) {
    const bounds = new THREE.Box3();
    let hasBounds = false;
    for (const group of groups) {
        if (!group) continue;
        const temp = new THREE.Box3().setFromObject(group);
        if (!isFinite(temp.min.x) || !isFinite(temp.max.x)) continue;
        bounds.union(temp);
        hasBounds = true;
    }
    if (!hasBounds) return null;
    return bounds;
}

function getBoundsForTime(timeJson, timeKey, meshDict) {
    const bounds = new THREE.Box3();
    let hasBounds = false;
    const elements = timeJson[timeKey]?.Elements || [];
    for (const elementId of elements) {
        const group = meshDict[elementId];
        if (!group) continue;
        const temp = new THREE.Box3().setFromObject(group);
        if (!isFinite(temp.min.x) || !isFinite(temp.max.x)) continue;
        bounds.union(temp);
        hasBounds = true;
    }
    if (!hasBounds) return null;
    return bounds;
}

function fitCameraToBounds(camera, controls, bounds) {
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (camera.fov * Math.PI) / 180;
    const fitDistance = maxDim / (2 * Math.tan(fov / 2));
    const direction = new THREE.Vector3(1, 0.4, 1).normalize();
    camera.position.copy(center).add(direction.multiplyScalar(fitDistance * 0.35));
    camera.near = Math.max(fitDistance / 500, 0.01);
    camera.far = fitDistance * 80;
    camera.updateProjectionMatrix();
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
}

async function loadJson(jsonPath) {
    try {
        const response = await fetch(jsonPath);
        if (!response.ok) throw new Error("Failed to load Json");
        return await response.json();
    } catch (error) {
        console.error("Error loading Json:", error);
        return null;
    }
}

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