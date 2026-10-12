import * as THREE from 'three';

export function SelectCat(scene) {
    const categoryButtons = [
        { id: "wall-select", category: "Walls" },
        { id: "curtainWall-select", category: "Curtain Walls" },
        { id: "floor-select", category: "Floors" },
        { id: "ceiling-select", category: "Ceilings" },
        { id: "column-select", category: "Columns" },
        { id: "structuralColumn-select", category: "Structural Columns" },
        { id: "stair-select", category: "Stairs" },
        { id: "railing-select", category: "Railings" },
        { id: "window-select", category: "Windows" },
        { id: "door-select", category: "Doors" }
    ];

    let visibilityState = {};

    categoryButtons.forEach(({ id, category }) => {
        const button = document.getElementById(id);
        visibilityState[category] = { visible: true, objects: [] }; // 초기 상태 설정
    
        button.addEventListener("click", () => {
            toggleCategoryVisibility(button, category);
        });
    });

    function toggleCategoryVisibility(button, category) {
        if (visibilityState[category].visible) {
            button.style.background = "black";
            visibilityState[category].objects = [];
    
            scene.traverse((object) => {
                if (object.visible && object instanceof THREE.Group) {
                    if (object.userData.Common.ElementCategory === category) {
                        object.visible = false;

                        visibilityState[category].objects.push(object);
                    }
                }
            });
    
            visibilityState[category].visible = false;
        } else {
            button.style.background = "#1e90ff";
            visibilityState[category].objects.forEach((obj) => {
                obj.visible = true;
            });
    
            visibilityState[category].visible = true;
            visibilityState[category].objects = [];
        }
    }
}