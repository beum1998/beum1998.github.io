// script/clickElement.js
import * as THREE from "three";

const SECTION_KEYS = ["Common", "Geometry", "Layers", "Property", "Parameter", "comment"];

const BUTTON_LABELS = {
  open: "Show",
  close: "Hide",
};

export function clickEvent(renderer, camera, allGroup) {
  const raycaster = new THREE.Raycaster();
  const meshObjects = collectMeshObjects(allGroup);

  let selectedObject = null;

  const elementTarget = document.getElementById("element-target");

  // 섹션 토글 버튼 이벤트 (event delegation)
  if (elementTarget) {
    elementTarget.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains("category-button")) return;

      const key = target.dataset.section;
      if (!key) return;

      const section = document.getElementById(`json-content-${key}`);
      if (!section) return;

      section.classList.toggle("hide");
      target.textContent = section.classList.contains("hide")
        ? BUTTON_LABELS.open
        : BUTTON_LABELS.close;
    });
  }

  window.addEventListener("mousedown", onMouseDown);

  function onMouseDown(event) {
    if (event.button !== 0) return; // left click only
    const rect = renderer.domElement.getBoundingClientRect();

    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    raycaster.setFromCamera(mouse, camera);

    const intersections = raycaster.intersectObjects(meshObjects, true);
    if (!intersections.length) return;

    // 클릭된 mesh의 "상위 group" 잡기 (visible인 것만)
    const intersectedGroup = intersections
      .map((item) => item.object?.parent)
      .find((group) => group && group.visible);

    // 기존 선택 해제
    if (selectedObject && selectedObject.userData?.comment === "selected") {
      selectedObject.userData.comment = null;
      setEmissive(selectedObject, 0x000000);
    }

    // 새 선택
    if (intersectedGroup && selectedObject !== intersectedGroup) {
      setEmissive(intersectedGroup, 0x555555);

      selectedObject = intersectedGroup;
      selectedObject.userData.comment = "selected";

      const meshInfo = intersectedGroup.userData;
      if (meshInfo) updateElementInfo(meshInfo);
    } else {
      // 같은 거 다시 누르거나 group 못 찾으면 초기화
      selectedObject = null;
      if (elementTarget) {
        elementTarget.innerHTML = `<h2 id="select-element">Select the Element in Scene!</h2>`;
      }
    }
  }

  function setEmissive(group, hex) {
    group.traverse((child) => {
      if (!child?.isMesh) return;

      const mat = child.material;
      if (!mat) return;

      // MeshStandardMaterial 등에서 emissive가 있을 때만
      if (mat.emissive && typeof mat.emissive.setHex === "function") {
        mat.emissive.setHex(hex);
      }
    });
  }

  function collectMeshObjects(groups) {
    const objects = [];
    for (const group of groups) {
      if (!group) continue;
      group.traverse((child) => {
        if (child?.isMesh) objects.push(child);
      });
    }
    return objects;
  }

  function updateElementInfo(meshInfo) {
    if (!elementTarget) return;
    elementTarget.innerHTML = generateHTMLFromJSON(meshInfo);
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function generateHTMLFromJSON(json, parentKey = "", depth = 0) {
    let html = "";

    // depth 0은 wrapper를 만들지 않고, 내부 구조만 쌓는 방식 유지
    if (depth !== 0) {
      if (SECTION_KEYS.includes(parentKey)) {
        html += `<div class="json-section-${depth}" id="json-section-${depth}-${parentKey}">`;
      } else {
        html += `<div class="json-section-${depth}">`;
      }
    }

    // 헤더/키 출력 + 버튼 출력
    if (parentKey && depth === 0) {
      html += `<div class="json-header">${escapeHtml(parentKey.toUpperCase())}</div>`;
    } else if (parentKey) {
      html += `<div class="json-key-${depth}">${escapeHtml(parentKey)}</div>`;

      // depth 1(= top-level section)에서만 버튼 표시
      if (depth === 1) {
        html += `<button class="category-button" data-section="${escapeHtml(parentKey)}">${BUTTON_LABELS.open}</button>`;
      }
    }

    // content wrapper
    if (depth === 1) {
      html += `<div class="json-content-${depth} hide" id="json-content-${escapeHtml(parentKey)}">`;
    } else {
      html += `<div class="json-content-${depth}">`;
    }

    // 내용 렌더링
    if (typeof json === "object" && json !== null && !Array.isArray(json)) {
      for (const [key, value] of Object.entries(json)) {
        html += generateHTMLFromJSON(value, key, depth + 1);
      }
    } else if (Array.isArray(json)) {
      json.forEach((item, index) => {
        html += `<div class="json-array-index">ITEM ${index + 1}:</div>`;
        html += generateHTMLFromJSON(item, parentKey, depth + 1);
      });
    } else {
      html += `<div class="json-value">${escapeHtml(json)}</div>`;
    }

    // wrapper 닫기
    html += `</div>`;
    if (depth !== 0) html += `</div>`;

    return html;
  }
}
