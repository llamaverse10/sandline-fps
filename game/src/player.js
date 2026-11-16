// SANDLINE player controller: turns raw input state into the intent object
// the fixed-step sim consumes. Mouse look, semi/auto trigger discipline,
// buy keys, grenade and reload edges all live here — the sim stays pure.
import { WEAPONS, BUY_MENU } from './weapons.js';

const SENS = 0.0022;

export function buildIntent(input, player) {
  const mouse = input.drainMouse();
  let yaw = player.yaw - mouse.dx * SENS;
  let pitch = player.pitch - mouse.dy * SENS;
  pitch = Math.max(-1.45, Math.min(1.45, pitch));

  const def = WEAPONS[player.weapon];
  // Auto weapons fire while held; semi/bolt weapons fire on the click edge.
  const firing = def.auto ? input.mouseDown : mouse.edge;

  let buyKey = null;
  if (input.edge('Digit1') || input.edge('Digit2') || input.edge('Digit3') ||
      input.edge('Digit4') || input.edge('Digit5') || input.edge('Digit6')) {
    for (const item of BUY_MENU) {
      if (input.edge(`Digit${item.key}`)) { buyKey = item.id; break; }
    }
  }

  const intent = {
    forward: input.down('KeyW') || input.down('ArrowUp'),
    back: input.down('KeyS') || input.down('ArrowDown'),
    left: input.down('KeyA') || input.down('ArrowLeft'),
    right: input.down('KeyD') || input.down('ArrowRight'),
    jump: input.down('Space'),
    crouch: input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC'),
    yaw,
    pitch,
    firing,
    ads: input.rightDown && player.weapon === 'longbow',
    reload: input.edge('KeyR'),
    use: input.down('KeyE'),
    grenadeEdge: input.edge('KeyG'),
    buyKey,
    buyMenu: input.edge('KeyB'),
  };
  input.drainEdges();
  return intent;
}
