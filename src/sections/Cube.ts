import gsap from 'gsap';
import { P_TEXT_OUT, P_TUMBLE, P_SPIN, easeInOutCubic, span } from './Chapters';

/**
 * The cube. CSS 3D, six divs, no WebGL.
 *
 *     .cube__wrapper { position: absolute; top: 50%; left: 50%;
 *                      transform: translate(-50%, -50%) scale(0); }
 *     .cube__scene   { --scene-size: 230px; --scene-depth: 115px;
 *                      perspective: calc(var(--scene-size) * 5); }
 *     .cube__body    { transform-style: preserve-3d; }
 *     .cube__face    { backface-visibility: hidden;
 *                      box-shadow: inset 0 0 40px #000; }
 *
 * **`--scene-depth` is exactly half of `--scene-size`.** Any other value and
 * the faces do not meet at the edges — you get a box with gaps, or one that
 * intersects itself. Deriving it in CSS keeps that true at every size, which
 * matters here because the size is animated.
 *
 * It runs in three phases against the stage's master clock, and it starts
 * inside the marquee's phase rather than waiting for a section of its own.
 * That overlap is the composition: the cube grows through the giant words
 * while they are still arriving.
 *
 *     A  0.44 → 0.60   scale 0 → 1.5, tumbling from the resting pose to level
 *     B  0.60 → 0.78   one more full revolution at full size
 *     C  0.78 → 1.00   locked dead front-on; the SCENE grows, not the wrapper
 *
 * Phase C is the part that is easy to get wrong. Scaling the wrapper further
 * would be a flat zoom: `perspective` lives on the scene *inside* the
 * wrapper, so a wrapper scale magnifies the finished projection and the cube
 * gets bigger without ever coming closer. Growing `--scene-size` instead
 * grows `perspective` with it — the projection stays proportionally identical
 * while the object genuinely fills the frame, which is why there is no
 * fish-eye as the front face arrives. Handing over at scale 1.5 × 230 = 345
 * and starting the scene at 345 makes the swap invisible.
 *
 * Landing flat is not luck. While the cube is hidden its Y rotation idles, so
 * every entrance starts from a different angle; the target is snapped up to
 * the next whole multiple of 360 plus one more turn, so wherever it began it
 * always ends square to the camera.
 */

export interface CubeFace {
  /** Image or video url. */
  src: string;
}

export interface CubeOptions {
  host: HTMLElement;
  /** Six sources, in order: front, back, right, left, top, bottom. */
  faces: CubeFace[];
  /** Size the cube reaches at the end of the tumble, in wrapper scale. */
  peakScale?: number;
}

/** Resting pose. At 0/0 a cube reads as a flat square and the effect is lost. */
const POSE_X = -15;
const POSE_Y = -45;

/** Degrees per frame the hidden cube drifts, so no two entrances are alike. */
const IDLE_SPIN = 0.4;

const FACE_NAMES = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const;

/** Mirrors the breakpoint in the stylesheet; the two must agree. */
function baseSceneSize(): number {
  return window.innerWidth < 768 ? Math.min(window.innerWidth * 0.56, 220) : 230;
}

/** How large the front face grows to once it is the only thing on screen. */
function zoomedSceneSize(): number {
  return Math.min(window.innerWidth * 0.44, window.innerHeight * 0.72) * 0.9;
}

export function initCube(options: CubeOptions): (p: number) => void {
  const { host, faces } = options;
  const peakScale = options.peakScale ?? 1.5;

  const wrapper = host.querySelector<HTMLElement>('.cube__wrapper');
  const scene = host.querySelector<HTMLElement>('.cube__scene');
  const cube = host.querySelector<HTMLElement>('.cube__body');
  if (!wrapper || !scene || !cube) return () => {};

  let front: HTMLElement | null = null;

  FACE_NAMES.forEach((name, i) => {
    const face = document.createElement('div');
    face.className = `cube__face cube__face--${name}`;
    const src = faces[i % faces.length]?.src ?? '';

    if (/\.(mp4|webm)$/i.test(src)) {
      const v = document.createElement('video');
      v.className = 'cube__media';
      v.src = src;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.autoplay = true;
      face.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.className = 'cube__media';
      img.src = src;
      img.alt = '';
      img.loading = 'lazy';
      face.appendChild(img);
    }
    cube.appendChild(face);
    if (name === 'front') front = face;
  });

  /* Y drifts only while the cube is off screen. Freezing it on the way in and
     re-arming on the way back out is what lets the entrance be different
     every time and still land square. */
  let idleY = POSE_Y;
  let targetY = POSE_Y + 360;
  let idling = true;

  gsap.ticker.add(() => {
    if (idling) idleY += IDLE_SPIN;
  });

  const update = (p: number): void => {
    if (p < P_TEXT_OUT) {
      if (!idling) idling = true;
      /* scale(0) rather than display:none — the faces stay rasterised, so the
         first frame of the tumble does not pay for six texture uploads. */
      wrapper.style.transform = 'translate(-50%, -50%) scale(0)';
      scene.style.setProperty('--scene-size', `${baseSceneSize()}px`);
      return;
    }

    if (idling) {
      idling = false;
      /* Up to the next whole turn, then one more, so the shortest possible
         landing is still a full revolution rather than a snap. */
      targetY = Math.ceil(idleY / 360) * 360 + 360;
    }

    let size = baseSceneSize();
    let scale: number;
    let rotX: number;
    let rotY: number;
    let dress = 1;

    if (p < P_TUMBLE) {
      const e = easeInOutCubic(span(p, P_TEXT_OUT, P_TUMBLE));
      scale = peakScale * e;
      rotX = POSE_X + (360 - POSE_X) * e;
      rotY = idleY + (targetY - idleY) * e;
    } else if (p < P_SPIN) {
      const e = easeInOutCubic(span(p, P_TUMBLE, P_SPIN));
      scale = peakScale;
      rotX = 360;
      rotY = targetY + 360 * e;
    } else {
      const e = easeInOutCubic(span(p, P_SPIN, 1));
      const handover = baseSceneSize() * peakScale;
      size = handover + (zoomedSceneSize() - handover) * e;
      scale = 1;
      rotX = 360;
      rotY = targetY + 360;
      dress = 1 - e;
    }

    scene.style.setProperty('--scene-size', `${size}px`);
    /* The whole transform string is rewritten, translate included. Let one
       writer own `scale` while CSS owns the centring translate and they land
       on the same property — which is how this collapsed to a dot before. */
    wrapper.style.transform = `translate(-50%, -50%) scale(${scale})`;
    cube.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;

    /* The front face undresses as it becomes the frame: the inset vignette
       and the hairline border are what make it read as one face of a solid,
       and both are wrong once there is no solid left to read. */
    if (front) {
      front.style.boxShadow = `inset 0 0 ${40 * dress}px rgba(0, 0, 0, 1)`;
      front.style.borderColor = `rgba(255, 255, 255, ${0.05 * dress})`;
    }
  };

  return update;
}
