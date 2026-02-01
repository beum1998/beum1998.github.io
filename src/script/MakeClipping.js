export function MakeClipping(latestElem, allGroup, planes, inversePlanes, inside) {
    if (inside) {
        applyClipping(latestElem, planes, true, true);
        applyClipping(allGroup, inversePlanes, false, false);
    } else {
        applyClipping(latestElem, inversePlanes, true, false);
        applyClipping(allGroup, planes, true, true);
    }
}

function applyClipping(groups, clippingPlanes, visible, clipIntersection) {
    for (const group of groups) {
        group.visible = visible;
        for (const object of group.children) {
            if (object.isMesh || object.isLine) {
                object.material.clippingPlanes = clippingPlanes;
                object.material.clipIntersection = clipIntersection;
                object.material.needsUpdate = true;
            }
        }
    }
}