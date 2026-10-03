import * as THREE from 'three';
import gsap from 'gsap';
import { FRAGMENT, VERTEX } from './shaders';

/**
 * One fullscreen quad, two texture slots, one progress scalar.
 *
 * Videos and stills end up as identical sampler2D uniforms: a video slide
 * mounts a hidden 1x1 <video> whose frames feed a VideoTexture, a still
 * slide is a plain loaded texture. The shader cannot tell them apart, which
 * is the whole point: the transition logic never branches on media type.
 */

export interface SlideSource {
  image?: string;
  video?: string;
  title: string;
}

interface LoadedSlide {
  texture: THREE.Texture;
  video: HTMLVideoElement | null;
  width: number;
  height: number;
}

/** Linear driver. Every curve is shaped in the fragment shader instead. */
/* Restored to the pre-audit feel. The audit moved this to 1.15s linear and
   shaped the curves in GLSL, which is defensible on paper - but the older
   1.4s expo.inOut reads better on this imagery, and that judgement belongs
   to the eye, not the arithmetic. The shader is likewise back at its
   original values (drift 0.3, split 0.04, noise 0.3, smoothstep crossfade).
   The non-visual fixes from the audit are deliberately KEPT: anisotropy,
   DPR-on-resize, tween-collision kill, autoplay reset, failed-load
   recovery. Those were bugs, not taste. */
export const TRANSITION_DURATION = 1.4;

export class WebGLManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private slides: SlideSource[];
  private loaded: (LoadedSlide | null)[];
  private loading: (Promise<LoadedSlide> | null)[];
  private container: HTMLElement;
  private targetMouse = new THREE.Vector2();
  private mouse = new THREE.Vector2();
  private paused = false;
  private raf = 0;
  private lastFrame = 0;
  private clock = new THREE.Clock();
  private resizeQueued = false;
  private transitionToken = 0;
  private progressTween: gsap.core.Tween | null = null;
  private maxAnisotropy = 1;
  activeIndex = 0;

  constructor(container: HTMLElement, slides: SlideSource[]) {
    this.container = container;
    this.slides = slides;
    this.loaded = slides.map(() => null);
    this.loading = slides.map(() => null);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    /* Anisotropy is the quality win that actually matters here: the quad is
       always sampled under a slight zoom and an oblique warp, which is the
       exact case trilinear filtering blurs and anisotropic filtering does
       not. It costs nothing on any GPU made this decade. */
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTex1: { value: null },
        uTex2: { value: null },
        uProgress: { value: 0 },
        uDirection: { value: 1 },
        uTexReady: { value: 0 },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(container.clientWidth, container.clientHeight) },
        uImageResolution: { value: new THREE.Vector2(1920, 1080) },
        uImageResolution2: { value: new THREE.Vector2(1920, 1080) },
        uMouse: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.tick(performance.now());
  }

  /** Preload a slide's texture; safe to call repeatedly (hover-preload). */
  preload(index: number): Promise<LoadedSlide> {
    const existing = this.loading[index];
    if (existing) return existing;
    const src = this.slides[index];
    const job = src.video ? this.loadVideo(src.video) : this.loadImage(src.image ?? '');
    this.loading[index] = job;
    job.then(
      (slide) => {
        this.loaded[index] = slide;
      },
      () => {
        /* Clear the slot so a transient network failure can be retried on the
           next hover instead of poisoning the slide for the session. */
        this.loading[index] = null;
      },
    );
    return job;
  }

  private loadImage(url: string): Promise<LoadedSlide> {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = this.maxAnisotropy;
          /* The warp pushes UVs a few percent outside 0..1 at the crest.
             Clamping is what keeps that as a smear rather than as the
             opposite edge of the photo wrapping into frame. */
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          const img = tex.image as HTMLImageElement;
          resolve({ texture: tex, video: null, width: img.naturalWidth, height: img.naturalHeight });
        },
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
  }

  private loadVideo(url: string): Promise<LoadedSlide> {
    return new Promise((resolve, reject) => {
      const vid = document.createElement('video');
      vid.muted = true;
      vid.loop = true;
      vid.playsInline = true;
      vid.preload = 'auto';
      vid.crossOrigin = 'anonymous';
      vid.src = url;
      // Present but invisible: it exists only to feed the texture.
      vid.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(vid);

      let poll = 0;
      const finish = () => {
        window.clearInterval(poll);
        const tex = new THREE.VideoTexture(vid);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        resolve({ texture: tex, video: vid, width: vid.videoWidth, height: vid.videoHeight });
      };
      if (vid.readyState >= 2) {
        finish();
        return;
      }
      vid.addEventListener('loadeddata', finish, { once: true });
      vid.addEventListener('error', () => reject(new Error(`Video failed: ${url}`)), { once: true });
      /* Fallback poll: some browsers fire no loadeddata for cached media.
         Polling readyState instead of flipping the texture live is what
         avoids the black-first-frame class of bug. */
      poll = window.setInterval(() => {
        if (vid.readyState >= 2) finish();
      }, 400);
      void vid.play().catch(() => {
        /* Autoplay may be blocked until interaction; the texture still
           shows the first decoded frame. */
      });
    });
  }

  /** Show a slide immediately (boot path). */
  async showFirst(index: number): Promise<void> {
    const slide = await this.preload(index);
    const u = this.material.uniforms;
    u.uTex1.value = slide.texture;
    u.uTex2.value = slide.texture;
    (u.uImageResolution.value as THREE.Vector2).set(slide.width, slide.height);
    (u.uImageResolution2.value as THREE.Vector2).set(slide.width, slide.height);
    u.uProgress.value = 0;
    u.uTexReady.value = 1;
    this.activeIndex = index;
    if (slide.video) void slide.video.play().catch(() => {});
  }

  /**
   * The switch: load both ends, point the two slots at them, tween one
   * scalar. A token cancels a stale transition if a newer one started while
   * textures were still loading.
   */
  async transition(fromIndex: number, toIndex: number, direction: 1 | -1): Promise<void> {
    const token = ++this.transitionToken;
    const [from, to] = await Promise.all([this.preload(fromIndex), this.preload(toIndex)]);
    if (token !== this.transitionToken) return;

    /* If a tween is still running on this scalar, kill it before resetting
       to 0 — otherwise the old tween keeps writing to the same uniform and
       the two fight for the rest of its duration. */
    this.progressTween?.kill();

    const u = this.material.uniforms;
    u.uTex1.value = from.texture;
    u.uTex2.value = to.texture;
    (u.uImageResolution.value as THREE.Vector2).set(from.width, from.height);
    (u.uImageResolution2.value as THREE.Vector2).set(to.width, to.height);
    u.uDirection.value = direction;
    u.uProgress.value = 0;

    // Both ends of the crossfade must be live; everything else can sleep.
    if (from.video) void from.video.play().catch(() => {});
    if (to.video) void to.video.play().catch(() => {});
    this.loaded.forEach((s, i) => {
      if (s?.video && i !== fromIndex && i !== toIndex) s.video.pause();
    });

    await new Promise<void>((resolve) => {
      this.progressTween = gsap.to(u.uProgress, {
        value: 1,
        duration: TRANSITION_DURATION,
        /* Linear on purpose. See the header comment in shaders.ts: the
           easing lives in GLSL so it can be split across displacement,
           dissolve and burst independently. */
        ease: 'expo.inOut',
        overwrite: true,
        onComplete: () => {
          u.uTex1.value = to.texture;
          (u.uImageResolution.value as THREE.Vector2).set(to.width, to.height);
          u.uProgress.value = 0;
          this.activeIndex = toIndex;
          if (from.video) from.video.pause();
          this.progressTween = null;
          resolve();
        },
      });
    });
  }

  /** Debug readout for the verification harness. */
  uniformProgress(): number {
    return this.material.uniforms.uProgress.value as number;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.loaded.forEach((s, i) => {
      if (!s?.video) return;
      if (paused) s.video.pause();
      else if (i === this.activeIndex) void s.video.play().catch(() => {});
    });
  }

  private onPointerMove = (e: PointerEvent) => {
    this.targetMouse.set(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5);
  };

  private onVisibility = () => {
    this.setPaused(document.hidden);
    if (!document.hidden) this.lastFrame = performance.now();
  };

  private onResize = () => {
    if (this.resizeQueued) return;
    this.resizeQueued = true;
    requestAnimationFrame(() => {
      this.resizeQueued = false;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      /* DPR is re-read here, not just at construction: dragging the window
         to a second monitor changes it and nothing else fires. */
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h);
      (this.material.uniforms.uResolution.value as THREE.Vector2).set(w, h);
    });
  };

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    if (this.paused) return;

    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : 1 / 60;
    this.lastFrame = now;

    /* The floaty parallax lag. Framerate-corrected — a flat 0.05 per frame
       is twice as fast on a 120Hz panel as on a 60Hz one, which is why the
       lag felt inconsistent between machines. */
    const k = 1 - Math.pow(1 - 0.06, dt * 60);
    this.mouse.lerp(this.targetMouse, k);
    (this.material.uniforms.uMouse.value as THREE.Vector2).copy(this.mouse);
    this.material.uniforms.uTime.value = this.clock.getElapsedTime();

    /* Re-upload video frames only for the textures currently on stage and
       only once the element genuinely has data. */
    const u = this.material.uniforms;
    for (const s of this.loaded) {
      if (!s?.video) continue;
      const onStage = s.texture === u.uTex1.value || s.texture === u.uTex2.value;
      if (onStage && s.video.readyState >= 2) s.texture.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.progressTween?.kill();
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const s of this.loaded) {
      s?.texture.dispose();
      s?.video?.remove();
    }
    this.material.dispose();
    this.renderer.dispose();
  }
}
