import gsap from 'gsap';
import { ScrollTrigger } from '../scroll';

/**
 * The band of type that runs behind the ring gallery.
 *
 * Two details separate a marquee that reads as motion design from one that
 * reads as a 2004 <marquee> tag:
 *
 *   1. The loop is seamless because the content is duplicated until it is at
 *      least twice the container width, then the track is translated by
 *      exactly one copy's width and wrapped with `gsap.utils.wrap` in a
 *      modifier. Wrapping in a modifier rather than restarting the tween
 *      means there is no frame where the position resets visibly.
 *   2. It reacts to scroll. Scrolling down speeds it up, scrolling up runs it
 *      backwards, and it eases back to its base speed when you stop. That
 *      coupling is what makes it feel attached to the page rather than
 *      playing on top of it.
 */

export interface MarqueeOptions {
  /** Seconds for one full copy to pass. Lower is faster. */
  duration?: number;
  /** Base travel direction. */
  direction?: 1 | -1;
  /** How hard scroll velocity pushes the timeScale. */
  velocityInfluence?: number;
}

export function initMarquee(root: HTMLElement, options: MarqueeOptions = {}): void {
  const duration = options.duration ?? 22;
  const direction = options.direction ?? -1;
  const influence = options.velocityInfluence ?? 0.0035;

  const track = root.querySelector<HTMLElement>('.marquee__track');
  if (!track) return;

  const original = track.innerHTML;
  /* Duplicate until the track is comfortably wider than its container, so a
     short phrase on a wide monitor still loops without a visible gap. */
  let guard = 0;
  while (track.scrollWidth < root.clientWidth * 2 && guard < 12) {
    track.innerHTML += original;
    guard++;
  }
  const copies = guard + 1;
  const copyWidth = track.scrollWidth / copies;

  const wrap = gsap.utils.wrap(-copyWidth, 0);
  const tween = gsap.to(track, {
    x: direction < 0 ? -copyWidth : copyWidth,
    duration,
    ease: 'none',
    repeat: -1,
    modifiers: {
      x: (value: string) => `${wrap(parseFloat(value))}px`,
    },
  });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    tween.pause();
    return;
  }

  ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom top',
    onUpdate: (self) => {
      const boost = 1 + Math.abs(self.getVelocity()) * influence;
      /* Sign of the scroll flips the marquee. gsap.quickTo would be overkill
         for one scalar; a short tween on timeScale gives the settle for free. */
      gsap.to(tween, {
        timeScale: (self.direction === 1 ? 1 : -1) * Math.min(boost, 6),
        duration: 0.4,
        overwrite: true,
      });
    },
    onScrubComplete: () => {
      gsap.to(tween, { timeScale: 1, duration: 0.8 });
    },
  });

  /* Settle back to base speed shortly after scrolling stops. */
  let idle = 0;
  ScrollTrigger.addEventListener('scrollEnd', () => {
    window.clearTimeout(idle);
    idle = window.setTimeout(() => {
      gsap.to(tween, { timeScale: 1, duration: 0.9, ease: 'power2.out' });
    }, 120);
  });
}
