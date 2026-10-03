import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from '../scroll';

/**
 * Section three: the gallery that reads as a cube/globe of work.
 *
 * It is not a cube and it is not a sphere. It is **three concentric rings of
 * flat planes, all spinning about the Z axis** — the axis pointing at the
 * camera. That single fact is why it looks expensive and why it is cheap:
 *
 *   - Because the rotation axis faces the viewer, the rings sweep across the
 *     screen rather than tumbling through it, so no plane is ever edge-on and
 *     invisible. You always see every image.
 *   - Because the rings counter-rotate (inner one way, middle the other,
 *     outer back again) the eye reads depth and volume that the geometry does
 *     not actually contain.
 *   - Because every plane is a single unlit quad, 72 of them costs less than
 *     one lit sphere.
 *
 * Structure, per ring:
 *
 *   ringGroup            rotation.z animated  ← this is the only thing moving
 *     └ slotGroup ×N     rotation.z = i/N * TAU, fixed
 *         └ mesh         position.x = radius, rotation.z = -PI/2, fixed
 *
 * Nesting a fixed slot rotation inside an animated ring rotation is what lets
 * you spin the whole ring by writing one number per frame. Trying to place
 * each plane with sin/cos per frame instead is the usual way this gets
 * written, and it is both slower and much harder to ease.
 *
 * The measured reference values are the defaults below.
 */

export interface RingConfig {
  count: number;
  radius: number;
  /** Multiplier on the base plane size. Outer rings carry bigger cards. */
  scale: number;
  /** +1 or -1. Adjacent rings must disagree. */
  direction: 1 | -1;
}

export const RINGS: RingConfig[] = [
  { count: 12, radius: 8.05, scale: 1.0, direction: 1 },
  { count: 24, radius: 14.3, scale: 1.36, direction: -1 },
  { count: 36, radius: 21.5, scale: 1.72, direction: 1 },
];

/** Base card, 4:5 portrait. Outer rings scale this. */
const CARD_W = 1.28;
const CARD_H = 1.6;

/**
 * How the camera is framed.
 *
 * This used to be a fixed world-space height — 46 units — and that is what
 * put the innermost ring straight through the middle of the heading. The
 * bug is not the number, it is the axis. `.ring__title` is sized in `vw`, so
 * it grows and shrinks with the viewport's WIDTH, while a fixed world height
 * pins the ring to the viewport's HEIGHT. Two things sized against different
 * axes cannot be kept apart by any single constant: pick one that clears the
 * heading at 16:9 and it collides again the moment the window gets wider.
 *
 * So the framing is measured instead of declared. Every resize, the furthest
 * corner of the centre text is measured from the ring's centre, and the
 * camera is pushed back until the inner edge of the innermost ring sits that
 * far out plus a margin. Whatever the heading does — a `vw` change, a font
 * swap, a longer word — the ring opens up to accommodate it, and the
 * stylesheet stays the only place the type is described.
 */

/** Clear space between the heading's furthest corner and the innermost ring's
    inner edge, as a fraction of that corner distance. */
const CENTRE_CLEARANCE = 0.18;

/** Used only if the centre text cannot be measured — zero-size, display:none,
    or not passed in at all. World units across the host's width. */
const FALLBACK_VISIBLE_WIDTH = 26;

const FOV = 50;

/** Turns the whole assembly makes across the scrubbed scroll. */
const SCROLL_TURNS = 0.62;
/** Never fully still, even when the scroll is. */
const IDLE_SPEED = 0.02;

const TAU = Math.PI * 2;

export interface RingGalleryOptions {
  /** Image or .mp4 urls. Cycled if fewer than 72. */
  sources: string[];
  section: HTMLElement;
  canvasHost: HTMLElement;
  /**
   * Elements the ring must stay clear of — the centre heading and its
   * sub-line. Deliberately NOT every child of the centre block: the stats row
   * spans almost the full width, so including it would push the ring off
   * screen entirely to satisfy something the cards are meant to pass behind.
   */
  clearance?: HTMLElement[];
}

export class RingGallery {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private ringGroups: THREE.Group[] = [];
  private videos: HTMLVideoElement[] = [];
  private videoTextures: THREE.VideoTexture[] = [];
  private materials: THREE.MeshBasicMaterial[] = [];
  private host: HTMLElement;
  private clearance: HTMLElement[];
  private raf = 0;
  private clock = new THREE.Clock();
  private visible = false;
  private resizeQueued = false;

  /** Written by ScrollTrigger, read by the render loop. */
  private scrollTurns = 0;
  private idleTurns = 0;

  constructor(options: RingGalleryOptions) {
    this.host = options.canvasHost;
    this.clearance = options.clearance ?? [];

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
    this.host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      FOV,
      this.host.clientWidth / this.host.clientHeight,
      0.1,
      200,
    );
    this.applyFraming();

    this.scene.add(this.root);
    this.build(options.sources);
    this.bindScroll(options.section);

    /* Measured off text, so it has to be re-measured once the webfont lands.
       Before then the heading is laid out in the fallback face at a different
       width, and the ring would be framed to clear a heading that no longer
       exists. */
    if (document.fonts) void document.fonts.ready.then(() => this.applyFraming());

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.tick();
  }

  private build(sources: string[]): void {
    const loader = new THREE.TextureLoader();
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    let cursor = 0;

    for (const ring of RINGS) {
      const ringGroup = new THREE.Group();
      const geometry = new THREE.PlaneGeometry(CARD_W * ring.scale, CARD_H * ring.scale);

      for (let i = 0; i < ring.count; i++) {
        const src = sources[cursor % sources.length];
        cursor++;

        const material = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 1,
          side: THREE.FrontSide,
          depthWrite: false,
        });
        material.map = this.makeTexture(src, loader, maxAniso);
        this.materials.push(material);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.x = ring.radius;
        /* -90 degrees puts the card's long edge along the ring's tangent, so
           the portrait cards stand upright as the ring turns instead of lying
           on their sides. */
        mesh.rotation.z = -Math.PI / 2;

        const slot = new THREE.Group();
        slot.rotation.z = (i / ring.count) * TAU;
        slot.add(mesh);
        ringGroup.add(slot);
      }

      this.ringGroups.push(ringGroup);
      this.root.add(ringGroup);
    }

    /* Starts collapsed at the centre. The entrance is a scale, not a camera
       dolly, so it cannot ever clip through the near plane. */
    this.root.scale.setScalar(0.12);
  }

  private makeTexture(
    src: string,
    loader: THREE.TextureLoader,
    maxAniso: number,
  ): THREE.Texture {
    if (/\.(mp4|webm)$/i.test(src)) {
      const video = document.createElement('video');
      video.src = src;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      void video.play().catch(() => {});
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.videos.push(video);
      this.videoTextures.push(tex);
      return tex;
    }
    const tex = loader.load(src);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    return tex;
  }

  private bindScroll(section: HTMLElement): void {
    /* Entrance and exit are two separate triggers on purpose. One scrub over
       the whole section would tie the grow-in and the fade-out to the same
       curve, and the section would spend most of its length doing nothing
       interesting in the middle. */
    ScrollTrigger.create({
      trigger: section,
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (self) => {
        this.visible = self.isActive;
      },
    });

    gsap.fromTo(
      this.root.scale,
      { x: 0.12, y: 0.12, z: 0.12 },
      {
        x: 1,
        y: 1,
        z: 1,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: section,
          start: 'top bottom',
          /* Deliberately overruns `top top`. If the growth finishes exactly
             as the section pins, the first thing you see once it has the
             screen is an assembly that already stopped moving. Carrying it
             70vh past the pin means it is still opening as it arrives. */
          end: '+=170%',
          scrub: 0.8,
        },
      },
    );

    /* Rotation is written to a plain number and applied in the render loop,
       rather than tweening `rotation.z` directly. That keeps the constant
       idle drift and the scrubbed turn additive — tween the property itself
       and the idle spin gets stomped on every scroll frame. */
    gsap.fromTo(
      this,
      { scrollTurns: 0 },
      {
        scrollTurns: SCROLL_TURNS,
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1,
        },
      },
    );

    /* Cards dim as the assembly leaves, so whatever comes next does not have
       to fight it for attention.

       Note the start/end are measured off `bottom`, which means this section
       needs something after it — a footer or section four. If the ring is the
       last element on the page its bottom never rises past the viewport and
       this trigger silently never fires, which is an easy hour to lose. */
    const fade = { value: 1 };
    gsap.to(fade, {
      value: 0,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'bottom 95%',
        end: 'bottom 40%',
        scrub: true,
        onUpdate: () => {
          for (const m of this.materials) m.opacity = fade.value;
        },
      },
    });
  }

  /**
   * Distance in px from the ring's centre to the furthest corner of anything
   * the ring has to stay clear of. Corners, not edges: a wide heading's
   * nearest edge can be well inside a circle that its corner pokes out of.
   */
  private centreReachPx(): number {
    const hb = this.host.getBoundingClientRect();
    const cx = hb.left + hb.width / 2;
    const cy = hb.top + hb.height / 2;

    let reach = 0;
    for (const el of this.clearance) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      reach = Math.max(
        reach,
        Math.hypot(r.left - cx, r.top - cy),
        Math.hypot(r.right - cx, r.top - cy),
        Math.hypot(r.left - cx, r.bottom - cy),
        Math.hypot(r.right - cx, r.bottom - cy),
      );
    }
    return reach;
  }

  /**
   * Push the camera back until the innermost ring's inner edge clears the
   * centre text. The card's radial half-extent is CARD_H, not CARD_W: each
   * plane is turned a quarter-turn so it lies tangent to its ring, which puts
   * its original height along the radius.
   */
  private applyFraming(): void {
    const h = this.host.clientHeight;
    const w = this.host.clientWidth;
    if (h === 0 || w === 0) return;

    const inner = RINGS[0];
    const innerEdgeUnits = inner.radius - (CARD_H * inner.scale) / 2;
    const reach = this.centreReachPx();

    const pxPerUnit =
      reach > 0 && innerEdgeUnits > 0
        ? (reach * (1 + CENTRE_CLEARANCE)) / innerEdgeUnits
        : w / FALLBACK_VISIBLE_WIDTH;

    const visibleHeight = h / pxPerUnit;
    this.camera.aspect = w / h;
    this.camera.position.z = visibleHeight / 2 / Math.tan((FOV * Math.PI) / 360);
    this.camera.updateProjectionMatrix();
  }

  private onResize = () => {
    if (this.resizeQueued) return;
    this.resizeQueued = true;
    requestAnimationFrame(() => {
      this.resizeQueued = false;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
      this.applyFraming();
    });
  };

  private onVisibility = () => {
    for (const v of this.videos) {
      if (document.hidden) v.pause();
      else void v.play().catch(() => {});
    }
  };

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    /* Off-screen, the loop still runs but skips the draw. Cheaper than
       tearing the context down and rebuilding it on re-entry, and it keeps
       the idle rotation continuous so the section is never re-entered with a
       stale pose. */
    const dt = this.clock.getDelta();
    this.idleTurns += dt * IDLE_SPEED;
    if (!this.visible) return;

    const turns = this.scrollTurns + this.idleTurns;
    for (let i = 0; i < this.ringGroups.length; i++) {
      this.ringGroups[i].rotation.z = turns * TAU * RINGS[i].direction;
    }

    for (const t of this.videoTextures) t.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const v of this.videos) v.remove();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    for (const m of this.materials) {
      m.map?.dispose();
      m.dispose();
    }
    this.renderer.dispose();
  }
}
