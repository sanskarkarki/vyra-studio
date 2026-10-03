/**
 * Film grain as a fixed Canvas-2D overlay: ten pre-baked noise frames
 * cycled at a low frame rate. Pre-baking matters because generating noise
 * per frame is a full-screen CPU write every 16ms; flipping between ten
 * cached bitmaps is nearly free. Skipped entirely for reduced motion and
 * on small screens, where grain costs more than it adds.
 */

const FRAME_COUNT = 10;
const TILE = 256;
const FPS = 12;

export function startGrain(canvas: HTMLCanvasElement): () => void {
  if (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    window.matchMedia('(max-width: 767px)').matches
  ) {
    canvas.remove();
    return () => {};
  }

  const ctx = canvas.getContext('2d');
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
      const v = Math.floor(Math.random() * 256);
      data.data[i] = v;
      data.data[i + 1] = v;
      data.data[i + 2] = v;
      data.data[i + 3] = 255;
    }
    tctx.putImageData(data, 0, 0);
    frames.push(tile);
  }

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  let frame = 0;
  let last = 0;
  let raf = 0;
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    if (t - last < 1000 / FPS) return;
    last = t;
    frame = (frame + 1) % frames.length;
    const tile = frames[frame];
    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}
