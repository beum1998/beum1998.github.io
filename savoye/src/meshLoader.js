import * as THREE from 'three';

export function loadMeshes(jsonData, scene, scaleFactor = 0.5) {
    const meshDict = {};
    const meshInfoDict = {};
    const allMesh = [];
    const allGroup = [];

    for (const meshes of jsonData) {
        if (meshes.CommandType == "D") continue;
        const meshInfo = meshes.Info;
        const logs = meshes.Meshes;
        const elementId = meshes.Info.Common.ElementId;
        const meshList = [];
        
        const meshGroup = new THREE.Group();
        for (const log of logs) {
            let verticesOri = log.Vertices;
            let vertices = TransformVertex(verticesOri);
            const oriIndices = new Uint16Array(log.Indices);

            let indices = [];
            let indexMap = {};
            for (let i of oriIndices) {
                if (!indexMap.hasOwnProperty(i)) {
                    indices.push(i);
                    indexMap[i] = vertices[i];
                } else {
                    let newVertex = vertices[i];
                    vertices.push(newVertex);
                    indices.push(vertices.length - 1);
                }
            }

            let newVertices = new Float32Array(vertices.flat());
            const newIndices = new Uint16Array(indices);

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.BufferAttribute(newVertices, 3));
            geometry.setIndex(new THREE.BufferAttribute(newIndices, 1));
            geometry.computeVertexNormals();
            geometry.computeBoundingSphere();
            geometry.needsUpdate = true;

            const material = createMaterial(log.Color, log.Transparency);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.scale.set(scaleFactor, scaleFactor, scaleFactor);
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            mesh.visible = true;
            meshGroup.add(mesh);
        }
        scene.add(meshGroup);
        meshGroup.userData = meshes.Info;
        meshGroup.visible = true;
        meshGroup.name = elementId;

        meshDict[elementId] = meshGroup;
        allGroup.push(meshGroup);
    }

    return { allGroup, meshDict }

    function TransformVertex(verticesOri) {
        let vertices = [];
        for (let i = 0; i < verticesOri.length; i += 1) {
            const x = verticesOri[i][0];
            const y = verticesOri[i][2];
            const z = -verticesOri[i][1];
            vertices.push([x, y, z]);
        }

        return vertices;
    }

    function createMaterial(colors, transparency) {
        const color = (colors[0] << 16) | (colors[1] << 8) | colors[2];
        const opacity = 1 - (transparency / 100);

        const material = new THREE.MeshStandardMaterial ({
            color: color,
            opacity: opacity,
            transparent: opacity < 1,
            wireframe: false,
            roughness: 0.6,
            metalness: 0.1,
            side: THREE.DoubleSide,
        });

        return material 
    }
}