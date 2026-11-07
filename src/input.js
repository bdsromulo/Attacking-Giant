export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this._down = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this._lastTap = new Map();
    this._double = new Set();
    this.mouse = { dx: 0, dy: 0 };
    this.locked = false;
    this.onLockChange = null;
    this.wheel = 0;

    const press = (code) => {
      if (this._down.has(code)) return;
      this._down.add(code);
      this._pressed.add(code);
      const now = performance.now();
      if (now - (this._lastTap.get(code) || 0) < 260) this._double.add(code);
      this._lastTap.set(code, now);
    };
    const release = (code) => {
      if (!this._down.has(code)) return;
      this._down.delete(code);
      this._released.add(code);
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || (e.ctrlKey && e.code !== 'KeyW')) e.preventDefault();
      press(e.code);
    });
    window.addEventListener('keyup', (e) => release(e.code));
    window.addEventListener('mousedown', (e) => { if (this.locked) press('Mouse' + e.button); });
    window.addEventListener('mouseup', (e) => release('Mouse' + e.button));
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => { for (const c of [...this._down]) release(c); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) for (const c of [...this._down]) release(c);
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
    } catch { this.canvas.requestPointerLock(); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(c) { return this._down.has(c); }
  pressed(c) { return this._pressed.has(c); }
  released(c) { return this._released.has(c); }
  doubleTap(c) { return this._double.has(c); }

  endFrame() {
    this._pressed.clear();
    this._released.clear();
    this._double.clear();
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.wheel = 0;
  }
}
