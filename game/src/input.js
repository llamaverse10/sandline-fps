// SANDLINE input: keyboard + mouse state, pointer lock, and edge detection.
// The sim never reads the DOM directly; player.js turns this state into an
// intent object each frame. Mouse deltas are drained by the caller.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDown = false;
    this.mouseDownEdge = false;
    this.rightDown = false;
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    this.edges = new Set(); // keys pressed since last drain
    this._onKeyDown = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.edges.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseDown = (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this.mouseDownEdge = true;
      }
      if (e.button === 2) this.rightDown = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
    };
    this._onContextMenu = (e) => e.preventDefault();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  // Ask the browser for pointer lock (must come from a user gesture).
  lock() {
    try {
      this.canvas.requestPointerLock();
    } catch {
      // Pointer lock unavailable (headless / shot mode): mouse look is skipped.
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }

  // True once for a key pressed since the last drain.
  edge(code) {
    return this.edges.has(code);
  }

  drainMouse() {
    const out = { dx: this.dx, dy: this.dy, edge: this.mouseDownEdge };
    this.dx = 0;
    this.dy = 0;
    this.mouseDownEdge = false;
    return out;
  }

  drainEdges() {
    this.edges.clear();
  }
}
