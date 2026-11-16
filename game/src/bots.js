// SANDLINE bot AI: waypoint routes, hold positions, sight and sound reaction,
// plant / defuse behaviour and burst-fire combat.
// Bots think in small staggered slices (every 0.12 s) and steer every step.
// They share the sim's movement + collision code (world.moveEntity) and fire
// through the sim's api so every bullet goes through the same resolver.
import { NODES, LANES, SITE, findPath, nearestNode, hasLineOfSight, moveEntity } from './world.js';
import { WEAPONS, currentSpread } from './weapons.js';

const THINK_EVERY = 0.12;
const SIGHT_RANGE = 48;
const SIGHT_HALF_FOV = 0.96; // ~55 degrees each side
const BOT_SPEED = 3.8;
const ROTATE_SPEED = 4.3;

// Defender hold nodes by lane assignment.
const HOLD_NODE = { site: 19, mid: 11, a: 5, b: 17 };

// Where a bot looks while holding: the angle it faces (radians, yaw).
// Defenders face west, toward the attackers' approaches.
const HOLD_YAW = { site: Math.PI / 2, mid: Math.PI / 2, a: Math.PI / 2, b: Math.PI / 2 };

function eyeY(e) {
  return e.y + 1.55;
}

function canSee(state, bot, target) {
  const dx = target.x - bot.x;
  const dy = target.y + 0.9 - eyeY(bot);
  const dz = target.z - bot.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > SIGHT_RANGE) return false;
  // Field of view: the target must be in front of the bot's facing.
  const wantYaw = Math.atan2(-dx, -dz);
  let diff = wantYaw - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) > SIGHT_HALF_FOV) return false;
  return hasLineOfSight(bot.x, eyeY(bot), bot.z, target.x, target.y + 0.9, target.z);
}

function nearestVisibleEnemy(state, bot) {
  let best = null;
  let bestD = Infinity;
  for (const e of state.entities) {
    if (!e.alive || e.team === bot.team) continue;
    const dx = e.x - bot.x;
    const dz = e.z - bot.z;
    const d = dx * dx + dz * dz;
    if (d >= bestD) continue;
    if (canSee(state, bot, e)) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

function aimDir(bot, target) {
  const ex = bot.x;
  const ey = eyeY(bot);
  const ez = bot.z;
  const dx = target.x - ex;
  const dy = target.y + 0.9 - ey;
  const dz = target.z - ez;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

function faceToward(bot, tx, tz, rate, dt) {
  const want = Math.atan2(-(tx - bot.x), -(tz - bot.z));
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, diff));
  bot.yaw += step;
}

function walkTo(state, bot, tx, tz, speed, dt) {
  const dx = tx - bot.x;
  const dz = tz - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return true;
  const step = Math.min(dist, speed * dt);
  moveEntity(bot, (dx / dist) * step, (dz / dist) * step, dt);
  bot.speed = speed;
  faceToward(bot, tx, tz, 6, dt);
  return dist - step < 0.6;
}

// --- per-bot think (staggered) ------------------------------------------------
function think(state, bot, api) {
  const b = bot.bot;
  const rng = state.rng;
  // Sight: acquire or lose the current target.
  const seen = nearestVisibleEnemy(state, bot);
  if (seen) {
    if (b.targetId !== seen.id) {
      b.targetId = seen.id;
      b.reactT = 0.3 + rng() * 0.3; // reaction time before the first shot
      b.burstLeft = 0;
      b.burstT = 0;
    }
    b.lastSeen = state.time;
  } else if (b.targetId !== -1 && state.time - b.lastSeen > 0.8) {
    b.targetId = -1;
  }

  // Sound: defenders investigate gunfire they hear; attackers ignore it.
  if (bot.team === 'D' && b.targetId === -1 && b.state !== 'defuse' && b.state !== 'rotate') {
    for (const n of state.noise) {
      const d = Math.hypot(n.x - bot.x, n.z - bot.z);
      if (d < n.radius) {
        b.investigate = { x: n.x, z: n.z };
        b.state = 'investigate';
        b.route = findPath(nearestNode(bot.x, bot.z), nearestNode(n.x, n.z));
        b.nodeIdx = 0;
        break;
      }
    }
  }

  // Bomb planted: every defender rotates to the Depot.
  if (state.bomb.status === 'planted' && bot.team === 'D' && b.state !== 'defuse' && b.state !== 'rotate') {
    b.state = 'rotate';
    b.route = findPath(nearestNode(bot.x, bot.z), 19);
    b.nodeIdx = 0;
    b.investigate = null;
  }
  // Bomb dropped: the nearest alive attacker goes to pick it up.
  if (state.bomb.status === 'dropped' && bot.team === 'A' && b.state !== 'pickup') {
    let closest = null;
    let closestD = Infinity;
    for (const e of state.entities) {
      if (!e.alive || e.team !== 'A' || e.kind !== 'bot') continue;
      const d = Math.hypot(e.x - state.bomb.x, e.z - state.bomb.z);
      if (d < closestD) { closestD = d; closest = e; }
    }
    if (closest === bot) {
      b.state = 'pickup';
      b.route = findPath(nearestNode(bot.x, bot.z), nearestNode(state.bomb.x, state.bomb.z));
      b.nodeIdx = 0;
    }
  }
  // The carrier that just picked the bomb up pushes to the site.
  if (bot.hasBomb && b.state === 'pickup') {
    b.state = 'move';
    b.route = findPath(nearestNode(bot.x, bot.z), 19);
    b.nodeIdx = 0;
  }
}

function targetEntity(state, bot) {
  if (bot.bot.targetId === -1) return null;
  const t = state.entities[bot.bot.targetId];
  return t && t.alive ? t : null;
}

// --- per-step bot update ---------------------------------------------------------
function updateBot(state, bot, dt, api) {
  const b = bot.bot;
  const rng = state.rng;
  if (!bot.alive) return;
  b.thinkT = (b.thinkT ?? 0) - dt;
  if (b.thinkT <= 0) {
    b.thinkT = THINK_EVERY;
    think(state, bot, api);
  }
  const target = targetEntity(state, bot);
  const def = WEAPONS[bot.weapon];

  // --- combat: burst fire at a visible target ---
  if (target) {
    faceToward(bot, target.x, target.z, 8, dt);
    if (b.reactT > 0) {
      b.reactT -= dt;
    } else {
      if (bot.mag <= 0) {
        api.reload(bot);
      } else if (b.burstLeft > 0) {
        b.burstT -= dt;
        if (b.burstT <= 0) {
          b.burstT = 0.11 + rng() * 0.03;
          b.burstLeft -= 1;
          const dist = Math.hypot(target.x - bot.x, target.z - bot.z);
          const err = 1.1 + dist * 0.055 + target.speed * 0.35;
          const dir = aimDir(bot, target);
          api.fire(bot, dir, currentSpread(def, bot.speed, bot.bloom, false, false) + err);
        }
      } else {
        // Between bursts: pause, strafe a little, then fire again.
        b.pauseT = (b.pauseT ?? 0) - dt;
        if (b.pauseT <= 0) {
          b.burstLeft = 3 + Math.floor(rng() * 3);
          b.pauseT = 0.55 + rng() * 0.5;
        }
        // Strafe perpendicular to the target while engaging.
        b.strafeT = (b.strafeT ?? 0) - dt;
        if (b.strafeT <= 0) {
          b.strafeDir = rng() < 0.5 ? -1 : 1;
          b.strafeT = 0.7 + rng() * 0.8;
        }
        const dx = target.x - bot.x;
        const dz = target.z - bot.z;
        const len = Math.hypot(dx, dz) || 1;
        const px = (-dz / len) * b.strafeDir;
        const pz = (dx / len) * b.strafeDir;
        moveEntity(bot, px * 1.6 * dt, pz * 1.6 * dt, dt);
      }
    }
    // An engaged carrier does not plant under fire.
    bot.planting = 0;
    return;
  }

  // --- no target: follow the current job ---
  bot.planting = 0;
  switch (b.state) {
    case 'move':
    case 'pickup':
    case 'rotate':
    case 'investigate': {
      const speed = b.state === 'rotate' ? ROTATE_SPEED : BOT_SPEED;
      if (b.nodeIdx >= b.route.length) {
        // Arrived.
        if (b.state === 'move') {
          b.state = 'hold';
          b.holdT = 0;
        } else if (b.state === 'pickup') {
          b.state = 'move';
          b.route = findPath(nearestNode(bot.x, bot.z), 19);
          b.nodeIdx = 0;
        } else if (b.state === 'investigate') {
          b.state = 'hold';
          b.holdT = 1.5;
        } else if (b.state === 'rotate') {
          b.state = 'defuse';
        }
        break;
      }
      const node = NODES[b.route[b.nodeIdx]];
      const arrived = walkTo(state, bot, node.x, node.z, speed, dt);
      if (arrived) b.nodeIdx += 1;
      break;
    }
    case 'hold': {
      bot.speed = 0;
      moveEntity(bot, 0, 0, dt);
      // Slow scan: sweep the view across the lane the bot is watching.
      b.holdT += dt;
      const base = bot.team === 'D' ? HOLD_YAW[b.lane] ?? Math.PI / 2 : bot.yaw;
      const sweep = Math.sin(b.holdT * 0.5) * 0.6;
      let diff = base + sweep - bot.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      bot.yaw += Math.max(-2.5 * dt, Math.min(2.5 * dt, diff));
      // The carrier plants when it reaches the Depot and the site looks clear.
      if (bot.hasBomb && Math.hypot(bot.x - SITE.x, bot.z - SITE.z) <= SITE.r) {
        b.state = 'plant';
      }
      break;
    }
    case 'plant': {
      bot.speed = 0;
      moveEntity(bot, 0, 0, dt);
      api.plant(bot);
      break;
    }
    case 'defuse': {
      // At the site: defuse when close to the bomb.
      const d = Math.hypot(bot.x - state.bomb.x, bot.z - state.bomb.z);
      if (state.bomb.status === 'planted' && d > 2.5) {
        walkTo(state, bot, state.bomb.x, state.bomb.z, ROTATE_SPEED, dt);
      } else if (state.bomb.status === 'planted') {
        bot.speed = 0;
        moveEntity(bot, 0, 0, dt);
        api.defuse(bot);
      } else {
        b.state = 'hold';
      }
      break;
    }
    default:
      break;
  }
}

export function updateBots(state, dt, api) {
  // Defenders with a hold assignment walk there during freeze; attackers wait.
  for (const e of state.entities) {
    if (e.kind !== 'bot' || !e.alive) continue;
    if (state.phase === 'freeze' && e.team === 'D' && e.bot.state === 'hold' && !e.bot.holdSet) {
      e.bot.holdSet = true;
      const nodeId = HOLD_NODE[e.bot.lane] ?? 19;
      e.bot.route = findPath(nearestNode(e.x, e.z), nodeId);
      e.bot.nodeIdx = 0;
      e.bot.state = 'move';
    }
  }
  for (const e of state.entities) {
    if (e.kind !== 'bot') continue;
    // During freeze nobody moves except defenders walking to their holds.
    if (state.phase === 'freeze' && e.team === 'A') continue;
    if (state.phase === 'freeze' && e.team === 'D') {
      const b = e.bot;
      if (b.state === 'move' && b.nodeIdx < b.route.length) {
        const node = NODES[b.route[b.nodeIdx]];
        if (walkTo(state, e, node.x, node.z, BOT_SPEED, dt)) b.nodeIdx += 1;
        if (b.nodeIdx >= b.route.length) b.state = 'hold';
      }
      continue;
    }
    updateBot(state, e, dt, api);
  }
}
