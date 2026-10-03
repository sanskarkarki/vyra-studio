import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

/**
 * One scroll clock for the whole page.
 *
 * The ordering here is the part people get wrong and then blame ScrollTrigger
 * for. Lenis interpolates scroll position on its own schedule; if ScrollTrigger
 * also runs off the browser's native scroll event, the two read different
 * positions in the same frame and every scrubbed animation jitters. Driving
 * lenis.raf from gsap.ticker and pushing ScrollTrigger.update from lenis's own
 * scroll event puts all three on a single timeline.
 *
 * lagSmoothing(0) matters too: GSAP's default is to swallow frames longer than
 * 500ms, which during a texture upload makes a scrubbed animation jump.
 */
export function initScroll(): Lenis {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const lenis = new Lenis({
    duration: reduced ? 0 : 1.05,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: !reduced,
    /* Touch is left native. Smoothing it fights the OS rubber-band and is
       the usual cause of "scroll feels sticky on iOS" complaints. */
    syncTouch: false,
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  return lenis;
}

export { ScrollTrigger };
