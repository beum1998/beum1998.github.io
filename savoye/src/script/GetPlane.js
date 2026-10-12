import * as THREE from 'three';

export function GetPlanes(box, scene) {
    let box3;

    if (Array.isArray(box)) {
        box3 = new THREE.Box3();
        box.forEach(b => {
            const tempBox = new THREE.Box3().setFromObject(b);
            box3.union(tempBox);
        });
    } else {
        box3 = new THREE.Box3().setFromObject(box);
    }
    const min = box3.min;
    const max = box3.max;
    const offset = 0.01;
    const planes = [
        new THREE.Plane(new THREE.Vector3(1, 0, 0), -max.x - offset),  // 오른쪽 (X+)
        new THREE.Plane(new THREE.Vector3(-1, 0, 0), min.x - offset),   // 왼쪽 (X-)
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -max.y - offset),  // 위쪽 (Y+)
        new THREE.Plane(new THREE.Vector3(0, -1, 0), min.y - offset),   // 아래쪽 (Y-)
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -max.z - offset),  // 앞쪽 (Z+)
        new THREE.Plane(new THREE.Vector3(0, 0, -1), min.z - offset)    // 뒤쪽 (Z-)
    ];

    const inversePlanes = GetInversePlanes(planes);

    const cons = [];
    const helpers = [];
    const params = {
        planeSize: 3,
        coneSize: { radius: 5, height: 5 }
    }

    for (let i = 0; i < planes.length; i++) {
        const planeHelper = new THREE.PlaneHelper(planes[i], params.planeSize, 0xff0000);
        helpers.push(planeHelper);
        scene.add(planeHelper);

        const center = new THREE.Vector3();

        if (planes[i].normal.x !== 0) {
            center.set(-planes[i].constant * planes[i].normal.x, (min.y + max.y) / 2, (min.z + max.z) / 2);
        } else if (planes[i].normal.y !== 0) {
            center.set((min.x + max.x) / 2, -planes[i].constant * planes[i].normal.y, (min.z + max.z) / 2);
        } else if (planes[i].normal.z !== 0) {
            center.set((min.x + max.x) / 2, (min.y + max.y) / 2, -planes[i].constant * planes[i].normal.z);
        }

        const con = createNormalMarkerAtPlane(planes[i], inversePlanes[i], center, scene);
        cons.push(con);
    }

    return { planes, inversePlanes, cons, helpers };
}

function GetInversePlanes(planes) {
    const inversePlanes = planes.map(plane => {
        const invertedNormal = plane.normal.clone().negate();
        const invertedConstant = -plane.constant;
        return new THREE.Plane(invertedNormal, invertedConstant);
    });

    return inversePlanes;
}

function createNormalMarkerAtPlane(plane, inversePlane, center, scene) {
    const coneGeometry = new THREE.ConeGeometry(0.5, 1, 4);  // 세모(원뿔) 생성
    coneGeometry.computeVertexNormals();
    const coneMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

    const cone = new THREE.Mesh(coneGeometry, coneMaterial);
    cone.receiveShadow = true;
    cone.castShadow = true;

    // 위치 설정 (법선 방향으로 약간 떨어져서 위치)
    const offset = plane.normal.clone().multiplyScalar(0.1);
    cone.position.copy(center).add(offset);

    // 법선 방향을 향하도록 회전 설정
    const up = new THREE.Vector3(0, 1, 0);  // 기본 Y축 방향
    const targetDirection = plane.normal.clone().normalize();  // 평면 법선 방향
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, targetDirection);
    cone.quaternion.copy(quaternion);

    cone.Data= plane;
    cone.Data2 = inversePlane;

    scene.add(cone);
    return cone;  // 필요하면 관리용으로 반환
}