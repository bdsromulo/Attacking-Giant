import * as THREE from 'three';
import { rand, pick } from './util.js';
import { getRaotGeo } from './raot_meshes.js';
import { getBlenderGeo } from './assets.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.04, ...opts }));
  }
  return matCache.get(key);
}

let vcolClothMat = null;
let vcolGearMat = null;
let vcolBladeMat = null;

function getRaotClothMat() {
  if (!vcolClothMat) {
    vcolClothMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.66,
      metalness: 0.04,
    });
  }
  return vcolClothMat;
}

function getRaotGearMat() {
  if (!vcolGearMat) {
    vcolGearMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.34,
      metalness: 0.58,
    });
  }
  return vcolGearMat;
}

function getRaotBladeMat() {
  if (!vcolBladeMat) {
    vcolBladeMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.16,
      metalness: 0.86,
      emissive: new THREE.Color('#203040'),
      emissiveIntensity: 0.55,
    });
  }
  return vcolBladeMat;
}

const GEAR_PARTS = new Set(['odm_gear', 'sword_handle', 'apg_gun', 'thunder_spear']);

function raotMesh(partName, x = 0, y = 0, z = 0, isBlade = false) {
  const geo = getRaotGeo(partName);
  const material = isBlade ? getRaotBladeMat() : (GEAR_PARTS.has(partName) ? getRaotGearMat() : getRaotClothMat());
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Cache de geometrias espelhadas em X com winding/normais corretos (evita matriz de escala negativa)
const mirroredCache = new Map();
function mirrorXGeo(geo) {
  if (mirroredCache.has(geo)) return mirroredCache.get(geo);
  const g = geo.clone();
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i));
    if (nrm) nrm.setX(i, -nrm.getX(i));
  }
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = tmp;
    }
    g.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const attr = g.attributes[name];
      const item = attr.itemSize;
      const arr = attr.array;
      for (let i = 0; i < pos.count; i += 3) {
        for (let c = 0; c < item; c++) {
          const i1 = (i + 1) * item + c;
          const i2 = (i + 2) * item + c;
          const tmp = arr[i1];
          arr[i1] = arr[i2];
          arr[i2] = tmp;
        }
      }
      attr.needsUpdate = true;
    }
  }
  g.parameters = { ...geo.parameters };
  mirroredCache.set(geo, g);
  return g;
}

function withWhiteVertexColors(geo) {
  if (!geo.getAttribute('color')) {
    const n = geo.attributes.position.count;
    const cols = new Float32Array(n * 3);
    cols.fill(0.95);
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  return geo;
}

export function boxMesh(sx, sy, sz, material, x = 0, y = 0, z = 0) {
  const geo = withWhiteVertexColors(new THREE.BoxGeometry(sx, sy, sz));
  geo.parameters = { width: sx, height: sy, depth: sz };
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function sculptedEllipsoid(sx, sy, sz, material, x = 0, y = 0, z = 0, deformFn = null, segU = 18, segV = 14) {
  const geo = new THREE.SphereGeometry(0.5, segU, segV);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let vx = pos.getX(i) * sx;
    let vy = pos.getY(i) * sy;
    let vz = pos.getZ(i) * sz;
    if (deformFn) {
      const r = deformFn(vx, vy, vz, sx, sy, sz);
      vx = r[0]; vy = r[1]; vz = r[2];
    }
    pos.setXYZ(i, vx, vy, vz);
  }
  geo.computeVertexNormals();
  withWhiteVertexColors(geo);
  geo.parameters = { width: sx, height: sy, depth: sz };
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function sculptedCapsule(rxTop, rxBot, sy, rzTop, rzBot, material, x = 0, y = 0, z = 0, profileFn = null, segR = 22, segY = 18, roundness = 0.28) {
  const geo = new THREE.SphereGeometry(0.5, segR, segY);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const sx0 = pos.getX(i) * 2;
    const sy0 = pos.getY(i) * 2;
    const sz0 = pos.getZ(i) * 2;
    const rHoriz = Math.hypot(sx0, sz0);
    const px = rHoriz > 1e-5 ? sx0 / rHoriz : 0;
    const pz = rHoriz > 1e-5 ? sz0 / rHoriz : 0;
    const ny = Math.sign(sy0) * Math.pow(Math.abs(sy0), 0.62);
    const u = (ny + 1) * 0.5;
    const cap = Math.pow(Math.max(0, rHoriz), roundness);
    const rx = (rxBot + (rxTop - rxBot) * u) * cap;
    const rz = (rzBot + (rzTop - rzBot) * u) * cap;
    let vx = px * rx;
    let vy = ny * (sy * 0.5);
    let vz = pz * rz;
    if (profileFn) {
      const r = profileFn(u, vx, vy, vz, px, pz, cap);
      vx = r[0]; vy = r[1]; vz = r[2];
    }
    pos.setXYZ(i, vx, vy, vz);
  }
  geo.computeVertexNormals();
  withWhiteVertexColors(geo);
  const maxW = Math.max(rxTop, rxBot) * 2;
  const maxD = Math.max(rzTop, rzBot) * 2;
  geo.parameters = { width: maxW, height: sy, depth: maxD };
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function sculptedArmorPlate(sx, sy, sz, material, x = 0, y = 0, z = 0, curveZ = 0.12) {
  return sculptedCapsule(sx * 0.48, sx * 0.5, sy, sz * 0.48, sz * 0.5, material, x, y, z, (u, vx, vy, vz) => {
    const nx = vx / (sx * 0.5 || 1);
    const bend = -nx * nx * curveZ;
    return [vx, vy, vz + bend];
  }, 16, 12, 0.20);
}

// ================= JOGADOR (MALHAS 3D DO RAoT + SOMBREAMENTO PBR ESTILIZADO) =================
export const SKINS = {
  vanguarda: { name: 'Eren (Vanguarda)', char: 'eren', jacket: '#7a5434', pants: '#e4ddcd', cape: '#284632', hair: '#3b261c', boots: '#3a261a', trim: '#d8cfc0' },
  batedor:   { name: 'Erwin (Batedor)',  char: 'erwin', jacket: '#7a5434', pants: '#e4ddcd', cape: '#24402d', hair: '#c59b47', boots: '#3a261a', trim: '#d8cfc0' },
  guarda:    { name: 'Mikasa (Guarda)',  char: 'mikasa', jacket: '#7a5434', pants: '#e4ddcd', cape: '#284632', hair: '#18181c', boots: '#3a261a', trim: '#9e2626' },
  sombra:    { name: 'Levi (Sombra)',    char: 'levi', jacket: '#7a5434', pants: '#e4ddcd', cape: '#1f3827', hair: '#16161a', boots: '#3a261a', trim: '#e6e4df' },
  aurora:    { name: 'Armin (Aurora)',   char: 'armin', jacket: '#7a5434', pants: '#e4ddcd', cape: '#2c4d37', hair: '#d2a648', boots: '#3a261a', trim: '#d8cfc0' },
};

export function buildPlayerModel(skinKey = 'vanguarda') {
  const S = SKINS[skinKey] || SKINS.vanguarda;
  const ch = S.char || 'eren';
  const g = new THREE.Group();

  const root = new THREE.Group();
  root.scale.setScalar(0.98);
  g.add(root);

  const hips = new THREE.Group();
  hips.position.set(0, 0.01, 0);
  root.add(hips);
  hips.add(raotMesh('hips'));
  const odmGear = raotMesh('odm_gear', 0, -0.02, -0.02);
  hips.add(odmGear);

  const torso = new THREE.Group();
  torso.position.set(0, 0.10, 0.009);
  hips.add(torso);
  torso.add(raotMesh('jacket'));
  torso.add(raotMesh(`shirt_${ch}`));

  const head = new THREE.Group();
  head.position.set(0, 0.46, -0.044);
  torso.add(head);
  head.add(raotMesh(`head_${ch}`));

  const armL = new THREE.Group();
  armL.position.set(0.115, 0.335, -0.050);
  torso.add(armL);
  armL.add(raotMesh('armL'));

  const foreL = new THREE.Group();
  foreL.position.set(0, -0.233, 0.006);
  armL.add(foreL);
  foreL.add(raotMesh('foreL'));

  const armR = new THREE.Group();
  armR.position.set(-0.115, 0.335, -0.050);
  torso.add(armR);
  armR.add(raotMesh('armR'));

  const foreR = new THREE.Group();
  foreR.position.set(0, -0.233, 0.006);
  armR.add(foreR);
  foreR.add(raotMesh('foreR'));

  // 1. Lâminas ODM com aço polido + marcadores de base/ponta para trilha de corte
  const bladeL = new THREE.Group();
  bladeL.position.set(0, -0.22, 0.01);
  foreL.add(bladeL);
  bladeL.add(raotMesh('sword_handle'));
  const bLm = raotMesh('sword_blade', 0, 0, 0, true);
  bladeL.add(bLm);
  const baseL = new THREE.Object3D();
  baseL.position.set(0, 0, 0.14);
  const tipL = new THREE.Object3D();
  tipL.position.set(0, 0, 0.96);
  bladeL.add(baseL, tipL);

  const bladeR = new THREE.Group();
  bladeR.position.set(0, -0.22, 0.01);
  foreR.add(bladeR);
  bladeR.add(raotMesh('sword_handle'));
  const bRm = raotMesh('sword_blade', 0, 0, 0, true);
  bladeR.add(bRm);
  const baseR = new THREE.Object3D();
  baseR.position.set(0, 0, 0.14);
  const tipR = new THREE.Object3D();
  tipR.position.set(0, 0, 0.96);
  bladeR.add(baseR, tipR);

  // 2. Pistolas APG
  const apgL = new THREE.Group();
  apgL.position.set(0, -0.22, 0.01);
  apgL.visible = false;
  foreL.add(apgL);
  apgL.add(raotMesh('apg_gun'));

  const apgR = new THREE.Group();
  apgR.position.set(0, -0.22, 0.01);
  apgR.visible = false;
  foreR.add(apgR);
  apgR.add(raotMesh('apg_gun'));

  // 3. Lanças do Trovão
  const spearL = new THREE.Group();
  spearL.position.set(0.06, -0.13, 0.02);
  spearL.visible = false;
  foreL.add(spearL);
  spearL.add(raotMesh('thunder_spear'));

  const spearR = new THREE.Group();
  spearR.position.set(-0.06, -0.13, 0.02);
  spearR.visible = false;
  foreR.add(spearR);
  spearR.add(raotMesh('thunder_spear'));

  // Pernas e Botas
  const legL = new THREE.Group();
  legL.position.set(0.076, 0.003, -0.004);
  hips.add(legL);
  legL.add(raotMesh('legL'));

  const shinL = new THREE.Group();
  shinL.position.set(0.004, -0.435, 0);
  legL.add(shinL);
  shinL.add(raotMesh('shinL'));

  const legR = new THREE.Group();
  legR.position.set(-0.076, 0.003, -0.004);
  hips.add(legR);
  legR.add(raotMesh('legR'));

  const shinR = new THREE.Group();
  shinR.position.set(-0.004, -0.435, 0);
  legR.add(shinR);
  shinR.add(raotMesh('shinR'));

  const footL = new THREE.Object3D(); footL.position.set(0, -0.46, 0.04); shinL.add(footL);
  const footR = new THREE.Object3D(); footR.position.set(0, -0.46, 0.04); shinR.add(footR);

  const launcherL = new THREE.Object3D(); launcherL.position.set(0.21, 0.04, -0.06); hips.add(launcherL);
  const launcherR = new THREE.Object3D(); launcherR.position.set(-0.21, 0.04, -0.06); hips.add(launcherR);
  const nozzle = new THREE.Object3D(); nozzle.position.set(0, 0.02, -0.24); hips.add(nozzle);

  const cape = new THREE.Group();
  cape.position.set(0, 0.36, -0.09);
  torso.add(cape);
  const cape2p = new THREE.Group();
  cape.add(cape2p);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return {
    group: g, root, hips, torso, head, cape, cape2: cape2p, odmGear,
    armL, armR, foreL, foreR,
    legL, legR, shinL, shinR, footL, footR,
    bladeL, bladeR, bladeMeshes: [bLm, bRm], bladeBases: [baseL, baseR], bladeTips: [tipL, tipR],
    apgL, apgR, spearL, spearR, launcherL, launcherR, nozzle,
  };
}

// ================= GIGANTES / TITÃS (ESCULPIDOS NO BLENDER 5.2 + RIG DE COMBATE) =================
const SKIN_TONES = ['#dfa890', '#d6997f', '#cc8e74', '#be7f65', '#e7baa2', '#b3745b', '#dca68c', '#c8866e', '#ecc4aa'];
const HAIR = ['#1f1510', '#3d2618', '#5e3f22', '#141418', '#75583c', '#2e2019', '#7d3426'];
const IRIS_COLORS = ['#6f967d', '#96784c', '#587c96', '#824f3e', '#9e916d', '#7da09c'];

function blenderOrFallback(name, material, fallbackFn, mirrorX = false) {
  const bGeo = getBlenderGeo(name);
  if (bGeo) {
    const geo = mirrorX ? mirrorXGeo(bGeo) : bGeo;
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    return m;
  }
  return fallbackFn();
}

export function buildGiantModel(opts = {}) {
  const isColossus = !!opts.boss;
  const isArmored = !!opts.armored;
  const isDummy = !!opts.dummy;

  const baseTone = isColossus ? '#a6362c' : (isArmored ? '#963b32' : (opts.skin || pick(SKIN_TONES)));
  const skinC = new THREE.Color(baseTone);
  const skin = new THREE.MeshStandardMaterial({
    color: skinC,
    vertexColors: true,
    roughness: isColossus ? 0.56 : 0.68,
    metalness: 0.02,
  });
  const skinDark = new THREE.MeshStandardMaterial({
    color: skinC.clone().multiplyScalar(isColossus ? 0.72 : 0.80),
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.02,
  });
  const muscleSinew = new THREE.MeshStandardMaterial({
    color: isColossus || isArmored ? '#dfd0c2' : skinC.clone().multiplyScalar(0.88),
    vertexColors: true,
    roughness: 0.55,
  });
  const napeMat = new THREE.MeshStandardMaterial({
    color: skinC.clone().multiplyScalar(0.84).lerp(new THREE.Color('#b83c3c'), 0.18),
    vertexColors: true,
    roughness: 0.68,
  });

  const fat = opts.fat ?? rand(0.92, 1.22);
  const headS = opts.headScale ?? rand(0.94, 1.16);
  const armLen = opts.armLen ?? rand(0.94, 1.12);
  const legLen = opts.legLen ?? rand(0.94, 1.08);

  const root = new THREE.Group();
  const hipH = 4.82 * legLen;
  const body = new THREE.Group();
  body.position.y = hipH;
  root.add(body);
  const meshes = [];
  const add = (parent, m, zone = 'body') => {
    parent.add(m);
    m.userData.zone = zone;
    meshes.push(m);
    return m;
  };

  // 1. Pelve anatômica esculpida no Blender (transição contínua com oblíquos e coxas)
  const fatW = 0.96 + (fat - 1) * 0.42;
  const pelvis = blenderOrFallback('titan_pelvis', skin, () =>
    sculptedCapsule(1.06 * fatW, 0.98 * fatW, 1.32, 0.74 * fatW, 0.70 * fatW, skin, 0, 0.24, 0)
  );
  pelvis.position.y = 0.28;
  pelvis.scale.set(0.84 * fatW, 0.90, 0.86 * fatW);
  add(body, pelvis);

  // 2. Tronco muscular esculpido no Blender (peitorais, abdômen, costelas, dorsais e sulco vertebral)
  const spine = new THREE.Group();
  spine.position.y = 0.44;
  body.add(spine);

  const torsoMesh = blenderOrFallback('titan_torso', skin, () =>
    sculptedCapsule(1.58, 1.24 * fatW, 3.75, 0.90, 0.82 * fatW, skin, 0, 1.68, 0.02)
  );
  torsoMesh.scale.set(1.06 * fatW, 1.04, 1.02 * fatW);
  add(spine, torsoMesh);

  // Trapézio muscular conectando ombros, clavículas e base do pescoço
  add(spine, sculptedCapsule(0.50, 1.12 * fatW, 0.90, 0.44, 0.74 * fatW, skin, 0, 3.24, -0.02, null, 18, 12, 0.28));

  if (isColossus) {
    for (let r = 0; r < 5; r++) {
      for (const s of [-1, 1]) {
        const rib = sculptedCapsule(0.075, 0.075, 0.92, 0.11, 0.11, muscleSinew, s * 0.68, 1.42 + r * 0.28, 0.76);
        rib.rotation.z = Math.PI * 0.5 + s * 0.15;
        add(spine, rib);
      }
    }
    // Tendões peitorais e claviculares aparentes no Colosso
    for (const s of [-1, 1]) {
      const clav = sculptedCapsule(0.09, 0.08, 1.25, 0.11, 0.10, muscleSinew, s * 0.72, 3.12, 0.58);
      clav.rotation.z = Math.PI * 0.5 - s * 0.14;
      add(spine, clav);
    }
  }

  // 3. Pescoço muscular e Ponto Fraco da Nuca (zone = 'nape')
  const neck = new THREE.Group();
  neck.position.y = 3.30;
  spine.add(neck);
  add(neck, sculptedCapsule(0.52, 0.66, 0.92, 0.48, 0.60, skin, 0, 0.18, 0.02, null, 18, 12, 0.26));

  const nape = add(neck, sculptedCapsule(0.46, 0.50, 0.86, 0.24, 0.26, napeMat, 0, 0.30, -0.44, null, 16, 10, 0.28), 'nape');

  if (isDummy) {
    const padGeo = withWhiteVertexColors(getRaotGeo('strike_pad').clone());
    padGeo.parameters = { width: 1.0, height: 1.0, depth: 0.45 };
    const padMesh = new THREE.Mesh(padGeo, getRaotClothMat());
    padMesh.position.set(0, 0.32, -0.58);
    padMesh.castShadow = true;
    add(neck, padMesh, 'nape');
  }

  // 4. Cabeça craniofacial esculpida no Blender + Arcada dentária recuada interna
  const head = new THREE.Group();
  head.position.y = 0.40;
  head.scale.setScalar(headS);
  neck.add(head);

  const headMesh = blenderOrFallback('titan_head', skin, () =>
    sculptedCapsule(0.95, 0.76, 2.06, 0.96, 0.82, skin, 0, 1.02, 0.06)
  );
  add(head, headMesh);

  const teethMat = new THREE.MeshStandardMaterial({
    color: '#f2ead8',
    vertexColors: true,
    roughness: 0.36,
    metalness: 0.04,
  });
  const teethMesh = blenderOrFallback('titan_teeth', teethMat, () =>
    sculptedCapsule(0.44, 0.44, 0.20, 0.08, 0.08, teethMat, 0, 0.46, 0.72)
  );
  add(head, teethMesh);

  // Olhos fundos sob o arco superciliar esculpido (zone = 'eyes')
  const eyeW = mat('#ede7da', { roughness: 0.32 });
  const irisM = mat(isColossus || isArmored ? '#f5c858' : pick(IRIS_COLORS), {
    roughness: 0.25,
    emissive: isColossus || isArmored ? '#7a5010' : '#000000',
  });
  const pupil = mat('#0d0a0a', { roughness: 0.2 });
  const socketM = mat('#1e0e0d', { roughness: 0.9 });
  const eyeSize = rand(0.22, 0.27);
  const eyes = new THREE.Group();
  eyes.position.set(0, 1.24, 0.72);
  head.add(eyes);

  for (const s of [-1, 1]) {
    // Sombra orbital (width >= 0.38 para lungeTarget)
    add(eyes, sculptedEllipsoid(0.40, 0.25, 0.14, socketM, s * 0.42, 0, -0.02), 'eyes');
    add(eyes, sculptedEllipsoid(eyeSize * 1.12, eyeSize * 0.78, 0.14, eyeW, s * 0.42, 0, 0.03), 'eyes');
    const gx = s * 0.42 + rand(-0.015, 0.015);
    const gy = rand(-0.01, 0.01);
    add(eyes, sculptedEllipsoid(eyeSize * 0.45, eyeSize * 0.45, 0.11, irisM, gx, gy, 0.075), 'eyes');
    add(eyes, sculptedEllipsoid(eyeSize * 0.22, eyeSize * 0.22, 0.12, pupil, gx, gy, 0.09), 'eyes');
  }

  // Cabelo estilizado de Titã (variedade de cortes inspirados no anime)
  if (!isColossus && opts.hair !== false && (isArmored || Math.random() < 0.85)) {
    const hm = isArmored
      ? mat('#ddd4be', { roughness: 0.75 })
      : mat(pick(HAIR), { roughness: 0.78 });
    const style = isArmored ? 2 : Math.floor(rand(0, 4));
    add(head, sculptedEllipsoid(2.00, 1.14, 2.02, hm, 0, 1.58, -0.05, (vx, vy, vz) => {
      if (vz > 0.32 && vy < 0.14) return [vx * 0.94, vy + 0.20, vz * 0.80];
      return [vx, vy, vz];
    }, 22, 16));
    if (style >= 1) {
      add(head, sculptedCapsule(0.92, 0.80, 1.18, 0.56, 0.44, hm, 0, 1.02, -0.50, null, 16, 10, 0.28));
    }
    if (style >= 2) {
      for (const s of [-1, 1]) {
        const sideLock = sculptedCapsule(0.17, 0.07, 0.98, 0.38, 0.22, hm, s * 0.89, 1.16, 0.18);
        sideLock.rotation.z = -s * 0.13;
        add(head, sideLock);
      }
    }
    if (style === 3) {
      // Franja irregular caindo na testa
      for (let b = -2; b <= 2; b++) {
        const bang = sculptedCapsule(0.12, 0.04, 0.58, 0.12, 0.06, hm, b * 0.24, 1.62, 0.82);
        bang.rotation.x = 0.32;
        bang.rotation.z = b * -0.08;
        add(head, bang);
      }
    }
  }

  // 5. Braços e Mãos esculpidos no Blender
  const arms = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const mirror = side === 'R';
    const sh = new THREE.Group();
    sh.position.set(s * 1.40 * fatW, 3.12, 0);
    spine.add(sh);

    const uLen = 2.4 * armLen;
    const uArm = blenderOrFallback('titan_upper_arm', skin, () =>
      sculptedCapsule(0.54, 0.40, 2.56, 0.54, 0.40, skin, 0, -1.14, 0), mirror
    );
    uArm.scale.set(1, armLen, 1);
    add(sh, uArm, 'arm' + side);

    const elbow = new THREE.Group();
    elbow.position.y = -uLen;
    sh.add(elbow);

    const fLen = 2.2 * armLen;
    const fArm = blenderOrFallback('titan_forearm', skin, () =>
      sculptedCapsule(0.42, 0.29, 2.32, 0.41, 0.27, skin, 0, -1.06, 0), mirror
    );
    fArm.scale.set(1, armLen, 1);
    add(elbow, fArm, 'arm' + side);

    const hand = new THREE.Group();
    hand.position.y = -fLen;
    elbow.add(hand);

    const handMesh = blenderOrFallback('titan_hand', skinDark, () =>
      sculptedCapsule(0.36, 0.38, 0.92, 0.20, 0.18, skinDark, 0, -0.45, 0.02), mirror
    );
    add(hand, handMesh, 'arm' + side);

    arms[side] = { shoulder: sh, elbow, hand };
  }

  // 6. Pernas e Pés esculpidos no Blender
  const legs = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const mirror = side === 'R';
    const hip = new THREE.Group();
    hip.position.set(s * 0.64 * fatW, 0.08, 0);
    body.add(hip);

    const tLen = 2.4 * legLen;
    const thigh = blenderOrFallback('titan_thigh', skin, () =>
      sculptedCapsule(0.72, 0.50, 2.58, 0.74, 0.52, skin, 0, -1.15, 0), mirror
    );
    thigh.scale.set(0.95 * fatW, legLen, 0.95 * fatW);
    add(hip, thigh, 'leg' + side);

    const knee = new THREE.Group();
    knee.position.y = -tLen;
    hip.add(knee);

    const cLen = 2.2 * legLen;
    const calf = blenderOrFallback('titan_calf', skin, () =>
      sculptedCapsule(0.51, 0.35, 2.32, 0.52, 0.37, skin, 0, -1.06, 0), mirror
    );
    calf.scale.set(1, legLen, 1);
    add(knee, calf, 'leg' + side);

    const foot = blenderOrFallback('titan_foot', skinDark, () =>
      sculptedEllipsoid(1.04, 0.52, 1.82, skinDark, 0, -0.10, 0.30), mirror
    );
    foot.position.y = -cLen;
    add(knee, foot, 'leg' + side);

    legs[side] = { hip, knee };
  }

  // 7. Couraça / Placas Ósseas Endurecidas (Titã Blindado)
  const armor = [];
  if (isArmored) {
    const plate = new THREE.MeshStandardMaterial({ color: '#dfd7c5', vertexColors: true, roughness: 0.42, metalness: 0.12 });
    const plateDark = new THREE.MeshStandardMaterial({ color: '#beb5a2', vertexColors: true, roughness: 0.48, metalness: 0.10 });
    armor.push(add(neck, sculptedArmorPlate(1.24, 1.06, 0.34, plate, 0, 0.34, -0.58, -0.08), 'nape'));
    armor.push(add(spine, sculptedArmorPlate(1.50, 1.18, 0.34, plate, 0.70, 2.65, 0.88, 0.10)));
    armor.push(add(spine, sculptedArmorPlate(1.50, 1.18, 0.34, plate, -0.70, 2.65, 0.88, 0.10)));
    armor.push(add(spine, sculptedArmorPlate(2.72, 0.88, 0.30, plateDark, 0, 1.35, 0.82, 0.14)));
    armor.push(add(spine, sculptedArmorPlate(3.08, 1.38, 0.32, plate, 0, 2.65, -0.86, -0.14)));
    for (const s of [-1, 1]) {
      const side = s > 0 ? 'L' : 'R';
      armor.push(add(arms[side].shoulder, sculptedArmorPlate(1.20, 0.98, 1.20, plate, s * 0.08, -0.35, 0, 0.08)));
      armor.push(add(arms[side].elbow, sculptedArmorPlate(0.90, 1.42, 0.90, plateDark, 0, -0.95, 0.10, 0.06)));
      armor.push(add(legs[side].hip, sculptedArmorPlate(1.34, 1.52, 0.40, plate, 0, -1.1, 0.58, 0.10)));
      armor.push(add(legs[side].knee, sculptedArmorPlate(1.16, 1.48, 0.36, plate, 0, -0.95, 0.52, 0.08)));
    }
    armor.push(add(head, sculptedArmorPlate(1.90, 0.68, 0.30, plate, 0, 1.66, 0.88, 0.12)));
    armor.push(add(head, sculptedArmorPlate(1.50, 0.44, 0.32, plateDark, 0, 0.24, 0.82, 0.10)));
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { root, body, spine, neck, head, eyes, nape, arms, legs, meshes, armor, skinMat: skin, napeMat, hipH };
}
