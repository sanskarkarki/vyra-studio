import type Lenis from 'lenis';
import { P_TEXT_OUT, P_PRE_EXIT, P_SPIN, clamp01, easeInOutCubic, span } from './Chapters';

/**
 * Chapter B — the dot-matrix title marquee.
 *
 * Three things are worth copying exactly:
 *
 *   1. **`align-items: baseline` on the block.** The 10vw word and the 13px
 *      label share a baseline, so the label hangs off the bottom of the word
 *      like a footnote instead of floating at its optical centre. Switch it to
 *      `center` and the whole thing immediately looks like a slide deck.
 *   2. **`mix-blend-mode: difference` on the wrapper**, not on the items — so
 *      the word and its label invert together as one object.
 *   3. **The lines arrive from behind a mask, not out of nothing.** Each line
 *      sits in an `overflow: hidden` box and slides up from 130% to 0,
 *      staggered. A fade says "this element appeared"; a masked slide says
 *      "this was always here and you are only now seeing it", which is the
 *      difference between a slide transition and a title sequence.
 *
 * The horizontal travel is a plain rAF loop, not a scrubbed tween. It drifts
 * at a constant rate and scroll *adds* to that rate rather than being the
 * only source of it, so the row is alive when the page is still and surges
 * when you move. A purely scroll-driven row is dead the instant you stop,
 * which reads as broken rather than as restraint. The loop only runs inside
 * this chapter's phase — off-screen it is not merely invisible, it is not
 * scheduled.
 */

export interface MarqueeWord {
  word: string;
  label: string;
}

export interface TitleMarqueeOptions {
  host: HTMLElement;
  words: MarqueeWord[];
  lenis: Lenis;
  /** Constant drift, px per frame. */
  baseSpeed?: number;
  /** -1 travels left. */
  direction?: 1 | -1;
}

/** How far below its mask a line waits, as a percentage of its own height. */
const HIDDEN_Y = 130;

interface RevealTarget {
  el: HTMLElement;
  /** Fraction of the reveal window this line waits before starting. */
  inDelay: number;
  inSpan: number;
  /** Fraction of the exit window this line waits before leaving. */
  outDelay: number;
  outSpan: number;
}

export function initTitleMarquee(options: TitleMarqueeOptions): (p: number) => void {
  const { host, words, lenis } = options;
  const baseSpeed = options.baseSpeed ?? 1;
  const direction = options.direction ?? -1;

  const inner = host.querySelector<HTMLElement>('.tm__inner');
  const outer = host.querySelector<HTMLElement>('.tm__outer');
  const sub = host.querySelector<HTMLElement>('.tm__sub');
  const desc = host.querySelector<HTMLElement>('.tm__desc');
  if (!inner || !outer) return () => {};

  /* Three sets. Two would satisfy the wrap arithmetic, but a third keeps the
     row full at both extremes instead of running out of words at one end. */
  const SETS = 3;
  for (let s = 0; s < SETS; s++) {
    const set = document.createElement('div');
    set.className = 'tm__set';
    for (const w of words) {
      const block = document.createElement('span');
      block.className = 'tm__block';

      const big = document.createElement('span');
      big.className = 'tm__word';
      big.textContent = w.word;

      const label = document.createElement('span');
      label.className = 'tm__label';
      label.textContent = `(${w.label})`;

      block.append(big, label);
      set.appendChild(block);
    }
    inner.appendChild(set);
  }

  /* The marquee already has its clipping box — `.tm__wrap` — so `.tm__outer`
     is free to carry the vertical travel. The two text lines get a mask each,
     built here rather than in the markup so the reveal cannot be half-wired
     by an HTML edit that forgets one of them. */
  const mask = (el: HTMLElement): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'tm__mask';
    el.parentNode?.insertBefore(box, el);
    box.appendChild(el);
    return el;
  };

  const targets: RevealTarget[] = [];
  if (sub) targets.push({ el: mask(sub), inDelay: 0, inSpan: 0.4, outDelay: 0.3, outSpan: 0.7 });
  targets.push({ el: outer, inDelay: 0.08, inSpan: 0.42, outDelay: 0.1, outSpan: 0.9 });
  if (desc) targets.push({ el: mask(desc), inDelay: 0.32, inSpan: 0.42, outDelay: 0, outSpan: 1 });

  /* ── Horizontal travel ──────────────────────────────────────────────── */

  let setWidth = 0;
  let x = 0;
  let boost = 0;
  let running = false;
  let frame = 0;

  const measure = (): void => {
    setWidth = inner.scrollWidth / SETS;
    /* Start centred on the middle set so there are words on both sides from
       the first frame, instead of a gap where the row has not arrived yet. */
    if (x === 0) x = -setWidth * 0.5;
  };
  measure();

  lenis.on('scroll', () => {
    boost = lenis.velocity * 0.25;
  });

  const tick = (): void => {
    /* Decay back toward the constant drift. Without it the row keeps whatever
       speed the last flick gave it, forever. */
    boost *= 0.93;
    x += (baseSpeed + boost) * direction;
    /* Wrapped per frame, not through a closure captured at boot: the word is
       10vw, so a resize moves `setWidth` by hundreds of pixels and a captured
       wrap would keep folding the row on the old period. */
    while (x <= -setWidth) x += setWidth;
    while (x >= setWidth) x -= setWidth;
    inner.style.transform = `translate3d(${x}px, 0, 0)`;
    frame = requestAnimationFrame(tick);
  };

  const setRunning = (next: boolean): void => {
    if (next === running) return;
    running = next;
    if (running) frame = requestAnimationFrame(tick);
    else cancelAnimationFrame(frame);
  };

  window.addEventListener('resize', () => {
    const before = setWidth;
    setWidth = inner.scrollWidth / SETS;
    /* Keep the row where it was proportionally, so a resize does not jump it
       to a different word. */
    if (before > 0) x = (x / before) * setWidth;
  });

  /* ── Vertical reveal, driven by the stage clock ─────────────────────── */

  const update = (p: number): void => {
    setRunning(p >= P_TEXT_OUT && p < 1);

    /* The two halves stagger differently and it is not an oversight.
       Arriving, the raw linear progress is split per line and each slice is
       eased — so every line has its own full ease-in-out and they arrive as
       separate events. Leaving, the whole window is eased ONCE and the lines
       take linear slices of that single curve — so they leave as one gesture
       with the ease shared between them. Ease both halves the same way and
       the exit sits still for most of its window and then lurches. */
    const revealPr = span(p, P_TEXT_OUT, P_PRE_EXIT);
    const exitPr = easeInOutCubic(span(p, P_SPIN, 1));

    for (const t of targets) {
      const arrive = easeInOutCubic(clamp01((revealPr - t.inDelay) / t.inSpan));
      const leave = clamp01((exitPr - t.outDelay) / t.outSpan);
      /* Reveal finishes at 0.72 and the exit starts at 0.78, so these two
         never overlap and summing them is safe. */
      const y = (1 - arrive) * HIDDEN_Y - leave * HIDDEN_Y;
      t.el.style.transform = `translate3d(0, ${y}%, 0)`;
    }
  };

  update(0);
  return update;
}
