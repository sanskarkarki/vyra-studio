import type { SlideSource, WebGLManager } from './WebGLManager';
import { Waveform } from './hero/Waveform';

/**
 * Everything around the shader: which slide is current, what may interrupt
 * what, and the DOM readouts (counter, title, waveform, thumbnails).
 *
 * The one rule that keeps it feeling solid: a click during a transition is
 * never dropped and never double-fires. It is remembered, and replayed just
 * after the current switch lands.
 */

const AUTOPLAY_MS = 5200;
const WAVE_BARS = 60;

export class Slideshow {
  current = 0;
  private isAnimating = false;
  private pendingNavigation: number | null = null;
  private autoplayTimer = 0;
  private manager: WebGLManager;
  private slides: SlideSource[];
  private counterEl: HTMLElement;
  private titleEl: HTMLElement;
  private thumbEls: HTMLElement[] = [];
  private wave: Waveform;
  private reducedMotion: boolean;

  constructor(manager: WebGLManager, slides: SlideSource[], root: Document) {
    this.manager = manager;
    this.slides = slides;
    this.counterEl = root.querySelector('.hero__counter') as HTMLElement;
    this.titleEl = root.querySelector('.hero__title') as HTMLElement;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.wave = new Waveform(root.querySelector('.hero__wave') as HTMLElement, {
      bars: WAVE_BARS,
      segments: slides.length,
    });

    this.buildThumbs(root.querySelector('.hero__thumbs') as HTMLElement);
    this.bindInputs(root);
    this.updateReadouts();
  }

  private buildThumbs(host: HTMLElement): void {
    this.slides.forEach((slide, i) => {
      const b = document.createElement('button');
      b.className = 'hero__thumb';
      b.type = 'button';
      b.setAttribute('aria-label', `Show slide ${i + 1}: ${slide.title}`);
      const img = document.createElement('img');
      img.src = slide.image ?? '';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      b.appendChild(img);

      /* Hover does two things at once: warms the texture so the click never
         waits on the network, and hands the waveform crest to this slide.
         The second half is the bit that was missing — the rail is not a
         progress bar, it is a pointer, and it should follow the pointer. */
      const enter = () => {
        void this.manager.preload(i);
        this.wave.focus(i);
      };
      const leave = () => this.wave.focus(null);

      b.addEventListener('mouseenter', enter);
      b.addEventListener('focus', enter);
      b.addEventListener('mouseleave', leave);
      b.addEventListener('blur', leave);
      b.addEventListener('click', () => this.goTo(i));

      host.appendChild(b);
      this.thumbEls.push(b);
    });
  }

  private bindInputs(root: Document): void {
    root.querySelector('.hero__arrow--prev')?.addEventListener('click', () => this.prev());
    root.querySelector('.hero__arrow--next')?.addEventListener('click', () => this.next());

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') this.next();
      if (e.key === 'ArrowLeft') this.prev();
    });

    // Touch swipe: horizontal displacement over 50px wins.
    let touchX = 0;
    window.addEventListener(
      'touchstart',
      (e) => {
        touchX = e.touches[0].clientX;
      },
      { passive: true },
    );
    window.addEventListener(
      'touchend',
      (e) => {
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 50) (dx < 0 ? this.next() : this.prev());
      },
      { passive: true },
    );
  }

  startAutoplay(): void {
    if (this.reducedMotion) return;
    window.clearInterval(this.autoplayTimer);
    this.autoplayTimer = window.setInterval(() => {
      if (!this.isAnimating && !document.hidden) this.next();
    }, AUTOPLAY_MS);
  }

  next(): void {
    this.goTo((this.current + 1) % this.slides.length);
  }

  prev(): void {
    this.goTo((this.current - 1 + this.slides.length) % this.slides.length);
  }

  goTo(index: number): void {
    if (index === this.current) return;
    if (this.isAnimating) {
      this.pendingNavigation = index;
      return;
    }
    const direction: 1 | -1 =
      ((index - this.current + this.slides.length) % this.slides.length) <= this.slides.length / 2
        ? 1
        : -1;
    this.isAnimating = true;
    const from = this.current;
    this.current = index;
    this.updateReadouts();
    /* Any deliberate navigation restarts the clock. Without this, clicking a
       thumbnail could be followed by an autoplay advance a few hundred
       milliseconds later, which reads as the slider ignoring you. */
    this.startAutoplay();

    void this.manager.transition(from, index, direction).then(() => {
      this.isAnimating = false;
      // Replay a click that arrived mid-switch, a beat later.
      if (this.pendingNavigation !== null) {
        const target = this.pendingNavigation;
        this.pendingNavigation = null;
        window.setTimeout(() => this.goTo(target), 50);
      }
    });
  }

  private updateReadouts(): void {
    const pad = (n: number) => String(n).padStart(2, '0');
    this.counterEl.textContent = `${pad(this.current + 1)} // ${pad(this.slides.length)}`;
    this.titleEl.textContent = this.slides[this.current].title;
    this.thumbEls.forEach((el, i) => el.classList.toggle('is-active', i === this.current));
    this.wave.setActive(this.current);
  }
}
