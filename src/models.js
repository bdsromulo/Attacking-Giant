import * as THREE from 'three';
import { rand, pick } from './util.js';
import { getRaotGeo } from './raot_meshes.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return matCache.get(key);
}

let vcolMat = null;
let vcolBladeMat = null;
function getRaotMat(emissive = '#000000') {
  if (emissive !== '#000000') {
    if (!vcolBladeMat) vcolBladeMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive });
    return vcolBladeMat;
  }
  if (!vcolMat) vcolMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return vcolMat;
}

function raotMesh(partName, x = 0, y = 0, z = 0, emissive = '#000000') {
  const geo = getRaotGeo(partName);
  const m = new THREE.Mesh(geo, getRaotMat(emissive));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function boxMesh(sx, sy, sz, material, x = 0, y = 0, z = 0) {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  geo.parameters = { width: sx, height: sy, depth: sz };
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Elipsoide orgânico com deformação suave.
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
  geo.parameters = { width: sx, height: sy, depth: sz };
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Super-cápsula anatômica contínua sem costura de tampa (malha única de polo a polo com corpo cilíndrico e pontas arredondadas).
export function sculptedCapsule(rxTop, rxBot, sy, rzTop, rzBot, material, x = 0, y = 0, z = 0, profileFn = null, segR = 22, segY = 18, roundness = 0.28) {
  const geo = new THREE.SphereGeometry(0.5, segR, segY);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const sx0 = pos.getX(i) * 2;
    const sy0 = pos.getY(i) * 2; // cos(phi): -1 .. +1
    const sz0 = pos.getZ(i) * 2;
    const rHoriz = Math.hypot(sx0, sz0); // sin(phi): 0 nos polos, 1 no equador
    const px = rHoriz > 1e-5 ? sx0 / rHoriz : 0;
    const pz = rHoriz > 1e-5 ? sz0 / rHoriz : 0;

    // Super-elipsoide suave: mantém raio cheio ao longo do cilindro e curva suavemente nos polos sem quina!
    const ny = Math.sign(sy0) * Math.pow(Math.abs(sy0), 0.62); // -1 .. +1
    const u = (ny + 1) * 0.5; // 0 (base) .. 1 (topo)
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
  const maxW = Math.max(rxTop, rxBot) * 2;
  const maxD = Math.max(rzTop, rzBot) * 2;
  geo.parameters = { width: maxW, height: sy, depth: maxD };
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Placa de armadura chanfrada e curvada (Blindado / Couraça).
function sculptedArmorPlate(sx, sy, sz, material, x = 0, y = 0, z = 0, curveZ = 0.12) {
  return sculptedCapsule(sx * 0.48, sx * 0.5, sy, sz * 0.48, sz * 0.5, material, x, y, z, (u, vx, vy, vz) => {
    const nx = vx / (sx * 0.5 || 1);
    const bend = -nx * nx * curveZ;
    return [vx, vy, vz + bend];
  }, 16, 12, 0.22);
}

// ================= JOGADOR (MALHAS 3D REAIS DO RAoT) =================
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

  // Quadril + Equipamento ODM 3D real do RAoT
  const hips = new THREE.Group();
  hips.position.set(0, 0.01, 0);
  root.add(hips);
  hips.add(raotMesh('hips'));
  hips.add(raotMesh('odm_gear', 0, -0.02, -0.02));

  // Tronco (Jaqueta da Tropa de Exploração com Asas da Liberdade + Camisa/Cachecol/Gravata do personagem do RAoT)
  const torso = new THREE.Group();
  torso.position.set(0, 0.10, 0.009);
  hips.add(torso);
  torso.add(raotMesh('jacket'));
  torso.add(raotMesh(`shirt_${ch}`));

  // Cabeça + Cabelo esculpido do personagem do RAoT
  const head = new THREE.Group();
  head.position.set(0, 0.46, -0.044);
  torso.add(head);
  head.add(raotMesh(`head_${ch}`));

  // Braços e Antebraços articulados do RAoT
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

  // 1. Cabos de espada e lâminas (geo_3dmg_handle + geo_3dmg_blade_perfect do RAoT)
  const bladeL = new THREE.Group();
  bladeL.position.set(0, -0.22, 0.01);
  foreL.add(bladeL);
  bladeL.add(raotMesh('sword_handle'));
  const bLm = raotMesh('sword_blade', 0, 0, 0, '#1c2228');
  bladeL.add(bLm);

  const bladeR = new THREE.Group();
  bladeR.position.set(0, -0.22, 0.01);
  foreR.add(bladeR);
  bladeR.add(raotMesh('sword_handle'));
  const bRm = raotMesh('sword_blade', 0, 0, 0, '#1c2228');
  bladeR.add(bRm);

  // 2. Pistolas APG (apg_gun_handle + apg_gun_cannister do RAoT)
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

  // 3. Lanças do Trovão (geo_ts_spear do RAoT)
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

  // Pernas e Botas articuladas do RAoT
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

  // Pontos de origem dos ganchos e do bocal de gás no equipamento ODM do RAoT
  const launcherL = new THREE.Object3D(); launcherL.position.set(0.21, 0.04, -0.06); hips.add(launcherL);
  const launcherR = new THREE.Object3D(); launcherR.position.set(-0.21, 0.04, -0.06); hips.add(launcherR);
  const nozzle = new THREE.Object3D(); nozzle.position.set(0, 0.02, -0.24); hips.add(nozzle);

  // No RAoT os personagens usam a jaqueta curta da Tropa de Exploração com as Asas da Liberdade diretamente nas costas
  const cape = new THREE.Group();
  cape.position.set(0, 0.36, -0.09);
  torso.add(cape);
  const cape2p = new THREE.Group();
  cape.add(cape2p);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return {
    group: g, root, hips, torso, head, cape, cape2: cape2p,
    armL, armR, foreL, foreR,
    legL, legR, shinL, shinR,
    bladeL, bladeR, bladeMeshes: [bLm, bRm], apgL, apgR, spearL, spearR, launcherL, launcherR, nozzle,
  };
}

// ================= GIGANTES / TITÃS (MALHA ANATÔMICA CONTÍNUA) =================
const SKIN_TONES = ['#e0a890', '#d4967c', '#c98c72', '#b97a5f', '#e8b9a0', '#a86b52', '#d9a48a', '#c4826a', '#edc2a8'];
const HAIR = ['#241811', '#422a1b', '#634324', '#161618', '#7d5f42', '#33241d', '#8c3b2b'];
const IRIS_COLORS = ['#6b8e78', '#8a6f48', '#52738c', '#7a4a3a', '#948868'];

// Construído para 10m de altura e escalado. Gigante olha para +Z.
export function buildGiantModel(opts = {}) {
  const isColossus = !!opts.boss;
  const isArmored = !!opts.armored;
  const isDummy = !!opts.dummy;

  const baseTone = isColossus ? '#9e342c' : (isArmored ? '#8c3830' : (opts.skin || pick(SKIN_TONES)));
  const skinC = new THREE.Color(baseTone);
  const skin = new THREE.MeshLambertMaterial({ color: skinC });
  const skinDark = new THREE.MeshLambertMaterial({
    color: skinC.clone().multiplyScalar(isColossus ? 0.72 : 0.8),
  });
  const muscleSinew = new THREE.MeshLambertMaterial({
    color: isColossus || isArmored ? '#d8bfb0' : skinC.clone().multiplyScalar(0.88),
  });
  const napeMat = new THREE.MeshLambertMaterial({
    color: skinC.clone().multiplyScalar(0.75).lerp(new THREE.Color('#b03a3a'), 0.22),
  });

  const fat = opts.fat ?? rand(0.9, 1.25);
  const headS = opts.headScale ?? rand(0.92, 1.2);
  const armLen = opts.armLen ?? rand(0.94, 1.14);
  const legLen = opts.legLen ?? rand(0.92, 1.08);

  const root = new THREE.Group();
  const hipH = 4.85 * legLen;
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

  // 1. Pelve / Quadril contínuo
  add(body, sculptedCapsule(1.26 * fat, 1.20 * fat, 1.45, 0.84 * fat, 0.80 * fat, skin, 0, 0.14, 0, (u, vx, vy, vz, px, pz) => {
    const glute = pz < -0.2 ? -0.12 * Math.sin(u * Math.PI) : 0;
    return [vx, vy, vz + glute];
  }, 22, 16, 0.26));

  // 2. Tronco Único Contínuo (Cintura -> Abdômen -> Costelas -> Peitorais -> Ombros/Trapézio sem bolhas soltas!)
  const spine = new THREE.Group();
  spine.position.y = 0.6;
  body.add(spine);

  add(spine, sculptedCapsule(1.58, 1.24 * fat, 3.75, 0.90, 0.82 * fat, skin, 0, 1.68, 0.02, (u, vx, vy, vz, px, pz, cap) => {
    // u vai de 0 (quadril/cintura) até 1 (ombros/base do pescoço)
    // Curva de largura (cintura estreita em u=0.25, dorsais largos em u=0.78, trapézio fechando em u=1.0)
    let wScale = 1.0;
    if (u < 0.35) {
      wScale = 1.0 - Math.sin((u / 0.35) * Math.PI) * 0.09;
    } else if (u < 0.86) {
      wScale = 1.0 + Math.sin(((u - 0.35) / 0.51) * Math.PI * 0.65) * 0.16;
    } else {
      const t = (u - 0.86) / 0.14;
      wScale = 1.14 * (1.0 - t * 0.42);
    }

    // Relevo anatômico frontal (+Z): barriga suave embaixo e peitorais esculpidos na própria malha em cima
    let zAdd = 0;
    if (pz > 0.15) {
      // Barriga (u = 0.08 .. 0.48)
      if (u > 0.06 && u < 0.52) {
        const bu = (u - 0.06) / 0.46;
        const belly = Math.sin(bu * Math.PI) * (fat > 1.08 ? 0.32 * (fat - 0.7) : 0.10);
        // Sulco central da linha alba e gomos abdominais sutis na própria malha
        const lineaAlba = Math.abs(px) < 0.25 ? -0.04 * (1 - Math.abs(px) / 0.25) : 0;
        const absRipple = fat <= 1.12 ? Math.sin(bu * Math.PI * 3) * 0.025 : 0;
        zAdd += (belly + lineaAlba + absRipple) * pz * cap;
      }
      // Peitoral esculpido direto na malha (u = 0.54 .. 0.86), com sulco do esterno no centro
      if (u > 0.52 && u < 0.88) {
        const pu = (u - 0.52) / 0.36;
        const sternum = Math.min(1, Math.abs(px) / 0.22);
        const pec = Math.sin(pu * Math.PI) * sternum * 0.22;
        // Vinco inferior do peitoral em pu ~ 0.15
        const underCut = pu < 0.22 ? -Math.sin((pu / 0.22) * Math.PI) * 0.06 * sternum : 0;
        zAdd += (pec + underCut) * pz * cap;
      }
    } else if (pz < -0.2) {
      // Sulco da coluna vertebral nas costas (-Z)
      const spineGroove = Math.abs(px) < 0.22 ? 0.06 * (1 - Math.abs(px) / 0.22) : 0;
      zAdd += spineGroove * cap;
    }

    return [vx * wScale, vy, vz + zAdd];
  }, 26, 22, 0.25));

  // Costelas aparentes no Colosso
  if (isColossus) {
    for (let r = 0; r < 4; r++) {
      for (const s of [-1, 1]) {
        const rib = sculptedCapsule(0.08, 0.08, 0.85, 0.12, 0.12, muscleSinew, s * 0.68, 1.55 + r * 0.30, 0.74);
        rib.rotation.z = Math.PI * 0.5 + s * 0.16;
        add(spine, rib);
      }
    }
  }

  // 3. Pescoço Muscular Cilíndrico e Ponto Fraco da Nuca (zone = 'nape')
  const neck = new THREE.Group();
  neck.position.y = 3.45;
  spine.add(neck);
  add(neck, sculptedCapsule(0.48, 0.58, 1.05, 0.46, 0.56, skin, 0, 0.24, 0.02, null, 18, 12, 0.24));

  // Nuca integrada ao contorno posterior do pescoço
  const nape = add(neck, sculptedCapsule(0.44, 0.48, 0.82, 0.22, 0.24, napeMat, 0, 0.34, -0.42, null, 16, 10, 0.28), 'nape');

  // Se for Boneco de Treino (dummy), adiciona o alvo acolchoado autêntico do RAoT (strike_pad_full) na nuca
  if (isDummy) {
    const padGeo = getRaotGeo('strike_pad').clone();
    padGeo.parameters = { width: 1.0, height: 1.0, depth: 0.45 };
    const padMesh = new THREE.Mesh(padGeo, getRaotMat());
    padMesh.position.set(0, 0.35, -0.58);
    padMesh.castShadow = true;
    add(neck, padMesh, 'nape');
  }

  // 4. Cabeça e Rosto Anatômico de Titã (Crânio, Maçãs do Rosto, Maxilar Quadrado, Olhos Fundos e Dentes Alinhados)
  const head = new THREE.Group();
  head.position.y = 0.6;
  head.scale.setScalar(headS);
  neck.add(head);

  // Malha craniofacial única (queixo em u=0 até topo do crânio em u=1)
  add(head, sculptedCapsule(0.95, 0.76, 2.06, 0.96, 0.82, skin, 0, 1.02, 0.06, (u, vx, vy, vz, px, pz, cap) => {
    // Formato de rosto humano/Titã: mandíbula marcada em u=0.15, maçãs do rosto largas em u=0.52, têmporas em u=0.72
    let wMul = 1.0;
    if (u < 0.22) wMul = 0.84 + (u / 0.22) * 0.14;
    else if (u < 0.58) wMul = 0.98 + Math.sin(((u - 0.22) / 0.36) * Math.PI) * 0.08;

    let zOff = 0;
    if (pz > 0.2) {
      // Queixo firme na base frontal
      if (u < 0.20 && Math.abs(px) < 0.45) zOff += 0.08 * cap;
      // Cavidade da boca levemente recuada para os dentes ficarem dentro do rosto
      if (u > 0.16 && u < 0.34 && Math.abs(px) < 0.58) zOff -= 0.08;
      // Cavidade ocular profunda abaixo da sobrancelha (u = 0.52 .. 0.68)
      if (u > 0.52 && u < 0.68 && Math.abs(px) > 0.18 && Math.abs(px) < 0.72) zOff -= 0.14;
      // Arco superciliar (sobrancelha óssea proeminente em u = 0.68 .. 0.76)
      if (u >= 0.66 && u < 0.77 && Math.abs(px) < 0.75) zOff += 0.09 * cap;
    }
    return [vx * wMul, vy, vz + zOff];
  }, 26, 20, 0.36));

  // Olhos fundos e ameaçadores sob o arco superciliar (zone = 'eyes')
  const eyeW = mat('#f0ece1');
  const irisM = mat(isColossus ? '#e8c870' : pick(IRIS_COLORS));
  const pupil = mat('#120e0e');
  const socketM = mat('#261412');
  const eyeSize = rand(0.25, 0.32);
  const eyes = new THREE.Group();
  eyes.position.set(0, 1.24, 0.80);
  head.add(eyes);

  for (const s of [-1, 1]) {
    // Sombra orbital profunda (width >= 0.38 para lungeTarget)
    add(eyes, sculptedEllipsoid(0.42, 0.28, 0.16, socketM, s * 0.42, 0, -0.02), 'eyes');
    // Esclera recuada dentro da órbita
    add(eyes, sculptedEllipsoid(eyeSize * 1.15, eyeSize * 0.82, 0.16, eyeW, s * 0.42, 0, 0.03), 'eyes');
    // Íris e pupila pequenas (olhar fixo de Titã)
    const gx = s * 0.42 + rand(-0.02, 0.02);
    const gy = rand(-0.015, 0.015);
    add(eyes, sculptedEllipsoid(eyeSize * 0.46, eyeSize * 0.46, 0.12, irisM, gx, gy, 0.08), 'eyes');
    add(eyes, sculptedEllipsoid(eyeSize * 0.24, eyeSize * 0.24, 0.13, pupil, gx, gy, 0.095), 'eyes');
    // Pálpebra/cenho franzido da cor da pele escura
    const brow = sculptedCapsule(0.06, 0.05, 0.48, 0.09, 0.08, skinDark, s * 0.42, eyeSize * 0.52, 0.06);
    brow.rotation.z = Math.PI * 0.5 - s * 0.14;
    add(eyes, brow, 'eyes');
  }

  // Nariz proporcional integrado ao rosto (ponte nasal + base das narinas)
  const nose = sculptedCapsule(0.08, 0.15, 0.48, 0.10, 0.20, skinDark, 0, 0.96, 0.90);
  nose.rotation.x = -0.18;
  add(head, nose);

  // Boca e Dentes integrados ao maxilar (sem lábios vermelhos saltados!)
  const mouthM = mat('#220c0e');
  const teethM = mat('#ebe2cc');
  const grin = rand(0.95, 1.32);

  // Fundo escuro da boca recuado na face
  add(head, sculptedCapsule(grin * 0.48, grin * 0.46, 0.28, 0.06, 0.06, mouthM, 0, 0.46, 0.75, null, 14, 8, 0.22));

  // Dentes incisivos/molares achatados acompanhando a curvatura da mandíbula
  const nT = Math.round(grin * 8);
  for (let i = 0; i < nT; i++) {
    const u = (i + 0.5) / nT - 0.5; // -0.5 .. +0.5
    const tx = u * grin * 0.88;
    const tz = 0.84 - u * u * 0.34;
    const tw = (grin / nT) * 0.44;
    add(head, sculptedCapsule(tw, tw * 0.95, 0.11, 0.045, 0.045, teethM, tx, 0.53, tz, null, 10, 6, 0.20));
    add(head, sculptedCapsule(tw * 0.95, tw * 0.9, 0.10, 0.045, 0.045, teethM, tx, 0.39, tz, null, 10, 6, 0.20));
  }

  // Contorno labial discreto da cor da pele sombreada
  for (const [ly, arch] of [[0.60, -0.28], [0.32, -0.28]]) {
    add(head, sculptedEllipsoid(grin * 0.96, 0.08, 0.16, skinDark, 0, ly, 0.86, (vx, vy, vz) => [vx, vy, vz + vx * vx * arch]));
  }

  // Orelhas rentes ao crânio
  for (const s of [-1, 1]) {
    const ear = sculptedEllipsoid(0.18, 0.48, 0.32, skinDark, s * 0.92, 1.02, 0.02);
    ear.rotation.y = s * 0.18;
    add(head, ear);
  }

  // Cabelo modelado como touca anatômica contínua sobre o crânio (sem salsichas flutuantes)
  if (!isColossus && opts.hair !== false && (isArmored || Math.random() < 0.82)) {
    const hm = isArmored ? mat('#d8cfb8') : mat(pick(HAIR));
    const style = isArmored ? 2 : Math.floor(rand(0, 3));
    // Calota craniana superior e nuca de cabelo
    add(head, sculptedEllipsoid(2.02, 1.15, 2.02, hm, 0, 1.58, -0.04, (vx, vy, vz) => {
      // Recorta a frente para deixar a testa e os olhos livres
      if (vz > 0.35 && vy < 0.12) return [vx * 0.95, vy + 0.18, vz * 0.82];
      return [vx, vy, vz];
    }, 20, 16));
    if (style >= 1) {
      // Cabelo mais comprido na nuca e têmporas
      add(head, sculptedCapsule(0.92, 0.82, 1.15, 0.55, 0.45, hm, 0, 1.05, -0.48, null, 16, 10, 0.28));
    }
    if (style === 2) {
      for (const s of [-1, 1]) {
        const sideLock = sculptedCapsule(0.16, 0.08, 0.95, 0.36, 0.22, hm, s * 0.88, 1.18, 0.18);
        sideLock.rotation.z = -s * 0.12;
        add(head, sideLock);
      }
    }
  }

  // 5. Braços Anatômicos Contínuos (Ombro -> Bíceps -> Antebraço -> Mão sem bolas nas juntas!)
  const arms = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const sh = new THREE.Group();
    sh.position.set(s * 1.58, 3.22, 0);
    spine.add(sh);

    // Braço superior contínuo desde o deltóide (+0.12) até o cotovelo (-2.4 * armLen - 0.10)
    const uLen = 2.4 * armLen;
    add(sh, sculptedCapsule(0.54, 0.40, uLen + 0.28, 0.54, 0.40, skin, 0, -uLen * 0.5 + 0.02, 0, (u, vx, vy, vz, px, pz) => {
      // Volume do deltóide no topo (u > 0.7) e bíceps no meio (u ~ 0.45)
      const bicep = Math.sin(u * Math.PI) * 0.08;
      const delt = u > 0.65 && s * px > 0 ? Math.sin(((u - 0.65) / 0.35) * Math.PI) * 0.10 * s : 0;
      return [vx * (1 + bicep) + delt, vy, vz * (1 + bicep)];
    }, 18, 14, 0.26), 'arm' + side);

    const elbow = new THREE.Group();
    elbow.position.y = -uLen;
    sh.add(elbow);

    // Antebraço contínuo encaixando dentro do cotovelo sem bola intermediária
    const fLen = 2.2 * armLen;
    add(elbow, sculptedCapsule(0.42, 0.29, fLen + 0.24, 0.41, 0.27, skin, 0, -fLen * 0.5 + 0.04, 0, (u, vx, vy, vz) => {
      const swell = u > 0.45 ? Math.sin(((u - 0.45) / 0.55) * Math.PI) * 0.06 : 0;
      return [vx * (1 + swell), vy, vz * (1 + swell)];
    }, 18, 12, 0.26), 'arm' + side);

    const hand = new THREE.Group();
    hand.position.y = -fLen;
    elbow.add(hand);

    // Palma da mão achatada e dedos cilíndricos
    add(hand, sculptedCapsule(0.36, 0.38, 0.72, 0.20, 0.18, skinDark, 0, -0.32, 0.02, null, 14, 8, 0.28), 'arm' + side);
    for (let f = 0; f < 4; f++) {
      const fx = (-0.24 + f * 0.16) * s;
      const finger = sculptedCapsule(0.075, 0.055, 0.52, 0.075, 0.055, skin, fx, -0.82, 0.06, null, 10, 6, 0.28);
      finger.rotation.x = 0.18;
      add(hand, finger, 'arm' + side);
    }
    const thumb = sculptedCapsule(0.085, 0.065, 0.42, 0.085, 0.065, skin, -s * 0.34, -0.48, 0.14, null, 10, 6, 0.28);
    thumb.rotation.z = s * 0.48;
    thumb.rotation.x = 0.25;
    add(hand, thumb, 'arm' + side);

    arms[side] = { shoulder: sh, elbow, hand };
  }

  // 6. Pernas Anatômicas Contínuas (Coxa -> Panturrilha -> Pé sem anéis esféricos nos joelhos!)
  const legs = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.74 * fat, 0, 0);
    body.add(hip);

    const tLen = 2.4 * legLen;
    add(hip, sculptedCapsule(0.72 * fat, 0.50, tLen + 0.30, 0.74 * fat, 0.52, skin, 0, -tLen * 0.5 + 0.04, 0, (u, vx, vy, vz, px, pz) => {
      const quad = pz > 0 ? Math.sin(u * Math.PI) * 0.10 : 0;
      return [vx, vy, vz + quad];
    }, 18, 14, 0.26), 'leg' + side);

    const knee = new THREE.Group();
    knee.position.y = -tLen;
    hip.add(knee);

    const cLen = 2.2 * legLen;
    add(knee, sculptedCapsule(0.51, 0.35, cLen + 0.26, 0.52, 0.37, skin, 0, -cLen * 0.5 + 0.04, 0, (u, vx, vy, vz, px, pz) => {
      // Panturrilha alta atrás (-Z) e canela reta na frente (+Z)
      const calf = pz < 0 && u > 0.35 ? Math.sin(((u - 0.35) / 0.65) * Math.PI) * 0.14 : 0;
      return [vx, vy, vz - calf];
    }, 18, 14, 0.26), 'leg' + side);

    // Pé anatômico com sola plana
    add(knee, sculptedEllipsoid(1.04, 0.52, 1.82, skinDark, 0, -cLen - 0.02, 0.30, (vx, vy, vz) => {
      const flatSole = vy < -0.10 ? -0.16 : vy;
      return [vx, flatSole, vz];
    }), 'leg' + side);

    legs[side] = { hip, knee };
  }

  // 7. Couraça / Placas de Armadura Óssea Contornadas (Titã Blindado)
  const armor = [];
  if (isArmored) {
    const plate = new THREE.MeshLambertMaterial({ color: '#d6cfc0' });
    const plateDark = new THREE.MeshLambertMaterial({ color: '#b5ad9c' });
    // armor[0] é sempre a placa da nuca
    armor.push(add(neck, sculptedArmorPlate(1.22, 1.05, 0.32, plate, 0, 0.34, -0.58, -0.08), 'nape'));
    armor.push(add(spine, sculptedArmorPlate(1.48, 1.15, 0.32, plate, 0.70, 2.65, 0.86, 0.1)));
    armor.push(add(spine, sculptedArmorPlate(1.48, 1.15, 0.32, plate, -0.70, 2.65, 0.86, 0.1)));
    armor.push(add(spine, sculptedArmorPlate(2.70, 0.85, 0.28, plateDark, 0, 1.35, 0.80, 0.14)));
    armor.push(add(spine, sculptedArmorPlate(3.05, 1.35, 0.30, plate, 0, 2.65, -0.84, -0.14)));
    for (const s of [-1, 1]) {
      const side = s > 0 ? 'L' : 'R';
      armor.push(add(arms[side].shoulder, sculptedArmorPlate(1.18, 0.95, 1.18, plate, s * 0.08, -0.35, 0, 0.08)));
      armor.push(add(arms[side].elbow, sculptedArmorPlate(0.88, 1.40, 0.88, plateDark, 0, -0.95, 0.10, 0.06)));
      armor.push(add(legs[side].hip, sculptedArmorPlate(1.32, 1.50, 0.38, plate, 0, -1.1, 0.56, 0.1)));
      armor.push(add(legs[side].knee, sculptedArmorPlate(1.14, 1.45, 0.34, plate, 0, -0.95, 0.50, 0.08)));
    }
    armor.push(add(head, sculptedArmorPlate(1.88, 0.68, 0.28, plate, 0, 1.66, 0.88, 0.12)));
    armor.push(add(head, sculptedArmorPlate(1.48, 0.44, 0.30, plateDark, 0, 0.26, 0.82, 0.1)));
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  return { root, body, spine, neck, head, eyes, nape, arms, legs, meshes, armor, skinMat: skin, napeMat, hipH };
}
