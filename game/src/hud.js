// SANDLINE HUD: every DOM readout, the buy menu, banners and damage feedback.
// The HUD only reads sim state; it never simulates anything itself.
import { WEAPONS, GRENADE, ARMOR_PRICE, BUY_MENU } from './weapons.js';

function el(id) {
  return document.getElementById(id);
}

export class Hud {
  constructor(onBuy) {
    this.onBuy = onBuy;
    this.cache = {};
    this.hitT = 0;
    this.bannerT = 0;
    this.lastKillfeedLen = 0;
    this.buildBuyMenu();
  }

  $(id) {
    if (!this.cache[id]) this.cache[id] = el(id);
    return this.cache[id];
  }

  buildBuyMenu() {
    const menu = this.$('buy-items');
    if (!menu) return;
    menu.innerHTML = '';
    for (const item of BUY_MENU) {
      let name;
      let price;
      if (item.id === 'frag') {
        name = GRENADE.name;
        price = GRENADE.price;
      } else if (item.id === 'kevlar') {
        name = 'Kevlar Vest';
        price = ARMOR_PRICE;
      } else {
        name = WEAPONS[item.id].name;
        price = WEAPONS[item.id].price;
      }
      const row = document.createElement('button');
      row.className = 'buy-row';
      row.type = 'button';
      row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${name}</span><span class="buy-price">$${price}</span>`;
      row.addEventListener('click', () => this.onBuy(item.id));
      menu.appendChild(row);
    }
  }

  flashHitmarker(headshot) {
    const hm = this.$('hitmarker');
    if (!hm) return;
    hm.classList.add('on');
    if (headshot) hm.classList.add('head');
    this.hitT = 0.12;
  }

  showBanner(title, sub, good) {
    const b = this.$('banner');
    if (!b) return;
    b.querySelector('.banner-title').textContent = title;
    b.querySelector('.banner-sub').textContent = sub || '';
    b.classList.toggle('good', !!good);
    b.classList.toggle('bad', !good);
    b.hidden = false;
    this.bannerT = 3.6;
  }

  hideBanner() {
    const b = this.$('banner');
    if (b) b.hidden = true;
  }

  showDamage(fromAngleRad) {
    // fromAngleRad: world angle of the attacker relative to the player's yaw.
    // 0 = ahead, positive = to the right.
    const ind = this.$('damage-dir');
    const vig = this.$('damage-vignette');
    if (ind) {
      ind.style.transform = `translate(-50%, -50%) rotate(${fromAngleRad}rad)`;
      ind.classList.add('on');
      setTimeout(() => ind.classList.remove('on'), 600);
    }
    if (vig) {
      vig.classList.add('on');
      setTimeout(() => vig.classList.remove('on'), 450);
    }
  }

  showMatchEnd(winner, scoreA, scoreD) {
    const ov = this.$('match-overlay');
    if (!ov) return;
    ov.querySelector('.match-title').textContent =
      winner === 'A' ? 'DUSTERS WIN THE MATCH' : winner === 'D' ? 'RUSTJACKALS WIN THE MATCH' : 'MATCH DRAW';
    ov.querySelector('.match-score').textContent = `${scoreA} — ${scoreD}`;
    ov.hidden = false;
  }

  update(state, player, dt, spreadDeg) {
    // Crosshair spread.
    const ch = this.$('crosshair');
    if (ch) ch.style.setProperty('--gap', `${4 + spreadDeg * 2.2}px`);
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) {
        const hm = this.$('hitmarker');
        if (hm) hm.classList.remove('on', 'head');
      }
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.hideBanner();
    }

    // Bottom-left vitals.
    const hp = Math.max(0, Math.ceil(player.hp));
    this.setText('health-num', String(hp));
    this.setBar('health-bar', hp);
    this.setText('armor-num', String(Math.ceil(player.armor)));
    this.setBar('armor-bar', player.armor);

    // Bottom-right ammo.
    const def = WEAPONS[player.weapon];
    this.setText('ammo-mag', String(player.mag));
    this.setText('ammo-reserve', `/ ${player.reserve}`);
    this.setText('weapon-name', def.name);
    this.setText('grenade-num', `◉ ${player.grenades}`);
    const ammoEl = this.$('ammo');
    if (ammoEl) ammoEl.classList.toggle('empty', player.mag === 0);

    // Top bar: timer, score, money, alive.
    let timerText = '';
    if (state.phase === 'freeze') timerText = `FREEZE ${Math.ceil(state.phaseT)}`;
    else if (state.phase === 'live') timerText = fmtTime(state.roundTime);
    else if (state.phase === 'roundEnd') timerText = 'ROUND OVER';
    else timerText = 'MATCH OVER';
    this.setText('timer', timerText);
    this.setText('score-a', String(state.scoreA));
    this.setText('score-d', String(state.scoreD));
    this.setText('round-num', `ROUND ${state.round}/15`);
    this.setText('money', `$${player.money}`);
    let aAlive = 0;
    let dAlive = 0;
    for (const e of state.entities) {
      if (!e.alive) continue;
      if (e.team === 'A') aAlive += 1;
      else dAlive += 1;
    }
    this.setText('alive-a', `● ${aAlive}`);
    this.setText('alive-d', `● ${dAlive}`);

    // Bomb status line.
    const bs = this.$('bomb-status');
    if (bs) {
      if (state.bomb.status === 'planted') {
        bs.textContent = `BOMB PLANTED — ${Math.ceil(state.bomb.fuseT)}s`;
        bs.classList.add('hot');
      } else if (player.hasBomb) {
        bs.textContent = 'BOMB IN HAND — hold E at the Depot to plant';
        bs.classList.add('hot');
      } else if (state.bomb.status === 'dropped') {
        bs.textContent = 'BOMB DROPPED — pick it up';
        bs.classList.remove('hot');
      } else {
        bs.textContent = '';
        bs.classList.remove('hot');
      }
    }
    const bt = this.$('bomb-timer');
    if (bt) {
      if (state.bomb.status === 'planted') {
        bt.style.width = `${(state.bomb.fuseT / 40) * 100}%`;
        bt.parentElement.hidden = false;
      } else {
        bt.parentElement.hidden = true;
      }
    }

    // Plant / defuse progress.
    this.setProgress('plant-progress', player.planting / 3.5, player.planting > 0, 'PLANTING…');
    this.setProgress('defuse-progress', player.defusing / 5, player.defusing > 0, 'DEFUSING…');

    // Buy menu visibility: freeze, or the first 15 s of the live phase.
    const buyOpen = state.phase === 'freeze' || (state.phase === 'live' && state.buyLeft > 0);
    const menu = this.$('buy-menu');
    if (menu) menu.hidden = !buyOpen || !player.alive;
    if (buyOpen) {
      const t = state.phase === 'freeze' ? Math.ceil(state.phaseT) : Math.ceil(state.buyLeft);
      this.setText('buy-timer', `BUY TIME ${t}s — press B or click`);
    }

    // Killfeed.
    const kf = this.$('killfeed');
    if (kf && state.killfeed.length !== this.lastKillfeedLen) {
      this.lastKillfeedLen = state.killfeed.length;
      kf.innerHTML = '';
      for (const k of state.killfeed.slice(-5)) {
        const row = document.createElement('div');
        row.className = 'kf-row';
        row.innerHTML = `<span class="kf-killer">${escapeHtml(k.killer)}</span>` +
          `<span class="kf-weapon">${escapeHtml(k.weapon)}${k.headshot ? ' ⌖' : ''}</span>` +
          `<span class="kf-victim">${escapeHtml(k.victim)}</span>`;
        kf.appendChild(row);
      }
    }

    // Scope overlay for the Longbow.
    const scope = this.$('scope-overlay');
    if (scope) scope.hidden = !(player.weapon === 'longbow' && state.ads);
  }

  setText(id, text) {
    const n = this.$(id);
    if (n && n.textContent !== text) n.textContent = text;
  }

  setBar(id, pct) {
    const n = this.$(id);
    if (n) n.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  setProgress(id, frac, show, label) {
    const wrap = this.$(id);
    if (!wrap) return;
    wrap.hidden = !show;
    if (show) {
      wrap.querySelector('.prog-fill').style.width = `${Math.round(frac * 100)}%`;
      wrap.querySelector('.prog-label').textContent = label;
    }
  }
}

function fmtTime(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
