// SANDLINE weapons: original names, Counter-Strike-style roles.
// Every weapon is hitscan with damage falloff, recoil and spread bloom.
// Spread is in degrees; damage falls off past 20 m; headshots deal double.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9', kind: 'pistol', price: 0,
    damage: 34, headMult: 2, rpm: 360, auto: false,
    mag: 12, reserve: 36, reload: 1.4,
    spreadBase: 0.55, spreadMove: 1.6, spreadBloom: 0.55, spreadMax: 3.2,
    recoil: 0.55, rangeFalloff: 0.75, tracer: 0xffd27a,
  },
  vk47: {
    id: 'vk47', name: 'VK-47', kind: 'rifle', price: 2700,
    damage: 33, headMult: 2, rpm: 600, auto: true,
    mag: 30, reserve: 90, reload: 2.5,
    spreadBase: 0.5, spreadMove: 2.2, spreadBloom: 0.5, spreadMax: 4.5,
    recoil: 0.8, rangeFalloff: 0.85, tracer: 0xffc46b,
  },
  mr4: {
    id: 'mr4', name: 'MR-4', kind: 'rifle', price: 3100,
    damage: 30, headMult: 2, rpm: 750, auto: true,
    mag: 25, reserve: 75, reload: 2.2,
    spreadBase: 0.35, spreadMove: 1.9, spreadBloom: 0.42, spreadMax: 3.8,
    recoil: 0.65, rangeFalloff: 0.85, tracer: 0xffc46b,
  },
  kestrel: {
    id: 'kestrel', name: 'Kestrel', kind: 'smg', price: 1500,
    damage: 26, headMult: 2, rpm: 900, auto: true,
    mag: 32, reserve: 96, reload: 2.0,
    spreadBase: 0.8, spreadMove: 2.6, spreadBloom: 0.5, spreadMax: 5.0,
    recoil: 0.5, rangeFalloff: 0.65, tracer: 0xffe08a,
  },
  longbow: {
    id: 'longbow', name: 'Longbow', kind: 'sniper', price: 4750,
    damage: 110, headMult: 2, rpm: 48, auto: false, bolt: true,
    mag: 5, reserve: 15, reload: 3.2,
    spreadBase: 0.05, spreadMove: 4.5, spreadBloom: 1.2, spreadMax: 6.0,
    recoil: 2.6, rangeFalloff: 1.0, tracer: 0xfff2c0,
  },
};

export const GRENADE = {
  id: 'frag', name: 'Frag Grenade', price: 300,
  fuse: 1.6, radius: 6.5, damage: 120, throwSpeed: 13,
};

export const ARMOR_PRICE = 650;
export const ARMOR_ABSORB = 0.5; // half of incoming damage is taken by armor first

// Buy menu entries in display order: [key, weapon id or 'kevlar' / 'frag'].
export const BUY_MENU = [
  { key: '1', id: 'vk47' },
  { key: '2', id: 'mr4' },
  { key: '3', id: 'kestrel' },
  { key: '4', id: 'longbow' },
  { key: '5', id: 'frag' },
  { key: '6', id: 'kevlar' },
];

// --- firing math (pure, shared by player and bots) -------------------------
// Current spread in degrees for a shooter with this weapon, movement speed
// and bloom. Stopping to aim pays: moving and spraying both widen the cone.
export function currentSpread(def, moveSpeed, bloom, crouched, scoped) {
  let s = def.spreadBase + bloom;
  s += (moveSpeed / 4.6) * def.spreadMove;
  if (crouched) s *= 0.75;
  if (scoped) s *= 0.25;
  return Math.min(s, def.spreadMax);
}

// Damage at a range, before armor and headshot multiplier.
export function damageAtRange(def, dist) {
  if (dist <= 20) return def.damage;
  const f = Math.max(def.rangeFalloff, 1 - (dist - 20) * 0.012);
  return def.damage * f;
}

// Split damage between health and armor. Returns { hp, armor } damage dealt.
export function applyArmor(damage, armor) {
  if (armor <= 0) return { hp: damage, armor: 0 };
  const absorbed = Math.min(armor, damage * ARMOR_ABSORB);
  return { hp: damage - absorbed, armor: absorbed };
}

// Fire interval in seconds from rpm.
export function fireInterval(def) {
  return 60 / def.rpm;
}
