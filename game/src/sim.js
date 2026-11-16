// SANDLINE simulation: fixed-step (60 Hz) game logic, kept apart from rendering.
// One state object holds everything; main.js steps it and renders from it.
// Player input arrives as an intent object; bots decide through bots.js via
// the `api` object this module builds (no circular import: bots never import sim).
import { BOXES, SITE, SPAWNS, moveEntity, rayBox, rayWorld, hasLineOfSight, LANES, nearestNode } from './world.js';
import { WEAPONS, GRENADE, ARMOR_PRICE, ARMOR_ABSORB, damageAtRange, applyArmor, fireInterval, currentSpread } from './weapons.js';
import { updateBots } from './bots.js';

export const STEP = 1 / 60;
export const ROUND_TIME = 100;
export const FREEZE_TIME = 3;
export const BUY_WINDOW = 15; // buy stays open this long into the live phase
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;
export const FUSE_TIME = 40;
export const WIN_SCORE = 8;
export const MAX_ROUNDS = 15;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;

// Deterministic RNG (mulberry32) so shot modes and replays are stable.
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOT_NAMES_A = ['Dune', 'Sirocco', 'Ghibli', 'Harmattan'];
const BOT_NAMES_D = ['Jackal', 'Viper', 'Scorpion', 'Fennec', 'Cobra'];

function makeEntity(id, team, kind, name, x, z, yaw) {
  return {
    id, team, kind, name,
    x, z, y: 0, yaw, pitch: 0, vy: 0, onGround: true,
    hp: 100, armor: 0, alive: true,
    weapon: 'vk47', mag: WEAPONS.vk47.mag, reserve: WEAPONS.vk47.reserve,
    grenades: 0, reloading: 0, reloadT: 0, boltT: 0,
    bloom: 0, lastShot: -9, crouched: false, speed: 0,
    money: 800, kills: 0, deaths: 0,
    hasBomb: false, planting: 0, defusing: 0,
    bot: null, // filled in for bots
  };
}

export function createGame(seed = 12345) {
  const rng = makeRng(seed);
  const entities = [];
  const player = makeEntity(0, 'A', 'player', 'You', SPAWNS.attack.x, SPAWNS.attack.z, SPAWNS.attack.yaw);
  player.weapon = 'vk47';
  entities.push(player);
  BOT_NAMES_A.forEach((name, i) => {
    const e = makeEntity(1 + i, 'A', 'bot', name, SPAWNS.attack.x - 1 - i * 0.8, SPAWNS.attack.z + (i - 1.5) * 1.6, SPAWNS.attack.yaw);
    e.bot = { role: i === 0 ? 'carrier' : 'rifler', lane: ['mid', 'a', 'b', 'platform'][i], route: [], nodeIdx: 0, state: 'move', holdT: 0, targetId: -1, aimT: 0, burstLeft: 0, burstT: 0, reactT: 0, investigate: null, plantT: 0, lastSeen: -9, yawTarget: e.yaw };
    entities.push(e);
  });
  BOT_NAMES_D.forEach((name, i) => {
    const e = makeEntity(5 + i, 'D', 'bot', name, SPAWNS.defend.x + 1 + i * 0.7, SPAWNS.defend.z + (i - 2) * 1.6, SPAWNS.defend.yaw);
    e.bot = { role: 'holder', lane: ['site', 'site', 'mid', 'a', 'b'][i], route: [], nodeIdx: 0, state: 'hold', holdT: 0, targetId: -1, aimT: 0, burstLeft: 0, burstT: 0, reactT: 0, investigate: null, plantT: 0, lastSeen: -9, yawTarget: e.yaw };
    entities.push(e);
  });
  const state = {
    tick: 0, time: 0, rng,
    phase: 'freeze', phaseT: FREEZE_TIME, round: 1,
    scoreA: 0, scoreD: 0, roundTime: ROUND_TIME, buyLeft: BUY_WINDOW,
    entities, player,
    bomb: { status: 'carried', x: 0, z: 0, carrierId: 1, plantT: 0, fuseT: FUSE_TIME, defuseT: 0, defuserId: -1, planterId: -1 },
    grenades: [], tracers: [], impacts: [], flashes: [], explosions: [],
    noise: [], killfeed: [], events: [],
    roundWinner: null, roundReason: '', matchWinner: null,
    stats: { shotsFired: 0, shotsHit: 0 },
  };
  startRound(state);
  return state;
}

// --- helpers ----------------------------------------------------------------
export function eyeHeight(e) {
  return e.crouched ? EYE_CROUCH : EYE_STAND;
}

function eyePos(e) {
  return { x: e.x, y: e.y + eyeHeight(e), z: e.z };
}

function hitBoxes(e) {
  return {
    body: { x0: e.x - 0.35, x1: e.x + 0.35, y0: e.y + 0.05, y1: e.y + 1.35, z0: e.z - 0.35, z1: e.z + 0.35 },
    head: { x0: e.x - 0.21, x1: e.x + 0.21, y0: e.y + 1.35, y1: e.y + 1.78, z0: e.z - 0.21, z1: e.z + 0.21 },
  };
}

function dirFromYawPitch(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

function pushEvent(state, ev) {
  state.events.push(ev);
}


// --- combat ------------------------------------------------------------------
function killEntity(state, victim, killer, weaponId, headshot) {
  victim.alive = false;
  victim.deaths += 1;
  victim.hp = 0;
  victim.planting = 0;
  victim.defusing = 0;
  if (killer && killer !== victim && killer.alive) {
    killer.kills += 1;
    killer.money += 300;
  }
  state.killfeed.push({ killer: killer ? killer.name : '—', victim: victim.name, weapon: weaponId, headshot, t: state.time });
  if (state.killfeed.length > 6) state.killfeed.shift();
  pushEvent(state, { type: 'kill', by: killer ? killer.id : -1, victim: victim.id, weapon: weaponId, headshot });
  if (victim.hasBomb) {
    victim.hasBomb = false;
    state.bomb.status = 'dropped';
    state.bomb.x = victim.x;
    state.bomb.z = victim.z;
    state.bomb.carrierId = -1;
  }
  if (victim.kind === 'player') pushEvent(state, { type: 'playerDied' });
}

export function fireWeapon(state, shooter, dir, spreadDeg) {
  const def = WEAPONS[shooter.weapon];
  if (shooter.reloading > 0 || shooter.boltT > 0) return false;
  if (state.time - shooter.lastShot < fireInterval(def) - 0.001) return false;
  if (shooter.mag <= 0) {
    pushEvent(state, { type: 'dryfire', by: shooter.id });
    shooter.lastShot = state.time;
    return false;
  }
  shooter.mag -= 1;
  shooter.lastShot = state.time;
  shooter.bloom = Math.min(def.spreadMax, shooter.bloom + def.spreadBloom);
  if (shooter.kind === 'player') shooter.pitch = Math.min(1.2, shooter.pitch + def.recoil * 0.011);
  state.stats.shotsFired += 1;

  const eye = eyePos(shooter);
  // Random cone around the aim direction (gaussian-ish, 3 samples averaged).
  const spreadRad = (spreadDeg * Math.PI) / 180;
  const rx = ((state.rng() + state.rng() + state.rng()) / 3 - 0.5) * 2 * spreadRad;
  const ry = ((state.rng() + state.rng() + state.rng()) / 3 - 0.5) * 2 * spreadRad;
  // Right and up vectors for the aim direction.
  const right = { x: Math.cos(shooter.yaw), y: 0, z: -Math.sin(shooter.yaw) };
  const up = { x: 0, y: 1, z: 0 };
  let dx = dir.x + right.x * rx + up.x * ry;
  let dy = dir.y + right.y * rx + up.y * ry;
  let dz = dir.z + right.z * rx + up.z * ry;
  const len = Math.hypot(dx, dy, dz);
  dx /= len; dy /= len; dz /= len;

  const muzzle = { x: eye.x + dir.x * 0.6, y: eye.y - 0.12, z: eye.z + dir.z * 0.6 };
  state.flashes.push({ x: muzzle.x, y: muzzle.y, z: muzzle.z, ttl: 0.05 });
  const wallDist = rayWorld(eye.x, eye.y, eye.z, dx, dy, dz, 200);
  let bestDist = wallDist;
  let bestVictim = null;
  let bestHead = false;
  for (const e of state.entities) {
    if (!e.alive || e.team === shooter.team) continue;
    const hb = hitBoxes(e);
    const th = rayBox(eye.x, eye.y, eye.z, dx, dy, dz, hb.head, 200);
    const tb = rayBox(eye.x, eye.y, eye.z, dx, dy, dz, hb.body, 200);
    if (th < bestDist) { bestDist = th; bestVictim = e; bestHead = true; }
    if (tb < bestDist) { bestDist = tb; bestVictim = e; bestHead = false; }
  }
  const hx = eye.x + dx * (Number.isFinite(bestDist) ? bestDist : 60);
  const hy = eye.y + dy * (Number.isFinite(bestDist) ? bestDist : 60);
  const hz = eye.z + dz * (Number.isFinite(bestDist) ? bestDist : 60);
  state.tracers.push({ x1: muzzle.x, y1: muzzle.y, z1: muzzle.z, x2: hx, y2: hy, z2: hz, color: def.tracer, ttl: 0.07 });
  pushEvent(state, { type: 'shot', by: shooter.id, weapon: shooter.weapon, dist: bestDist });

  // Noise: bots hear gunfire.
  const noiseR = def.kind === 'sniper' ? 42 : def.kind === 'rifle' ? 30 : 20;
  state.noise.push({ x: eye.x, z: eye.z, radius: noiseR, ttl: 0.5 });

  if (bestVictim) {
    state.stats.shotsHit += 1;
    let dmg = damageAtRange(def, bestDist);
    if (bestHead) dmg *= def.headMult;
    const split = applyArmor(dmg, bestVictim.armor);
    bestVictim.armor -= split.armor;
    bestVictim.hp -= split.hp;
    pushEvent(state, { type: 'hit', by: shooter.id, victim: bestVictim.id, headshot: bestHead });
    if (bestVictim.kind === 'player') pushEvent(state, { type: 'hurt', victim: bestVictim.id });
    if (shooter.kind === 'player' && bestVictim.hp <= 0) pushEvent(state, { type: 'killConfirm', by: shooter.id });
    if (bestVictim.hp <= 0) killEntity(state, bestVictim, shooter, shooter.weapon, bestHead);
  } else if (wallDist < 200) {
    state.impacts.push({ x: hx, y: hy, z: hz, ttl: 0.4 });
  }
  if (def.bolt) shooter.boltT = 1.15;
  return true;
}

function startReload(state, e) {
  const def = WEAPONS[e.weapon];
  if (e.reloading > 0 || e.mag >= def.mag || e.reserve <= 0) return;
  e.reloading = def.reload;
  pushEvent(state, { type: 'reload', by: e.id });
}

function finishReload(e) {
  const def = WEAPONS[e.weapon];
  const need = def.mag - e.mag;
  const take = Math.min(need, e.reserve);
  e.mag += take;
  e.reserve -= take;
  e.reloading = 0;
}

function throwGrenade(state, e, dir) {
  if (e.grenades <= 0) return false;
  e.grenades -= 1;
  const eye = eyePos(e);
  state.grenades.push({
    x: eye.x, y: eye.y, z: eye.z,
    vx: dir.x * GRENADE.throwSpeed, vy: dir.y * GRENADE.throwSpeed + 2.6, vz: dir.z * GRENADE.throwSpeed,
    fuse: GRENADE.fuse, ownerId: e.id,
  });
  pushEvent(state, { type: 'throw', by: e.id });
  return true;
}

function explodeGrenade(state, g) {
  state.explosions.push({ x: g.x, y: g.y, z: g.z, ttl: 0.6 });
  state.noise.push({ x: g.x, z: g.z, radius: 45, ttl: 0.5 });
  pushEvent(state, { type: 'explode', x: g.x, z: g.z });
  const owner = state.entities[g.ownerId];
  for (const e of state.entities) {
    if (!e.alive) continue;
    const dx = e.x - g.x;
    const dy = e.y + 0.9 - g.y;
    const dz = e.z - g.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > GRENADE.radius) continue;
    const los = hasLineOfSight(g.x, g.y, g.z, e.x, e.y + 0.9, e.z);
    let dmg = GRENADE.damage * (1 - dist / GRENADE.radius) * (los ? 1 : 0.25);
    const split = applyArmor(dmg, e.armor);
    e.armor -= split.armor;
    e.hp -= split.hp;
    if (e.kind === 'player') pushEvent(state, { type: 'hurt', victim: e.id });
    if (e.hp <= 0) killEntity(state, e, owner && owner.id !== e.id ? owner : null, 'frag', false);
  }
}

// --- economy ------------------------------------------------------------------
export function buyItem(state, e, itemId) {
  if (state.phase !== 'freeze' && !(state.phase === 'live' && state.buyLeft > 0)) return false;
  if (!e.alive) return false;
  if (itemId === 'kevlar') {
    if (e.money < ARMOR_PRICE || e.armor >= 100) return false;
    e.money -= ARMOR_PRICE;
    e.armor = 100;
  } else if (itemId === 'frag') {
    if (e.money < GRENADE.price || e.grenades >= 2) return false;
    e.money -= GRENADE.price;
    e.grenades += 1;
  } else {
    const def = WEAPONS[itemId];
    if (!def || e.money < def.price) return false;
    if (e.weapon === itemId) {
      // Re-arm: refill reserve for the same weapon.
      if (e.reserve >= def.reserve) return false;
      e.money -= Math.floor(def.price / 4);
      e.reserve = def.reserve;
    } else {
      e.money -= def.price;
      e.weapon = itemId;
      e.mag = def.mag;
      e.reserve = def.reserve;
      e.reloading = 0;
      e.boltT = 0;
    }
  }
  pushEvent(state, { type: 'buy', by: e.id, item: itemId });
  return true;
}

// --- rounds --------------------------------------------------------------------
function startRound(state) {
  state.phase = 'freeze';
  state.phaseT = FREEZE_TIME;
  state.roundTime = ROUND_TIME;
  state.buyLeft = BUY_WINDOW;
  state.roundWinner = null;
  state.roundReason = '';
  state.bomb = { status: 'carried', x: 0, z: 0, carrierId: 1, plantT: 0, fuseT: FUSE_TIME, defuseT: 0, defuserId: -1, planterId: -1 };
  state.grenades = [];
  state.noise = [];
  const atkSlots = [
    { x: SPAWNS.attack.x, z: SPAWNS.attack.z - 3 },
    { x: SPAWNS.attack.x - 1, z: SPAWNS.attack.z - 1.5 },
    { x: SPAWNS.attack.x - 1, z: SPAWNS.attack.z + 1.5 },
    { x: SPAWNS.attack.x - 2, z: SPAWNS.attack.z - 0.5 },
    { x: SPAWNS.attack.x - 2, z: SPAWNS.attack.z + 2 },
  ];
  const defSlots = [
    { x: SPAWNS.defend.x, z: SPAWNS.defend.z - 3 },
    { x: SPAWNS.defend.x + 1, z: SPAWNS.defend.z - 1.5 },
    { x: SPAWNS.defend.x + 1, z: SPAWNS.defend.z + 1.5 },
    { x: SPAWNS.defend.x + 2, z: SPAWNS.defend.z - 0.5 },
    { x: SPAWNS.defend.x + 2, z: SPAWNS.defend.z + 2 },
  ];
  let ai = 0;
  let di = 0;
  for (const e of state.entities) {
    const slot = e.team === 'A' ? atkSlots[ai++] : defSlots[di++];
    e.x = slot.x;
    e.z = slot.z;
    e.y = 0;
    e.vy = 0;
    e.yaw = e.team === 'A' ? SPAWNS.attack.yaw : SPAWNS.defend.yaw;
    e.pitch = 0;
    e.hp = 100;
    e.alive = true;
    e.crouched = false;
    e.bloom = 0;
    e.reloading = 0;
    e.boltT = 0;
    e.planting = 0;
    e.defusing = 0;
    e.hasBomb = false;
    const def = WEAPONS[e.weapon];
    e.mag = def.mag;
    e.reserve = def.reserve;
    if (e.kind === 'bot') {
      e.bot.state = e.team === 'A' ? 'move' : 'hold';
      e.bot.route = e.team === 'A' ? [...LANES[e.bot.lane]] : [];
      e.bot.nodeIdx = 0;
      e.bot.targetId = -1;
      e.bot.holdT = 0;
      e.bot.investigate = null;
      e.bot.plantT = 0;
      e.bot.yawTarget = e.yaw;
    }
  }
  // The carrier (first attacker bot) takes the bomb.
  const carrier = state.entities[1];
  carrier.hasBomb = true;
  state.bomb.carrierId = carrier.id;
  pushEvent(state, { type: 'roundStart', round: state.round });
}

function endRound(state, winnerTeam, reason) {
  if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
  state.phase = 'roundEnd';
  state.phaseT = 4.5;
  state.roundWinner = winnerTeam;
  state.roundReason = reason;
  if (winnerTeam === 'A') state.scoreA += 1;
  else state.scoreD += 1;
  for (const e of state.entities) {
    e.money += e.team === winnerTeam ? 3250 : 1900;
    e.money = Math.min(e.money, 16000);
  }
  pushEvent(state, { type: 'roundEnd', winner: winnerTeam, reason });
  if (state.scoreA >= WIN_SCORE || state.scoreD >= WIN_SCORE || state.round >= MAX_ROUNDS) {
    state.matchWinner = state.scoreA > state.scoreD ? 'A' : state.scoreD > state.scoreA ? 'D' : 'draw';
    state.phase = 'matchEnd';
    state.phaseT = 999;
    pushEvent(state, { type: 'matchEnd', winner: state.matchWinner });
  }
}

function aliveCount(state, team) {
  let n = 0;
  for (const e of state.entities) if (e.alive && e.team === team) n += 1;
  return n;
}

// --- bomb ----------------------------------------------------------------------
function distToSite(e) {
  return Math.hypot(e.x - SITE.x, e.z - SITE.z);
}

function updateBomb(state, dt, input) {
  const bomb = state.bomb;
  const player = state.player;
  // Pickup: a dropped bomb is taken by the first attacker walking over it.
  if (bomb.status === 'dropped') {
    for (const e of state.entities) {
      if (!e.alive || e.team !== 'A') continue;
      if (Math.hypot(e.x - bomb.x, e.z - bomb.z) < 1.2) {
        e.hasBomb = true;
        bomb.status = 'carried';
        bomb.carrierId = e.id;
        pushEvent(state, { type: 'bombPickup', by: e.id });
        break;
      }
    }
  }
  // Player planting (hold E inside the site). Not during buy time.
  if (bomb.status === 'carried' && player.alive && player.hasBomb && state.phase === 'live' && state.buyLeft <= 0) {
    if (input.use && distToSite(player) <= SITE.r && player.onGround) {
      player.planting += dt;
      if (player.planting >= PLANT_TIME) {
        player.planting = 0;
        player.hasBomb = false;
        bomb.status = 'planted';
        bomb.x = player.x;
        bomb.z = player.z;
        bomb.fuseT = FUSE_TIME;
        bomb.planterId = player.id;
        player.money += 300;
        pushEvent(state, { type: 'planted', by: player.id });
      }
    } else {
      player.planting = 0;
    }
  }
  // Player defusing (hold E near the planted bomb).
  if (bomb.status === 'planted' && player.alive && state.phase === 'live') {
    const d = Math.hypot(player.x - bomb.x, player.z - bomb.z);
    if (input.use && d <= 2.5 && player.onGround) {
      player.defusing += dt;
      bomb.defuserId = player.id;
      if (player.defusing >= DEFUSE_TIME) {
        player.defusing = 0;
        bomb.status = 'defused';
        endRound(state, 'D', 'Bomb defused');
        return;
      }
    } else {
      player.defusing = 0;
      if (bomb.defuserId === player.id) bomb.defuserId = -1;
    }
  }
  // Fuse.
  if (bomb.status === 'planted') {
    bomb.fuseT -= dt;
    if (bomb.fuseT <= 0) {
      state.explosions.push({ x: bomb.x, y: 0.5, z: bomb.z, ttl: 0.8 });
      pushEvent(state, { type: 'detonated' });
      endRound(state, 'A', 'Depot detonated');
    }
  }
}

// --- the fixed step --------------------------------------------------------------
export function stepGame(state, input, dt) {
  state.tick += 1;
  state.time += dt;
  const player = state.player;

  // Phase timers.
  if (state.phase === 'freeze') {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      state.phase = 'live';
      pushEvent(state, { type: 'liveStart' });
    }
  } else if (state.phase === 'roundEnd') {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      state.round += 1;
      startRound(state);
    }
  }

  if (state.phase === 'live') {
    state.roundTime -= dt;
    if (state.buyLeft > 0) state.buyLeft -= dt;
    if (state.roundTime <= 0 && state.bomb.status !== 'planted') {
      endRound(state, 'D', 'Time expired — bomb never planted');
    }
  }

  // --- player movement (frozen during freeze phase) ---
  if (player.alive && state.phase !== 'freeze' && state.phase !== 'matchEnd') {
    const speed = player.crouched ? 2.2 : 4.6;
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    let mx = 0;
    let mz = 0;
    if (input.forward) { mx += -sin; mz += -cos; }
    if (input.back) { mx += sin; mz += cos; }
    if (input.left) { mx += -cos; mz += sin; }
    if (input.right) { mx += cos; mz += -sin; }
    const ml = Math.hypot(mx, mz);
    if (ml > 0) {
      mx /= ml;
      mz /= ml;
      player.speed = speed;
      moveEntity(player, mx * speed * dt, mz * speed * dt, dt);
    } else {
      player.speed = 0;
      moveEntity(player, 0, 0, dt);
    }
    if (input.jump && player.onGround) {
      player.vy = 7.2;
      player.onGround = false;
    }
    player.crouched = !!input.crouch;
    player.yaw = input.yaw;
    player.pitch = Math.max(-1.45, Math.min(1.45, input.pitch));
    // Footstep sounds (event only; audio.js plays them).
    if (player.speed > 0 && player.onGround && state.tick % 22 === 0) {
      pushEvent(state, { type: 'footstep', by: player.id });
    }
  } else {
    player.speed = 0;
    moveEntity(player, 0, 0, dt);
  }

  // --- player weapon ---
  // Buy time is a setup window: nobody shoots or plants until it ends, so
  // the spawn is safe while the player shops and positions. Buying stays open.
  if (player.alive && state.phase === 'live') {
    const def = WEAPONS[player.weapon];
    if (input.reload) startReload(state, player);
    if (state.buyLeft <= 0 && input.grenadeEdge) throwGrenade(state, player, dirFromYawPitch(player.yaw, player.pitch));
    if (state.buyLeft <= 0 && input.firing) {
      const spread = currentSpread(def, player.speed, player.bloom, player.crouched, input.ads);
      fireWeapon(state, player, dirFromYawPitch(player.yaw, player.pitch), spread);
    }
    if (input.buyKey) buyItem(state, player, input.buyKey);
  }
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) finishReload(player);
  }
  if (player.boltT > 0) player.boltT -= dt;
  player.bloom = Math.max(0, player.bloom - dt * 1.6);

  // --- bots ---
  if (state.phase === 'live' || state.phase === 'freeze') {
    const api = {
      fire: (shooter, dir, spread) => {
        if (state.buyLeft > 0) return false;
        return fireWeapon(state, shooter, dir, spread);
      },
      reload: (e) => startReload(state, e),
      throwGrenade: (e, dir) => {
        if (state.buyLeft > 0) return false;
        return throwGrenade(state, e, dir);
      },
      plant: (e) => {
        if (state.buyLeft > 0) return false;
        if (state.bomb.status !== 'carried' || !e.hasBomb) return false;
        if (distToSite(e) > SITE.r) return false;
        e.planting += dt;
        if (e.planting >= PLANT_TIME) {
          e.planting = 0;
          e.hasBomb = false;
          state.bomb.status = 'planted';
          state.bomb.x = e.x;
          state.bomb.z = e.z;
          state.bomb.fuseT = FUSE_TIME;
          state.bomb.planterId = e.id;
          e.money += 300;
          pushEvent(state, { type: 'planted', by: e.id });
          return true;
        }
        return false;
      },
      defuse: (e) => {
        if (state.bomb.status !== 'planted') return false;
        const d = Math.hypot(e.x - state.bomb.x, e.z - state.bomb.z);
        if (d > 2.5) return false;
        e.defusing += dt;
        state.bomb.defuserId = e.id;
        if (e.defusing >= DEFUSE_TIME) {
          e.defusing = 0;
          state.bomb.status = 'defused';
          endRound(state, 'D', 'Bomb defused');
          return true;
        }
        return false;
      },
      noise: (x, z, r) => state.noise.push({ x, z, radius: r, ttl: 0.5 }),
    };
    updateBots(state, dt, api);
  }

  // --- bomb logic (player plant/defuse, pickup, fuse) ---
  if (state.phase === 'live') updateBomb(state, dt, input);

  // --- grenades in flight ---
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.vy -= 14 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    g.fuse -= dt;
    // Ground bounce.
    if (g.y <= 0.1) {
      g.y = 0.1;
      g.vy = Math.abs(g.vy) * 0.42;
      g.vx *= 0.6;
      g.vz *= 0.6;
    }
    // Wall bounce (cheap: clamp inside the map and reflect on box overlap).
    for (const b of BOXES) {
      if (g.x > b.x0 && g.x < b.x1 && g.z > b.z0 && g.z < b.z1 && g.y > b.y0 && g.y < b.y1) {
        g.vx *= -0.4;
        g.vz *= -0.4;
        g.x += g.vx * dt * 2;
        g.z += g.vz * dt * 2;
        break;
      }
    }
    if (g.fuse <= 0) {
      explodeGrenade(state, g);
      state.grenades.splice(i, 1);
    }
  }

  // --- round end by elimination ---
  if (state.phase === 'live') {
    const aAlive = aliveCount(state, 'A');
    const dAlive = aliveCount(state, 'D');
    if (aAlive === 0 && dAlive === 0) endRound(state, 'D', 'Both teams eliminated');
    else if (aAlive === 0) endRound(state, 'D', 'Attackers eliminated');
    else if (dAlive === 0) endRound(state, 'A', 'Defenders eliminated');
  }

  // --- decay transient render data ---
  for (let i = state.tracers.length - 1; i >= 0; i--) {
    state.tracers[i].ttl -= dt;
    if (state.tracers[i].ttl <= 0) state.tracers.splice(i, 1);
  }
  for (let i = state.impacts.length - 1; i >= 0; i--) {
    state.impacts[i].ttl -= dt;
    if (state.impacts[i].ttl <= 0) state.impacts.splice(i, 1);
  }
  for (let i = state.flashes.length - 1; i >= 0; i--) {
    state.flashes[i].ttl -= dt;
    if (state.flashes[i].ttl <= 0) state.flashes.splice(i, 1);
  }
  for (let i = state.explosions.length - 1; i >= 0; i--) {
    state.explosions[i].ttl -= dt;
    if (state.explosions[i].ttl <= 0) state.explosions.splice(i, 1);
  }
  for (let i = state.noise.length - 1; i >= 0; i--) {
    state.noise[i].ttl -= dt;
    if (state.noise[i].ttl <= 0) state.noise.splice(i, 1);
  }
  // Bot reload timers.
  for (const e of state.entities) {
    if (e.kind !== 'bot') continue;
    if (e.reloading > 0) {
      e.reloading -= dt;
      if (e.reloading <= 0) finishReload(e);
    }
    if (e.boltT > 0) e.boltT -= dt;
    e.bloom = Math.max(0, e.bloom - dt * 1.6);
  }
}
