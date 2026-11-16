// SANDLINE palette: a desert freight outpost at dusk.
// Sand and ochre ground, rust steel, weathered teal containers, one warm amber sun.
// Every colour in the game comes from here so the look stays coherent.
export const PALETTE = {
  sky: 0xe8a35c, // dusk gradient backdrop (fog + clear colour)
  fog: 0xd99a5b,
  ground: 0xc89b6a, // packed sand
  groundDark: 0xa87f52, // trampled sand, darker patches
  wallSand: 0xb98a5a, // adobe / sandstone walls
  wallRust: 0x8a4a32, // rusted steel walls
  wallTeal: 0x2e6f6a, // weathered teal container steel
  crateWood: 0x9a6b3f, // wooden crates
  crateDark: 0x6e4a2c, // dark crate trim
  barrelRust: 0x7c3f28, // rust barrels
  railSteel: 0x4a3f3a, // dark rail cars
  railRust: 0x6b4a35,
  concrete: 0x8f8578, // platform deck
  accentAmber: 0xf0a830, // sun / UI accent / site marker
  siteGlow: 0xffb84d, // bombsite marker glow
  teamAttack: 0xe07840, // attackers (player team): rust orange
  teamDefend: 0x2e8f86, // defenders: teal
  muzzle: 0xffd27a,
  tracer: 0xffc46b,
  health: 0x7ec850,
  damage: 0xe0483c,
};

// Flat (non-metallic) materials read well in the dusk light and are cheap.
export function makeMaterials(THREE) {
  const mat = (color, opts = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.0, ...opts });
  const metal = (color, opts = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.55, ...opts });
  return {
    ground: mat(PALETTE.ground),
    groundDark: mat(PALETTE.groundDark),
    wallSand: mat(PALETTE.wallSand),
    wallRust: metal(PALETTE.wallRust, { roughness: 0.7, metalness: 0.35 }),
    wallTeal: metal(PALETTE.wallTeal, { roughness: 0.65, metalness: 0.4 }),
    crateWood: mat(PALETTE.crateWood),
    crateDark: mat(PALETTE.crateDark),
    barrelRust: metal(PALETTE.barrelRust, { roughness: 0.6, metalness: 0.5 }),
    railSteel: metal(PALETTE.railSteel, { roughness: 0.5, metalness: 0.6 }),
    railRust: metal(PALETTE.railRust, { roughness: 0.7, metalness: 0.4 }),
    concrete: mat(PALETTE.concrete),
    accent: mat(PALETTE.accentAmber, { emissive: PALETTE.accentAmber, emissiveIntensity: 0.35 }),
    siteGlow: new THREE.MeshBasicMaterial({ color: PALETTE.siteGlow, transparent: true, opacity: 0.55 }),
    teamAttack: mat(PALETTE.teamAttack, { roughness: 0.8 }),
    teamDefend: mat(PALETTE.teamDefend, { roughness: 0.8 }),
    dark: mat(0x2a2320),
  };
}
