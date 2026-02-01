import * as THREE from "three";
import { GetPlanes } from "./GetPlane.js";
import { MakeClipping } from "./MakeClipping.js";

export function initPartialClipping(
    scene,
    meshDict,
    timeJson,
    timekeys,
    allGroup,
    renderer,
    camera,
    controls
) {
    const latestTime = timekeys[timekeys.length - 1];
    const latestElem = [];

    for (const elemid of timeJson[latestTime]?.Elements || []) {
        const groups = meshDict[elemid];
        if (!groups) continue;
        groups.visible = true;

        const copied = groups.clone(true);
        copied.traverse((child) => {
            if ((child.isMesh || child.isLine) && child.material?.isMaterial) {
                child.material = child.material.clone();
            }
        });

        copied.visible = true;
        scene.add(copied);
        latestElem.push(copied);
    }

    const clipSource = latestElem.length ? latestElem : [MakeBox()];
    const { planes, inversePlanes, cons, helpers } = GetPlanes(clipSource, scene);
    let draggingCone = null;
    const dragStartPoint = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    window.addEventListener("mousedown", planeMouseDown);
    window.addEventListener("mousemove", planeMouseMove);
    window.addEventListener("mouseup", planeMouseUp);

    let dragEnabled = false;

    function planeMouseDown(event) {
        if (!dragEnabled) return;
        const intersects = getIntersects(event);
        if (!intersects.length) return;
        const clickedObject = intersects[0].object;
        if (!clickedObject.Data) return;
        controls.enabled = false;
        draggingCone = clickedObject;
        draggingCone.material.color.set(0xff0000);
        draggingCone.material.emissiveIntensity = 1.5;
        dragStartPoint.copy(intersects[0].point);
    }

    function planeMouseMove(event) {
        if (!draggingCone) return;
        const intersects = getIntersects(event);
        if (!intersects.length) return;
        const currentPoint = intersects[0].point;
        const plane = draggingCone.Data;
        const inversePlane = draggingCone.Data2;
        const normal = plane.normal.clone();

        const dragVector = currentPoint.clone().sub(dragStartPoint);
        const projectedDistance = dragVector.dot(normal);

        plane.constant -= projectedDistance;
        inversePlane.constant += projectedDistance;

        const newPosition = normal.clone().multiplyScalar(-plane.constant);
        draggingCone.position.copy(newPosition).add(normal.clone().multiplyScalar(0.1));
        dragStartPoint.copy(currentPoint);
    }

    function planeMouseUp() {
        if (draggingCone) {
            controls.enabled = true;
            draggingCone.material.color.set(0x00ff00);
            draggingCone.material.emissiveIntensity = 1;
        }
        draggingCone = null;
    }

    function getIntersects(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        return raycaster.intersectObjects(cons, true);
    }

    renderer.localClippingEnabled = true;
    MakeClipping(latestElem, allGroup, planes, inversePlanes, true);

    const bounds = getBounds(clipSource);
    const boundsCenter = bounds.getCenter(new THREE.Vector3());
    setupClipControls(bounds, boundsCenter);

    const insideButton = document.getElementById("inside-button");
    const outsideButton = document.getElementById("outside-button");
    const planeButton = document.getElementById("plane-button");
    const slider = document.getElementById("partially-slider");

    let insideVisible = false;
    let outsideVisible = true;

    insideButton?.addEventListener("click", () => {
        insideButton.classList.toggle("Visible");
        if (insideButton.classList.contains("Visible")) {
            const currentIndex = parseInt(slider?.value || "0", 10);
            const currentTime = timekeys[currentIndex];
            updateMeshes(currentTime);
        } else {
            for (const group of allGroup) {
                group.visible = false;
            }
        }
        insideVisible = !insideVisible;
    });

    outsideButton?.addEventListener("click", () => {
        outsideButton.classList.toggle("Visible");
        outsideVisible = outsideButton.classList.contains("Visible");
        for (const group of latestElem) {
            group.visible = outsideVisible;
        }
    });

    if (planeButton) {
        planeButton.classList.add("Visible");
        planeButton.style.backgroundColor = "#263238";
    }
    helpers.forEach((helper) => {
        helper.visible = false;
    });
    cons.forEach((con) => {
        con.visible = false;
    });
    dragEnabled = false;

    planeButton?.addEventListener("click", () => {
        planeButton.classList.toggle("Visible");
        const hide = planeButton.classList.contains("Visible");
        planeButton.style.backgroundColor = hide ? "#263238" : "#4CAF50";
        for (const helper of helpers) {
            helper.visible = !hide;
        }
        for (const con of cons) {
            con.visible = !hide;
        }
        dragEnabled = !hide;
    });

    function updateMeshes(currentTime) {
        for (const group of allGroup) {
            group.visible = false;
        }
        for (const timelog of timeJson[currentTime]?.Elements || []) {
            const groups = meshDict[timelog];
            if (groups) groups.visible = true;
        }
    }

    function setupClipControls(boundsBox, center) {
        const controls = [
            { id: "clip-x-min", valueId: "clip-x-min-value", planeIndex: 1, axis: "x" },
            { id: "clip-x-max", valueId: "clip-x-max-value", planeIndex: 0, axis: "x" },
            { id: "clip-y-min", valueId: "clip-y-min-value", planeIndex: 3, axis: "y" },
            { id: "clip-y-max", valueId: "clip-y-max-value", planeIndex: 2, axis: "y" },
            { id: "clip-z-min", valueId: "clip-z-min-value", planeIndex: 5, axis: "z" },
            { id: "clip-z-max", valueId: "clip-z-max-value", planeIndex: 4, axis: "z" },
        ];

        const axisRanges = {
            x: getAxisRange(boundsBox.min.x, boundsBox.max.x),
            y: getAxisRange(boundsBox.min.y, boundsBox.max.y),
            z: getAxisRange(boundsBox.min.z, boundsBox.max.z),
        };

        const sliderMap = {};
        const initialPositions = {};

        controls.forEach((control) => {
            const slider = document.getElementById(control.id);
            const valueLabel = document.getElementById(control.valueId);
            if (!slider || !valueLabel) return;

            const range = axisRanges[control.axis];
            slider.min = range.min.toFixed(2);
            slider.max = range.max.toFixed(2);
            slider.step = range.step.toFixed(3);

            const plane = planes[control.planeIndex];
            const position = getPlanePosition(plane);
            slider.value = position.toFixed(3);
            valueLabel.textContent = position.toFixed(2);

            sliderMap[control.id] = slider;
            initialPositions[control.id] = position;

            slider.addEventListener("input", () => {
                let nextValue = Number(slider.value);
                const pair = getAxisPair(control.axis, sliderMap);
                if (pair) {
                    if (control.id.endsWith("min") && nextValue > Number(pair.max.value)) {
                        pair.max.value = nextValue.toFixed(3);
                    }
                    if (control.id.endsWith("max") && nextValue < Number(pair.min.value)) {
                        pair.min.value = nextValue.toFixed(3);
                    }
                }
                updatePlane(control.planeIndex, nextValue, center);
                valueLabel.textContent = nextValue.toFixed(2);
            });
        });

        const resetButton = document.getElementById("clip-reset");
        resetButton?.addEventListener("click", () => {
            controls.forEach((control) => {
                const slider = document.getElementById(control.id);
                const valueLabel = document.getElementById(control.valueId);
                if (!slider || !valueLabel) return;
                const position = initialPositions[control.id];
                slider.value = position.toFixed(3);
                valueLabel.textContent = position.toFixed(2);
                updatePlane(control.planeIndex, position, center);
            });
        });
    }

    function updatePlane(planeIndex, position, center) {
        const plane = planes[planeIndex];
        const inversePlane = inversePlanes[planeIndex];
        setPlanePosition(plane, position);
        inversePlane.constant = -plane.constant;
        updateConePosition(planeIndex, center);
    }

    function updateConePosition(planeIndex, center) {
        const plane = planes[planeIndex];
        const cone = cons[planeIndex];
        if (!cone) return;
        const position = getPlanePosition(plane);
        const nextPos = new THREE.Vector3(center.x, center.y, center.z);
        if (plane.normal.x !== 0) nextPos.x = position;
        if (plane.normal.y !== 0) nextPos.y = position;
        if (plane.normal.z !== 0) nextPos.z = position;
        cone.position.copy(nextPos).add(plane.normal.clone().multiplyScalar(0.1));
    }
}

function MakeBox() {
    const boxGeometry = new THREE.BoxGeometry(10, 10, 10);
    const boxMaterial = new THREE.MeshStandardMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.4,
    });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.castShadow = true;
    box.receiveShadow = false;

    const edges = new THREE.EdgesGeometry(boxGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    const edgeLines = new THREE.LineSegments(edges, edgeMaterial);

    const boxGroup = new THREE.Group();
    boxGroup.add(box);
    boxGroup.add(edgeLines);
    return boxGroup;
}

function getBounds(objects) {
    const bounds = new THREE.Box3();
    objects.forEach((obj) => {
        const temp = new THREE.Box3().setFromObject(obj);
        bounds.union(temp);
    });
    if (!isFinite(bounds.min.x) || !isFinite(bounds.max.x)) {
        bounds.min.set(-5, -5, -5);
        bounds.max.set(5, 5, 5);
    }
    return bounds;
}

function getAxisRange(min, max) {
    const size = Math.max(max - min, 1);
    const pad = size * 0.08;
    return {
        min: min - pad,
        max: max + pad,
        step: size / 200,
    };
}

function getPlanePosition(plane) {
    if (plane.normal.x !== 0) return plane.normal.x > 0 ? -plane.constant : plane.constant;
    if (plane.normal.y !== 0) return plane.normal.y > 0 ? -plane.constant : plane.constant;
    return plane.normal.z > 0 ? -plane.constant : plane.constant;
}

function setPlanePosition(plane, position) {
    if (plane.normal.x !== 0) {
        plane.constant = plane.normal.x > 0 ? -position : position;
        return;
    }
    if (plane.normal.y !== 0) {
        plane.constant = plane.normal.y > 0 ? -position : position;
        return;
    }
    plane.constant = plane.normal.z > 0 ? -position : position;
}

function getAxisPair(axis, sliderMap) {
    if (axis === "x") return { min: sliderMap["clip-x-min"], max: sliderMap["clip-x-max"] };
    if (axis === "y") return { min: sliderMap["clip-y-min"], max: sliderMap["clip-y-max"] };
    if (axis === "z") return { min: sliderMap["clip-z-min"], max: sliderMap["clip-z-max"] };
    return null;
}
