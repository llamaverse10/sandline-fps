// SANDLINE effects: everything three.js renders that is not the HUD.
// Builds the map meshes once from world.BOXES, keeps one mesh per bot, and
// pools tracers / flashes / explosion spheres so the hot loop allocates nothing.
import * as THREE from 'three';
import { BOXES, SITE, MAP } from './world.js';
import { PALETTE, makeMaterials } from './palette.js';

const MAX_TRACERS = 24;
const MAX_IMPACTS = 64;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.mats = makeMaterials(THREE);
    this.botMeshes = new Map();
    this.tracerPool = [];
    this.flashPool = [];
    this.explosionPool = [];
    this.viewmodel = null;
    this.muzzleTip = null;
    this.recoil = 0;
    this.bobPhase = 0;
    this.buildLights();
    this.buildGround();
    this.buildMap();
    this.buildSiteMarker();
    this.buildDust();
    this.buildTracers();
    this.buildFlashes();
    this.buildExplosions();
    this.buildViewmodel();
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xffd9a0, 0x8a6a4a, 1.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffb36b, 2.8);
    sun.position.set(-30, 38, -18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -38;
    sun.shadow.camera.right = 38;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.sun = sun;
    // Low amber sun disc on the horizon (east, where the Depot sits).
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0xffc46b, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    sunSprite.scale.set(26, 26, 1);
    sunSprite.position.set(90, 14, 0);
    this.scene.add(sunSprite);
  }

  buildGround() {
    const geo = new THREE.PlaneGeometry(MAP.x1 - MAP.x0, MAP.z1 - MAP.z0);
    const ground = new THREE.Mesh(geo, this.mats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    // Dark sand drifts for texture variety (flat, barely above the ground).
    const driftGeo = new THREE.PlaneGeometry(1, 1);
    const driftSpots = [
      [-20, -6, 9, 5], [-8, 8, 7, 4], [4, -14, 8, 4], [16, 8, 6, 5],
      [-2, 18, 8, 4], [24, -16, 7, 4], [-26, 12, 6, 4], [10, -20, 9, 3],
    ];
    for (const [x, z, w, d] of driftSpots) {
      const m = new THREE.Mesh(driftGeo, this.mats.groundDark);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.02, z);
      m.scale.set(w, d, 1);
      m.receiveShadow = true;
      this.scene.add(m);
    }
    // Scattered rocks.
    const rockGeo = new THREE.DodecahedronGeometry(0.35, 0);
    const rocks = [[-24, -9], [-10, -18], [2, 12], [18, -18], [26, 14], [-16, 20], [8, 20]];
    for (const [x, z] of rocks) {
      const r = new THREE.Mesh(rockGeo, this.mats.concrete);
      r.position.set(x, 0.18, z);
      r.scale.set(1 + (x % 3) * 0.2, 0.6, 1);
      r.rotation.y = x;
      r.castShadow = true;
      this.scene.add(r);
    }
  }

  buildMap() {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 12);
    for (const b of BOXES) {
      const mat = this.mats[b.type] || this.mats.wallSand;
      let mesh;
      if (b.type === 'barrel') {
        mesh = new THREE.Mesh(barrelGeo, mat);
        mesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      } else {
        mesh = new THREE.Mesh(boxGeo, mat);
        mesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
        mesh.scale.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  buildSiteMarker() {
    // Glowing ring on the sand + a soft vertical beam so the Depot reads at a glance.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(SITE.r - 0.35, SITE.r, 48),
      new THREE.MeshBasicMaterial({ color: PALETTE.siteGlow, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(SITE.x, 0.05, SITE.z);
    this.scene.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 9, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: PALETTE.siteGlow, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.set(SITE.x, 4.5, SITE.z);
    this.scene.add(beam);
    // Floating DEPOT sign (canvas texture, generated at runtime).
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e2228';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#f0a830';
    ctx.lineWidth = 4;
    ctx.strokeRect(3, 3, 250, 58);
    ctx.fillStyle = '#f0a830';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▲ DEPOT ▲', 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 1.25),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
    );
    sign.position.set(SITE.x, 4.4, SITE.z - 7);
    this.scene.add(sign);
    this.siteRing = ring;
  }

  buildDust() {
    // Ambient dust motes drifting over the outpost.
    const count = 260;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 64;
      pos[i * 3 + 1] = Math.random() * 9 + 0.3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 48;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xe8c090, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    this.scene.add(this.dust);
  }

  buildTracers() {
    for (let i = 0; i < MAX_TRACERS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: PALETTE.tracer, transparent: true, opacity: 0,
      }));
      line.frustumCulled = false;
      this.scene.add(line);
      this.tracerPool.push(line);
    }
  }

  buildFlashes() {
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        color: PALETTE.muzzle, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      s.scale.set(0.9, 0.9, 1);
      this.scene.add(s);
      this.flashPool.push(s);
    }
    this.flashLight = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
    this.scene.add(this.flashLight);
  }

  buildExplosions() {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 18, 12),
        new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, depthWrite: false }),
      );
      this.scene.add(m);
      const light = new THREE.PointLight(0xff8a2a, 0, 26, 1.6);
      this.scene.add(light);
      this.explosionPool.push({ mesh: m, light });
    }
  }

  buildViewmodel() {
    // A blocky rifle assembled from boxes, parented to the camera.
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a332e, roughness: 0.6, metalness: 0.4 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.5, metalness: 0.55 });
    const add = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || steel);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    add(0.09, 0.11, 0.62, 0, 0, -0.1); // receiver
    add(0.05, 0.05, 0.42, 0, 0.02, -0.5); // barrel
    add(0.07, 0.16, 0.1, 0, -0.1, 0.05, dark); // grip
    add(0.06, 0.14, 0.12, 0, -0.11, -0.12, dark); // magazine
    add(0.03, 0.06, 0.1, 0, 0.09, -0.05); // sight
    add(0.1, 0.09, 0.2, 0, -0.01, 0.28, dark); // stock
    this.muzzleTip = new THREE.Object3D();
    this.muzzleTip.position.set(0, 0.02, -0.72);
    g.add(this.muzzleTip);
    g.scale.setScalar(0.65);
    g.position.set(0.32, -0.3, -0.45);
    this.viewmodel = g;
    this.viewmodelBase = g.position.clone();
  }

  attachViewmodel(camera) {
    camera.add(this.viewmodel);
    // A soft fill light on the camera so the viewmodel and near walls read.
    this.fill = new THREE.PointLight(0xffe0b0, 1.6, 2.6, 1.4);
    this.fill.position.set(0.2, 0.15, 0.1);
    camera.add(this.fill);
  }

  // One bot mesh per entity, built lazily.
  botMesh(e) {
    let m = this.botMeshes.get(e.id);
    if (m) return m;
    const g = new THREE.Group();
    const teamMat = e.team === 'A' ? this.mats.teamAttack : this.mats.teamDefend;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 1.05, 10), teamMat);
    body.position.y = 0.85;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), this.mats.dark);
    head.position.y = 1.56;
    head.castShadow = true;
    g.add(head);
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.05, 0.05),
      new THREE.MeshBasicMaterial({ color: e.team === 'A' ? 0xffd27a : 0x7ae8ff }),
    );
    visor.position.set(0, 1.58, -0.19);
    g.add(visor);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), this.mats.dark);
    gun.position.set(0.22, 1.05, -0.3);
    g.add(gun);
    // Team-coloured shoulder stripe so sides read at a glance.
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.08, 0.06),
      new THREE.MeshBasicMaterial({ color: e.team === 'A' ? PALETTE.teamAttack : PALETTE.teamDefend }),
    );
    stripe.position.set(0, 1.32, -0.31);
    g.add(stripe);
    this.scene.add(g);
    this.botMeshes.set(e.id, g);
    return g;
  }

  kick(amount) {
    this.recoil = Math.min(0.12, this.recoil + amount);
  }

  update(state, dt, camera, player) {
    // --- bots ---
    for (const e of state.entities) {
      if (e.kind !== 'bot') continue;
      const m = this.botMesh(e);
      m.position.set(e.x, e.y, e.z);
      if (e.alive) {
        m.rotation.set(0, e.yaw, 0);
        m.visible = true;
      } else {
        // Fallen: lie on the sand, fading out.
        m.rotation.set(-Math.PI / 2, e.yaw, 0);
        m.position.y = Math.max(0.25, e.y + 0.25);
        m.visible = true;
      }
    }
    // --- tracers ---
    for (let i = 0; i < MAX_TRACERS; i++) {
      const line = this.tracerPool[i];
      const t = state.tracers[i];
      if (t) {
        const p = line.geometry.attributes.position.array;
        p[0] = t.x1; p[1] = t.y1; p[2] = t.z1;
        p[3] = t.x2; p[4] = t.y2; p[5] = t.z2;
        line.geometry.attributes.position.needsUpdate = true;
        line.material.opacity = Math.min(0.9, t.ttl / 0.07);
        line.visible = true;
      } else {
        line.visible = false;
      }
    }
    // --- muzzle flashes ---
    let flashOn = false;
    for (let i = 0; i < this.flashPool.length; i++) {
      const s = this.flashPool[i];
      const f = state.flashes[i];
      if (f) {
        s.position.set(f.x, f.y, f.z);
        s.material.opacity = Math.min(1, f.ttl / 0.05);
        s.visible = true;
        flashOn = true;
        if (i === 0) {
          this.flashLight.position.set(f.x, f.y, f.z);
          this.flashLight.intensity = 14;
        }
      } else {
        s.visible = false;
      }
    }
    if (!flashOn) this.flashLight.intensity = 0;
    // --- explosions ---
    for (let i = 0; i < this.explosionPool.length; i++) {
      const slot = this.explosionPool[i];
      const ex = state.explosions[i];
      if (ex) {
        const age = 0.6 - ex.ttl;
        const r = 0.6 + age * 9;
        slot.mesh.position.set(ex.x, ex.y + 0.6, ex.z);
        slot.mesh.scale.setScalar(r);
        slot.mesh.material.opacity = Math.max(0, (ex.ttl / 0.6) * 0.75);
        slot.mesh.visible = true;
        slot.light.position.set(ex.x, ex.y + 1.5, ex.z);
        slot.light.intensity = 30 * (ex.ttl / 0.6);
      } else {
        slot.mesh.visible = false;
        slot.light.intensity = 0;
      }
    }
    // --- site ring pulse ---
    if (this.siteRing) {
      const pulse = state.bomb.status === 'planted' ? 0.9 : 0.45 + Math.sin(state.time * 2.4) * 0.15;
      this.siteRing.material.opacity = pulse;
    }
    // --- dust drift ---
    if (this.dust) {
      this.dust.rotation.y = state.time * 0.004;
    }
    // --- viewmodel bob + recoil ---
    if (this.viewmodel) {
      const moving = player.speed > 0.1 && player.onGround;
      if (moving) this.bobPhase += dt * player.speed * 2.2;
      const bobY = moving ? Math.sin(this.bobPhase * 2) * 0.012 : 0;
      const bobX = moving ? Math.cos(this.bobPhase) * 0.008 : 0;
      this.recoil = Math.max(0, this.recoil - dt * 0.55);
      const ads = state.ads;
      const tx = ads ? 0 : this.viewmodelBase.x + bobX;
      const ty = ads ? -0.245 : this.viewmodelBase.y + bobY;
      const tz = this.viewmodelBase.z + this.recoil;
      this.viewmodel.position.set(tx, ty, tz);
      this.viewmodel.visible = !ads || player.weapon !== 'longbow';
    }
    // --- camera ---
    camera.position.set(player.x, player.y + (player.crouched ? 1.05 : 1.62), player.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
  }
}
