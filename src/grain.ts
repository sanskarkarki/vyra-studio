/**
 * Lightweight film grain overlay.
 * Noise frames are generated once, then painted at 12fps using a timeout
 * rather than keeping a 60fps requestAnimationFrame loop alive all page long.
 */

const FRAME_COUNT = 8;
const TILE = 192;
const FPS = 12;
const FRAME_DELAY = 1000 / FPS;

export function startGrain(canvas: HTMLCanvasElement): () => void {
  if (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    window.matchMedia('(max-width: 767px)').matches
  ) {
    canvas.remove();
    return () => {};
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return () => {};

  const frames: HTMLCanvasElement[] = [];
  for (let f = 0; f < FRAME_COUNT; f++) {
    const tile = document.createElement('canvas');
    tile.width = TILE;
    tile.height = TILE;
    const tctx = tile.getContext('2d');
    if (!tctx) continue;

    const data = tctx.createImageData(TILE, TILE);
    for (let i = 0; i < data.data.length; i += 4) {
      const value = Math.floor(Math.random() * 256);
      data.data[i] = value;
      data.data[i + 1] = value;
      data.data[i + 2] = value;
      data.data[i + 3] = 255;
    }
    tctx.putImageData(data, 0, 0);
    frames.push(tile);
  }

  if (!frames.length) return () => {};

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  let frame = 0;
  let timer = 0;
  let stopped = document.hidden;
  const patterns = frames.map((tile) => ctx.createPattern(tile, 'repeat'));

  const paint = () => {
    if (stopped) return;
    frame = (frame + 1) % frames.length;
    const pattern = patterns[frame];
    if (pattern) {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    }
    timer = window.setTimeout(paint, FRAME_DELAY);
  };

  const onVisibility = () => {
    stopped = document.hidden;
    window.clearTimeout(timer);
    if (!stopped) timer = window.setTimeout(paint, FRAME_DELAY);
  };

  document.addEventListener('visibilitychange', onVisibility);
  if (!stopped) timer = window.setTimeout(paint, FRAME_DELAY);

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    frames.length = 0;
  };
}
