import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const blenderGeos = new Map();

export async function loadBlenderAssets() {
  if (blenderGeos.size > 0) return blenderGeos;
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync('./models/assets.glb');
    gltf.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry.clone();
      // Aplica escala/rotação local do nó exportado caso exista
      o.updateMatrix();
      if (!o.matrix.equals(new THREE.Matrix4())) {
        g.applyMatrix4(o.matrix);
      }
      // Normaliza atributo color para 3 componentes Float32 (compatível com mergeGeometries e vertexColors)
      const colAttr = g.getAttribute('color');
      if (colAttr) {
        const count = colAttr.count;
        const rgb = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          rgb[i * 3] = colAttr.getX(i);
          rgb[i * 3 + 1] = colAttr.getY(i);
          rgb[i * 3 + 2] = colAttr.getZ(i);
        }
        g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      }
      // Garante UVs cilíndricas/box caso a malha use textura
      if (!g.getAttribute('uv')) {
        const pos = g.getAttribute('position');
        const uvs = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          uvs[i * 2] = Math.atan2(x, z) / (Math.PI * 2) + 0.5;
          uvs[i * 2 + 1] = y;
        }
        g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      }
      g.computeBoundingBox();
      const bb = g.boundingBox;
      g.parameters = {
        width: Math.max(0.1, bb.max.x - bb.min.x),
        height: Math.max(0.1, bb.max.y - bb.min.y),
        depth: Math.max(0.1, bb.max.z - bb.min.z),
      };
      const cleanName = o.name.replace(/\.\d+$/, '');
      blenderGeos.set(cleanName, g);
    });
  } catch (err) {
    console.warn('Falha ao carregar assets.glb, usando fallback procedural:', err);
  }
  return blenderGeos;
}

export function getBlenderGeo(name) {
  return blenderGeos.get(name) || null;
}
