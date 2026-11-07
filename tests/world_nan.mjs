// Constrói o mundo no Node e acusa qualquer geometria com NaN (com a pilha de chamadas).
import * as THREE from 'three';
import { World } from '../src/world.js';

const orig = World.prototype.addGeo;
let bad = 0;
World.prototype.addGeo = function (g, x, z) {
  const a = g.attributes.position.array;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i])) {
      if (bad++ < 3) console.log('NaN geo', { x, z, count: a.length, params: g.parameters }, new Error().stack.split('\n').slice(2, 5).join(' | '));
      break;
    }
  }
  return orig.call(this, g, x, z);
};
const w = new World(new THREE.Scene());
console.log('geos com NaN:', bad, '| colisores:', w.colliders.length, '| depósitos:', w.depots.length,
  '| colisores NaN:', w.colliders.filter((c) => [c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z].some(Number.isNaN)).length);
