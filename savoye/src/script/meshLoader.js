import * as THREE from "three";

export function loadMeshes(jsonData, scene, scaleFactor = 0.5) {
    const meshDict = {};
    const allGroup = [];
    const materialCache = new Map();

    if (!Array.isArray(jsonData)) {
        return { allGroup, meshDict };
    }

    for (const meshes of jsonData) {
        if (meshes.CommandType === "D") continue;

        const logs = meshes.Meshes || [];
        const elementId = meshes?.Info?.Common?.ElementId;
        const meshGroup = new THREE.Group();

        for (const log of logs) {
            const { vertices, indices } = buildGeometry(log);
            if (!vertices || !indices) continue;

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
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
        meshGroup.visible = false;
        if (elementId !== undefined) {
            meshGroup.name = elementId;
            meshDict[elementId] = meshGroup;
        }
        allGroup.push(meshGroup);
    }

    return { allGroup, meshDict };

    function transformVertices(verticesOri) {
        const out = new Float32Array(verticesOri.length * 3);
        for (let i = 0; i < verticesOri.length; i += 1) {
            const v = verticesOri[i];
            const base = i * 3;
            out[base] = v[0];
            out[base + 1] = v[2] - 10;
            out[base + 2] = -v[1];
        }
        return out;
    }

    function buildGeometry(log) {
        const verticesOri = log.Vertices || [];
        const indicesOri = log.Indices || [];
        if (!verticesOri.length || !indicesOri.length) {
            return { vertices: null, indices: null };
        }

        const vertices = transformVertices(verticesOri);
        const seen = new Uint8Array(vertices.length / 3);
        const expandedVertices = new Array(vertices.length);
        for (let i = 0; i < vertices.length; i += 1) {
            expandedVertices[i] = vertices[i];
        }

        const expandedIndices = new Array(indicesOri.length);
        for (let i = 0; i < indicesOri.length; i += 1) {
            const index = indicesOri[i];
            if (seen[index] === 0) {
                seen[index] = 1;
                expandedIndices[i] = index;
                continue;
            }
            const base = index * 3;
            expandedVertices.push(vertices[base], vertices[base + 1], vertices[base + 2]);
            expandedIndices[i] = expandedVertices.length / 3 - 1;
        }

        const finalVertices = new Float32Array(expandedVertices);
        const indexArrayType = finalVertices.length / 3 > 65535 ? Uint32Array : Uint16Array;
        const finalIndices = new indexArrayType(expandedIndices);
        return { vertices: finalVertices, indices: finalIndices };
    }

    function createMaterial(colors = [200, 200, 200], transparency = 0) {
        const color = (colors[0] << 16) | (colors[1] << 8) | colors[2];
        const opacity = 1 - transparency / 100;
        const key = `${color}-${opacity}`;

        if (materialCache.has(key)) {
            return materialCache.get(key);
        }

        const material = new THREE.MeshStandardMaterial({
            color,
            opacity,
            transparent: opacity < 1,
            wireframe: false,
            roughness: 0.6,
            metalness: 0.1,
            side: THREE.DoubleSide,
        });

        materialCache.set(key, material);
        return material;
    }
}