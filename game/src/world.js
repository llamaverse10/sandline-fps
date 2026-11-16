// SANDLINE world: map geometry, collision and the bot waypoint graph.
// The map is a desert freight outpost, 64 x 48 m, with three lanes:
//   A lane  - the north rail line (long sightline, rail cars as cover)
//   Mid     - crate yard with an elevated platform
//   B alley - the south walled alley
// The Depot (bombsite) sits at the east end; attackers spawn west, defenders east.
// All collision is axis-aligned boxes. A box is { x0, z0, x1, z1, y0, y1, type }.
// type drives the material: 'sand' | 'rust' | 'teal' | 'wood' | 'darkwood' |
// 'barrel' | 'rail' | 'railrust' | 'concrete' | 'ground' (walkable deck).

export const MAP = { x0: -32, x1: 32, z0: -24, z1: 24 };

// --- static geometry -------------------------------------------------------
function box(x0, z0, x1, z1, y0, y1, type) {
  return { x0, z0, x1, z1, y0, y1, type };
}

export const BOXES = [
  // Perimeter walls (height 4)
  box(-32, -24, 32, -23, 0, 4, 'sand'),
  box(-32, 23, 32, 24, 0, 4, 'sand'),
  box(-32, -24, -31, 24, 0, 4, 'rust'),
  box(31, -24, 32, 24, 0, 4, 'rust'),

  // A-lane south wall (gap x -8..8 is the mid -> A connector)
  box(-28, -12, -8, -11, 0, 3.2, 'sand'),
  box(8, -12, 22, -11, 0, 3.2, 'sand'),
  // A-lane east end wall (gap z -12..-10 leads into the Depot north)
  box(22, -23, 23, -13, 0, 3.2, 'rust'),

  // B-lane north wall (gap x 10..16 is the mid -> B connector)
  box(-28, 11, 10, 12, 0, 3.2, 'sand'),
  box(16, 11, 30, 12, 0, 3.2, 'sand'),
  // B-lane east end wall (gap z 11..14 leads into the Depot south)
  box(22, 14, 23, 23, 0, 3.2, 'rust'),

  // --- Rail cars on the A lane (long steel boxes, height 2.6) ---
  box(-21, -17.5, -15, -15.5, 0, 2.6, 'rail'),
  box(-9, -18.5, -3, -16.5, 0, 2.6, 'railrust'),
  box(3, -17.5, 9, -15.5, 0, 2.6, 'rail'),

  // --- Crates in mid (wood, assorted heights) ---
  box(-15.5, -1.5, -13.5, 0.5, 0, 1.2, 'wood'),
  box(-14.5, 1.5, -12.5, 3.5, 0, 1.2, 'wood'),
  box(-7, 2, -5, 4, 0, 2.4, 'wood'),
  box(-7, -4, -5, -2, 0, 1.2, 'darkwood'),
  box(1, -4.5, 3, -2.5, 0, 1.2, 'wood'),
  box(9, 1, 11, 3, 0, 2.4, 'darkwood'),
  box(15, -3.5, 17, -1.5, 0, 1.2, 'wood'),
  box(17.5, 1.5, 19.5, 3.5, 0, 1.2, 'wood'),

  // --- Crates in the B alley ---
  box(-17, 14.5, -15, 16.5, 0, 1.2, 'wood'),
  box(-1, 14, 1, 16, 0, 2.4, 'darkwood'),
  box(11, 14.5, 13, 16.5, 0, 1.2, 'wood'),

  // --- Depot (bombsite) containers, silo and crates ---
  box(21, -8, 24, -5, 0, 2.6, 'teal'),
  box(25, 4, 28, 7, 0, 2.6, 'rust'),
  box(27.5, -9.5, 30.5, -6.5, 0, 3.4, 'teal'), // silo block
  box(21.5, 1, 23.5, 3, 0, 1.2, 'wood'),
  box(27, -2, 29, 0, 0, 1.2, 'wood'),

  // --- Barrels (approximated as square boxes, rendered as cylinders) ---
  box(-24, -20, -23, -19, 0, 1.1, 'barrel'),
  box(-23, -20, -22, -19, 0, 1.1, 'barrel'),
  box(5, -20, 6, -19, 0, 1.1, 'barrel'),
  box(-12, 19, -11, 20, 0, 1.1, 'barrel'),
  box(18, 17, 19, 18, 0, 1.1, 'barrel'),
  box(25, -12, 26, -11, 0, 1.1, 'barrel'),

  // --- Elevated platform (mid-east) with steps on its west side ---
  // Deck: walkable top at y 2.4. Steps rise 0.8 at a time (step-up allowance is 0.9).
  box(10.4, -9, 18, -3, 0, 2.4, 'concrete'),
  box(9.2, -8, 10.4, -4, 0, 1.6, 'concrete'),
  box(8, -8, 9.2, -4, 0, 0.8, 'concrete'),
];

// Bombsite: centre + radius (planting must happen inside this circle, on the ground).
export const SITE = { x: 25, z: 0, r: 6.5 };
export const SPAWNS = {
  attack: { x: -28, z: 0, yaw: -Math.PI / 2 }, // facing east (+x): dir = (-sin yaw, -cos yaw)
  defend: { x: 28, z: 0, yaw: Math.PI / 2 }, // facing west (-x)
};

// --- collision -------------------------------------------------------------
// Step-up allowance: an entity may climb onto a box top at most this far above
// its feet (lets players and bots use the platform steps; walls stay unclimbable).
export const STEP_UP = 0.9;

// Highest walkable surface under a footprint centred at (x, z) whose top is at
// most `feetY + STEP_UP`. Returns 0 (the sand) when nothing is underfoot.
export function groundHeight(x, z, feetY) {
  let g = 0;
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    if (x >= b.x0 - 0.2 && x <= b.x1 + 0.2 && z >= b.z0 - 0.2 && z <= b.z1 + 0.2) {
      if (b.y1 > g && b.y1 <= feetY + STEP_UP && b.y0 <= feetY + 0.01) g = b.y1;
    }
  }
  return g;
}

// Move an AABB (half extents hx, hz; height h, feet at y) along one axis and
// resolve against the boxes. Returns the new coordinate on that axis.
export function moveAxis(pos, axis, delta, hx, hz, h) {
  if (delta === 0) return pos[axis];
  const next = pos[axis] + delta;
  const minX = axis === 'x' ? next - hx : pos.x - hx;
  const maxX = axis === 'x' ? next + hx : pos.x + hx;
  const minZ = axis === 'z' ? next - hz : pos.z - hz;
  const maxZ = axis === 'z' ? next + hz : pos.z + hz;
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    // Only boxes that overlap the entity vertically can block it. A box whose
    // top is within step-up range is climbable, not blocking.
    if (b.y1 <= pos.y + STEP_UP) continue;
    if (b.y0 >= pos.y + h) continue;
    if (maxX <= b.x0 || minX >= b.x1 || maxZ <= b.z0 || minZ >= b.z1) continue;
    // Blocked: stop at the box face.
    if (axis === 'x') return delta > 0 ? b.x0 - hx : b.x1 + hx;
    return delta > 0 ? b.z0 - hz : b.z1 + hz;
  }
  return next;
}

// Ray vs AABB (slab method). Returns distance along the ray or Infinity.
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  // X slab
  let t1 = (b.x0 - ox) / dx;
  let t2 = (b.x1 - ox) / dx;
  if (dx === 0) { if (ox < b.x0 || ox > b.x1) return Infinity; } else {
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  // Y slab
  t1 = (b.y0 - oy) / dy;
  t2 = (b.y1 - oy) / dy;
  if (dy === 0) { if (oy < b.y0 || oy > b.y1) return Infinity; } else {
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  // Z slab
  t1 = (b.z0 - oz) / dz;
  t2 = (b.z1 - oz) / dz;
  if (dz === 0) { if (oz < b.z0 || oz > b.z1) return Infinity; } else {
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// Nearest wall hit along a ray, or Infinity when nothing is hit.
export function rayWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = Infinity;
  for (let i = 0; i < BOXES.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, BOXES[i], maxDist);
    if (t < best) best = t;
  }
  return best;
}

// Line of sight between two points (eye height given by the caller's y).
export function hasLineOfSight(ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 0.001) return true;
  const t = rayWorld(ax, ay, az, dx / dist, dy / dist, dz / dist, dist);
  return t >= dist - 0.05;
}

// Move an entity (player or bot) by (dx, dz) with AABB collision, then apply
// gravity and snap to the ground. Shared by the sim and the bot AI.
export function moveEntity(e, dx, dz, dt) {
  const h = e.crouched ? 1.15 : 1.7;
  e.x = moveAxis(e, 'x', dx, 0.35, 0.35, h);
  e.z = moveAxis(e, 'z', dz, 0.35, 0.35, h);
  e.vy -= 22 * dt;
  e.y += e.vy * dt;
  const g = groundHeight(e.x, e.z, e.y);
  if (e.y <= g) {
    e.y = g;
    e.vy = 0;
    e.onGround = true;
  } else {
    e.onGround = false;
  }
}

// --- waypoint graph --------------------------------------------------------
// Nodes are { x, z, y } (y = ground height: 0, or 2.4 on the platform deck).
// Edges are bidirectional; bots walk node to node.
export const NODES = [
  { id: 0, x: -27, z: 0, y: 0 }, // ATK spawn
  { id: 1, x: -28, z: -16, y: 0 }, // A0
  { id: 2, x: -18, z: -16, y: 0 }, // A1
  { id: 3, x: -8, z: -16, y: 0 }, // A2
  { id: 4, x: 2, z: -16, y: 0 }, // A3
  { id: 5, x: 12, z: -16, y: 0 }, // A4
  { id: 6, x: 20, z: -14, y: 0 }, // A5
  { id: 7, x: -26, z: 0, y: 0 }, // M0
  { id: 8, x: -14, z: 0, y: 0 }, // M1
  { id: 9, x: -4, z: 0, y: 0 }, // M2
  { id: 10, x: 6, z: 0, y: 0 }, // M3
  { id: 11, x: 14, z: 0, y: 0 }, // M4
  { id: 12, x: 20, z: 0, y: 0 }, // M5
  { id: 13, x: -28, z: 16, y: 0 }, // B0
  { id: 14, x: -16, z: 16, y: 0 }, // B1
  { id: 15, x: -4, z: 16, y: 0 }, // B2
  { id: 16, x: 8, z: 16, y: 0 }, // B3
  { id: 17, x: 14, z: 14, y: 0 }, // B4
  { id: 18, x: 24, z: -8, y: 0 }, // S1 site north
  { id: 19, x: 24, z: 0, y: 0 }, // S0 site centre
  { id: 20, x: 24, z: 8, y: 0 }, // S2 site south
  { id: 21, x: 27, z: 0, y: 0 }, // DEF spawn
  { id: 22, x: -2, z: -11, y: 0 }, // G1 mid->A connector
  { id: 23, x: 13, z: 11, y: 0 }, // G2 mid->B connector
  { id: 24, x: 14, z: -6, y: 2.4 }, // P1 platform deck
];

const EDGES = [
  [0, 1], [0, 7], [0, 13],
  [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 18],
  [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 19],
  [13, 14], [14, 15], [15, 16], [16, 17], [17, 20],
  [3, 22], [4, 22], [9, 22], [10, 22],
  [11, 23], [12, 23], [16, 23], [17, 23],
  [18, 19], [19, 20], [19, 21], [18, 21], [20, 21],
  [11, 24], [24, 18], [24, 5],
];

export const ADJ = NODES.map(() => []);
for (const [a, b] of EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

// Breadth-first shortest path between two node ids. Returns node ids.
export function findPath(fromId, toId) {
  if (fromId === toId) return [fromId];
  const prev = new Array(NODES.length).fill(-1);
  const queue = [fromId];
  prev[fromId] = fromId;
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const nb of ADJ[cur]) {
      if (prev[nb] !== -1) continue;
      prev[nb] = cur;
      if (nb === toId) {
        const path = [toId];
        let n = toId;
        while (n !== fromId) { n = prev[n]; path.unshift(n); }
        return path;
      }
      queue.push(nb);
    }
  }
  return [fromId];
}

// Nearest node to a position (used to snap a bot onto the graph).
export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (const n of NODES) {
    const dx = n.x - x;
    const dz = n.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = n.id; }
  }
  return best;
}

// Named lanes as node sequences from attacker spawn to the Depot.
export const LANES = {
  a: [1, 2, 3, 4, 5, 6, 18, 19],
  mid: [7, 8, 9, 10, 11, 12, 19],
  b: [13, 14, 15, 16, 17, 20, 19],
  platform: [7, 8, 9, 10, 11, 24, 18, 19],
};
