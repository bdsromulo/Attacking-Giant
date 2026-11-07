// Ajustes centrais de gameplay. Mexa aqui para calibrar o "feeling".
// Referência de design: sistema de burst/reel/lunge/armas extraído do RAoT v2.086.
export const CFG = {
  // --- Física do jogador ---
  gravity: 21,
  playerRadius: 0.45,
  runSpeed: 9,
  groundAccel: 60,
  groundFriction: 10,
  slideFriction: 1.6,     // atrito ao deslizar (aterrissar rápido segurando Ctrl)
  jumpSpeed: 9,
  airAccel: 7,            // controle fino no ar (WASD sem gás)
  airDrag: 0.0016,        // arrasto quadrático leve — o momento é preservado
  maxSpeed: 85,

  // --- Ganchos ---
  hookRange: 100,
  hookFlySpeed: 240,
  hookMinLen: 1.0,
  reelSpeed: 34,          // velocidade radial alvo ao recolher (Espaço)
  reelAccel: 60,
  reelDoubleMul: 1.25,    // RAoT GearDef.reelDoubleMultiplier: ambos os ganchos presos = reel 25% mais forte
  slackSpeed: 14,         // Ctrl solta cabo (m/s)
  swingAccel: 10,         // WASD perpendicular ao cabo
  hookedBurstTangent: 0.65,// redirecionamento tangencial do burst quando preso (ModifyDirectionForHookedMotion)
  autoAimConeDeg: 6.5,    // RAoT SphericalAutoAim: cone de assistência de mira dos ganchos
  cableMaxWraps: 10,      // RAoT PhysicalCable: máximo de quinas onde o cabo dobra (Ravel/Unravel)
  cableJut: 0.14,         // afastamento do vértice do cabo na quina

  // --- Burst (gás direcional — 6 direções como no RAoT) ---
  burstSpeed: 26,         // velocidade alvo na direção do burst (como no RAoT)
  burstAccel: 85,         // resposta rápida, mesmo contra o momento
  burstStartCost: 3.5,    // custo inicial mais caro...
  burstSustainCost: 7,    // ...e sustentar é barato (por segundo)
  backBurstScale: 0.65,   // burst para trás é mais fraco
  upBurstScale: 0.92,     // burst vertical para cima (2x E no ar)
  downBurstScale: 1.05,   // burst vertical para baixo (2x Q no ar)
  downBurstMinY: 2.0,     // RAoT BurstManager.MIN_DOWNBURST_HEIGHT
  gasReel: 5.5,           // por segundo
  gasThrust: 9,           // Espaço sem gancho (jato para frente)
  thrustAccel: 26,
  verticalSpeed: 13,      // E/Q no ar
  verticalAccel: 42,
  gasVertical: 8,
  splitAngle: 0.21,       // Shift: ângulo de abertura dos ganchos (rad)
  gasMax: 100,

  // --- Stress ---
  stressPerBurst: 9,      // bursts encadeados acumulam stress
  stressChainWindow: 0.9,
  stressRecover: 22,      // por segundo
  stressDelay: 0.8,
  overstressDelay: 2.0,   // RAoT GearStressModule.MAXED_COOLDOWN_SECS = 2.0s
  stressSlow: 0.85,       // stress alto = 15% mais lento
  reloadSlow: 0.90,       // RAoT GearDef.slowdownWhileReloading = 10% mais lento

  // --- Lâminas / Combate (ODM, APG, Lanças do Trovão) ---
  bladeSets: 8,
  bladeDurability: 100,
  poiseTime: 0.12,        // segurar LMB para entrar em postura
  slashTime: 0.24,
  slashCooldown: 0.28,
  slashReach: 3.0,
  spinReach: 4.8,         // RAoT SwordSpinAttack (LMB+RMB em postura)
  spinDmgMul: 1.35,
  bladeThrowSpeed: 88,    // RAoT SwordThrowAttack / BladeProjectile (RMB em postura)
  bladeThrowGrav: 10,
  lungeRange: 16,
  lungeDuration: 0.65,
  lungeSteerDeg: 60,
  lungeTurnRate: 7,
  lungeMinSpeed: 24,
  lungeInherit: 0.75,     // pós-lunge preserva 75%
  lungeMissStress: 50,    // RAoT SwordLungeCustomData: errar lunge aplica +50 stress
  dmgPerSpeed: 10,        // dano = velocidade(m/s) * isso
  impactDamageSpeed: 34,

  // --- APG (Pistolas Anti-Pessoal — ApgGunCustomData) ---
  apgRange: 26,
  apgDoubleRange: 16,
  apgSpread: 0.09,
  apgPacks: 6,
  apgBaseDmg: 260,

  // --- Lanças do Trovão (ThunderSpearCustomData / SpearProjectile) ---
  spearSpeed: 90,
  spearDoubleSpeed: 122,
  spearBlastRadius: 6.5,
  spearDoubleBlastRadius: 8.5,
  spearEmbedTime: 2.0,    // RAoT SpearProjectile.MAX_EMBED_TIME
  spearMaxAmmo: 4,
  spearBaseDmg: 520,

  // --- Mundo ---
  WALL_R: 250,
  WALL_H: 50,
  WALL_T: 8,
  BREACH_ANGLE: 0,
  BREACH_HALF: 0.075,
  WORLD_R: 560,
};
