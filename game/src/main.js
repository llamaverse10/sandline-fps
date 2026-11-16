// SANDLINE bootstrap: renderer, fixed-step loop, event fan-out (audio + HUD),
// and the ?shot= modes used for the entry's screenshots (real renders of the
// game's own code: the shot only pre-seeds sim state, then freezes it).
import * as THREE from 'three';
import { createGame, stepGame, STEP, eyeHeight } from './sim.js';
import { WEAPONS, currentSpread } from './weapons.js';
import { SITE } from './world.js';
import { buildIntent } from './player.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { AudioSys } from './audio.js';
import { Effects } from './effects.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // spawn | fight | plant | win | null

function main() {
  const container = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8a35c);
  scene.fog = new THREE.Fog(0xd99a5b, 42, 115);
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 300);
  camera.position.set(-28, 1.62, 0);
  scene.add(camera);

  const effects = new Effects(scene);
  effects.attachViewmodel(camera);
  const input = new Input(renderer.domElement);
  const audio = new AudioSys();
  const state = createGame(Date.now() % 2147483647);
  let pendingBuy = null;
  const hud = new Hud((itemId) => { pendingBuy = itemId; });

  let started = false;
  let shotSetupDone = false;
  let overview = null; // { x, y, z, tx, ty, tz } — win-shot camera
  let fov = 75;

  // --- start overlay ---
  const overlay = document.getElementById('overlay');
  const playBtn = document.getElementById('play');
  const startGame = () => {
    audio.ensure();
    input.lock();
    overlay.hidden = true;
    started = true;
  };
  playBtn.addEventListener('click', startGame);
  if (SHOT) {
    overlay.hidden = true;
    started = true;
  }

  // --- match restart ---
  const againBtn = document.getElementById('play-again');
  if (againBtn) againBtn.addEventListener('click', () => location.reload());

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- shot-mode setup: pre-seed real sim state, then freeze it -----------
  function applyShotMode() {
    const p = state.player;
    const bots = state.entities.filter((e) => e.kind === 'bot');
    const byName = (n) => bots.find((b) => b.name === n);
    if (SHOT === 'spawn') {
      state.phase = 'freeze';
      state.phaseT = 2.5;
      state.buyLeft = 12;
      p.x = -27; p.z = 0; p.y = 0; p.yaw = Math.PI / 2 - 0.12; p.pitch = -0.02;
      p.money = 3200;
      p.weapon = 'vk47';
      const d = byName('Dune'); if (d) { d.x = -25.5; d.z = -2.5; d.yaw = Math.PI / 2; }
      const s = byName('Sirocco'); if (s) { s.x = -25.5; s.z = 2.5; s.yaw = Math.PI / 2; }
      const j = byName('Jackal'); if (j) { j.x = 8; j.z = 1; j.yaw = -Math.PI / 2; }
    } else if (SHOT === 'fight') {
      state.phase = 'live';
      state.roundTime = 78;
      state.buyLeft = 0;
      p.x = -6; p.z = 0; p.y = 0; p.yaw = Math.PI / 2 - 0.08; p.pitch = 0.01;
      p.weapon = 'vk47';
      p.mag = 24;
      const j = byName('Jackal');
      if (j) { j.x = 8; j.z = 1; j.y = 0; j.yaw = -Math.PI / 2; j.hp = 62; }
      const v = byName('Viper');
      if (v) { v.x = 12; v.z = -4; v.yaw = -Math.PI / 2 - 0.4; }
      const d = byName('Dune');
      if (d) { d.x = -8; d.z = -3; d.yaw = Math.PI / 2; }
      // One real shot from the player so the frame carries a live tracer,
      // muzzle flash and impact; then the sim freezes and the frame holds.
      const dir = { x: -Math.sin(p.yaw), y: 0, z: -Math.cos(p.yaw) };
      import('./sim.js').then(({ fireWeapon }) => {
        fireWeapon(state, p, dir, 0.4);
        state.killfeed.push({ killer: 'Dune', victim: 'Fennec', weapon: 'vk47', headshot: false, t: state.time });
        hud.flashHitmarker(false);
      });
    } else if (SHOT === 'plant') {
      state.phase = 'live';
      state.roundTime = 54;
      state.buyLeft = 0;
      state.bomb.status = 'planted';
      state.bomb.x = SITE.x;
      state.bomb.z = SITE.z;
      state.bomb.fuseT = 32;
      p.x = 17; p.z = 3; p.y = 0; p.yaw = Math.PI / 2 + 0.35; p.pitch = -0.01;
      p.crouched = true;
      p.weapon = 'mr4';
      const s = byName('Scorpion');
      if (s) { s.x = 24; s.z = -6; s.yaw = -Math.PI / 2 + 0.5; }
      const c = byName('Cobra');
      if (c) { c.x = 27; c.z = 5; c.yaw = -Math.PI / 2; }
    } else if (SHOT === 'win') {
      state.phase = 'roundEnd';
      state.phaseT = 4.5;
      state.scoreA = 1;
      state.scoreD = 0;
      state.roundWinner = 'A';
      state.roundReason = 'Depot detonated';
      p.x = 20; p.z = -2; p.y = 0; p.yaw = Math.PI / 2; p.pitch = 0;
      overview = { x: -2, y: 26, z: 20, tx: 22, ty: 0, tz: -2 };
      hud.showBanner('ROUND WON', 'Depot detonated — Dusters take round 1', true);
    }
    shotSetupDone = true;
  }

  // --- event fan-out ---------------------------------------------------------
  function handleEvents() {
    for (const ev of state.events) {
      switch (ev.type) {
        case 'shot': {
          const by = state.entities[ev.by];
          const kind = by ? WEAPONS[by.weapon].kind : 'rifle';
          const dist = by ? Math.hypot(by.x - state.player.x, by.z - state.player.z) : 0;
          audio.shot(kind, dist);
          if (by && by.kind === 'player') effects.kick(WEAPONS[by.weapon].recoil * 0.02);
          break;
        }
        case 'hit': {
          if (ev.by === state.player.id) {
            hud.flashHitmarker(ev.headshot);
            audio.hit(ev.headshot);
          }
          break;
        }
        case 'hurt': {
          audio.hurt();
          // Direction: from the most recent hit on the player.
          const lastHit = [...state.events].reverse().find((e) => e.type === 'hit' && e.victim === state.player.id);
          if (lastHit) {
            const atk = state.entities[lastHit.by];
            if (atk) {
              const want = Math.atan2(-(atk.x - state.player.x), -(atk.z - state.player.z));
              hud.showDamage(want - state.player.yaw);
            }
          }
          break;
        }
        case 'kill':
          if (ev.by === state.player.id) audio.kill();
          break;
        case 'dryfire':
          if (ev.by === state.player.id) audio.dryFire();
          break;
        case 'reload':
          if (ev.by === state.player.id) audio.reload();
          break;
        case 'explode': {
          const d = Math.hypot(ev.x - state.player.x, ev.z - state.player.z);
          audio.explosion(d);
          break;
        }
        case 'footstep':
          if (ev.by === state.player.id) audio.footstep(state.player.speed > 4);
          break;
        case 'buy':
          if (ev.by === state.player.id) audio.buy();
          break;
        case 'roundStart':
          audio.roundStart();
          hud.showBanner(`ROUND ${ev.round}`, 'Plant the bomb at the Depot — first to 8', true);
          break;
        case 'roundEnd': {
          const won = ev.winner === 'A';
          hud.showBanner(won ? 'ROUND WON' : 'ROUND LOST', ev.reason, won);
          if (won) audio.roundWin();
          else audio.roundLose();
          break;
        }
        case 'matchEnd':
          hud.showMatchEnd(ev.winner, state.scoreA, state.scoreD);
          break;
        case 'planted':
          audio.plant();
          hud.showBanner('BOMB PLANTED', 'Defend the Depot until detonation', true);
          break;
        case 'detonated':
          audio.explosion(0);
          hud.showBanner('DEPOT DETONATED', 'Attackers take the round', true);
          break;
        case 'playerDied':
          hud.showBanner("YOU'RE DOWN", 'Your squad fights on', false);
          break;
        default:
          break;
      }
    }
    state.events.length = 0;
  }

  // --- main loop ---------------------------------------------------------------
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (SHOT && !shotSetupDone) applyShotMode();

    if (started) {
      const intent = buildIntent(input, state.player);
      if (pendingBuy) { intent.buyKey = pendingBuy; pendingBuy = null; }
      state.ads = intent.ads;
      if (intent.buyMenu) {
        const menu = document.getElementById('buy-menu');
        if (menu) menu.hidden = !menu.hidden;
      }
      if (!SHOT) {
        // Fixed-step simulation, decoupled from the render rate.
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < 5) {
          stepGame(state, intent, STEP);
          acc -= STEP;
          steps += 1;
        }
        if (steps === 5) acc = 0;
        // Semi-auto weapons must not refire from a stale held click.
        if (!WEAPONS[state.player.weapon].auto) intent.firing = false;
      }
      handleEvents();
      // ADS field of view.
      const targetFov = state.ads ? 32 : 75;
      if (Math.abs(targetFov - fov) > 0.1) {
        fov += (targetFov - fov) * Math.min(1, dt * 10);
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }

    const spread = currentSpread(
      WEAPONS[state.player.weapon],
      state.player.speed,
      state.player.bloom,
      state.player.crouched,
      !!state.ads,
    );
    effects.update(state, SHOT ? 0 : dt, camera, state.player);
    if (overview) {
      camera.position.set(overview.x, overview.y, overview.z);
      camera.lookAt(overview.tx, overview.ty, overview.tz);
      effects.viewmodel.visible = false;
    }
    hud.update(state, state.player, SHOT ? 0 : dt, spread);
    renderer.render(scene, camera);
  }

  // Debug handle for shot verification (read-only state inspection).
  window.__sandline = { state };
  requestAnimationFrame(frame);
}

main();
