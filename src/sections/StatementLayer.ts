import gsap from 'gsap';
import { ScrollTrigger } from '../scroll';

/**
 * The layer that scrolls OVER the pinned chapters.
 *
 * Two kinds of thing live here, and they are the two you said were static in
 * your build:
 *
 *   1. **Caption stacks** — the four-line blocks (ART DIRECTION / CAMPAIGN
 *      DESIGN / VISUAL NARRATIVE / BRAND EXPERIENCE). 13px, uppercase, dropped
 *      at one of four fixed x-stations.
 *   2. **Giant letters** — the oversized dot-matrix characters. In the
 *      reference these are not a canvas, a sprite sheet or a grid of divs:
 *      they are plain text at `font-size: 20vw` in **Bitcount Grid Single**, a
 *      Google font whose glyphs are literally made of dots. One character per
 *      block, spelling the studio name down the length of the section.
 *
 * The single most important property on both, and the reason they read as
 * *part of* the imagery rather than as labels sitting on top of it:
 *
 *     mix-blend-mode: difference;
 *
 * White text in difference mode inverts whatever is behind it. Over the black
 * chapters it reads white; the instant a bright plate or a cube face passes
 * underneath it goes dark and cuts a hole in itself. Nothing else gives you
 * that, and it costs one line.
 *
 * ── The entrance ────────────────────────────────────────────────────────────
 *
 * Every element enters **from the left**, and the four lines of a stack are
 * staggered rather than arriving together — that is the zigzag you described.
 * Three details do the work:
 *
 *   - `x` starts negative and proportional to the line's index, so line 4
 *     starts further out than line 1 and they arrive on a diagonal instead of
 *     as a block.
 *   - `filter: blur()` rides in with the movement. The reference declares
 *     `filter: blur(0px)` on the resting state for exactly this reason —
 *     it is there to be animated from.
 *   - `once: true`. These are one-shot reveals, not scrubs. Scrubbing them
 *     means they reverse as you scroll back and the section never settles.
 */

export interface CaptionStack {
  /** 1–4. Which x-station this stack sits at. */
  pos: 1 | 2 | 3 | 4;
  lines: string[];
}

export interface StatementLayerOptions {
  host: HTMLElement;
  /** Interleaved with the caption stacks, in order. */
  letters: string;
  stacks: CaptionStack[];
}

/** How far to either side a line starts, as a percentage of its own width. */
const ZIGZAG_PERCENT = 22;

export function initStatementLayer(options: StatementLayerOptions): void {
  const { host, letters, stacks } = options;
  const chars = [...letters];

  /* Interleave: a couple of caption stacks, then a giant letter, repeat. The
     letters are what give the scroll its rhythm; the stacks are texture
     between them. */
  let li = 0;
  stacks.forEach((stack, i) => {
    host.appendChild(buildStack(stack));
    if (i % 2 === 1 && li < chars.length) {
      host.appendChild(buildLetter(chars[li], ((li % 3) + 1) as 1 | 2 | 3));
      li++;
    }
  });
  while (li < chars.length) {
    host.appendChild(buildLetter(chars[li], ((li % 3) + 1) as 1 | 2 | 3));
    li++;
  }

  animate(host);
}

function buildStack(stack: CaptionStack): HTMLElement {
  const group = document.createElement('div');
  group.className = `stm__group stm__pos-${stack.pos}`;
  stack.lines.forEach((line, i) => {
    /* Each line gets its own clip, so it can rise out of nothing rather
       than simply fading up in place. Without a mask there is no edge for
       it to emerge from and the movement reads as a drift. */
    const mask = document.createElement('span');
    mask.className = 'stm__mask';

    const el = document.createElement('p');
    el.className = 'stm__el';
    /* The zig-zag is one sign flip: even lines arrive from the left, odd
       from the right. The previous version pushed every line left by a
       growing amount, which is a diagonal sweep - all four travelling the
       same way - not a zig-zag. */
    el.dataset.dir = i % 2 === 0 ? '-1' : '1';
    el.textContent = line;

    mask.appendChild(el);
    group.appendChild(mask);
  });
  return group;
}

function buildLetter(char: string, pos: 1 | 2 | 3): HTMLElement {
  const group = document.createElement('div');
  group.className = `stm__group stm__pos-${pos}`;
  const el = document.createElement('p');
  /* Same element, same blend mode, just enormous and in the dot font. */
  el.className = 'stm__el stm__el--xl';
  el.textContent = char;
  el.setAttribute('aria-hidden', 'true');
  group.appendChild(el);
  return group;
}

function animate(host: HTMLElement): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  host.querySelectorAll<HTMLElement>('.stm__group').forEach((group) => {
    const lines = [...group.querySelectorAll<HTMLElement>('.stm__el')];
    const isLetter = group.querySelector('.stm__el--xl') !== null;

    if (reduced) {
      gsap.set(lines, { opacity: (_i: number, t: HTMLElement) => (t.classList.contains('stm__el--xl') ? 1 : 0.6) });
      return;
    }

    gsap.fromTo(
      lines,
      {
        /* Below its own mask, and offset to alternating sides.
           xPercent rather than x: a fixed pixel offset looks wrong when a
           two-word line sits next to a long one, because the same distance
           is a different fraction of each line's width. */
        yPercent: isLetter ? 0 : 115,
        xPercent: (_i: number, t: HTMLElement) =>
          isLetter ? 0 : Number(t.dataset.dir ?? -1) * ZIGZAG_PERCENT,
        opacity: 0,
        filter: 'blur(10px)',
      },
      {
        yPercent: 0,
        xPercent: 0,
        opacity: (_i: number, t: HTMLElement) => (t.classList.contains('stm__el--xl') ? 1 : 0.6),
        filter: 'blur(0px)',
        duration: isLetter ? 1.1 : 0.85,
        ease: 'power3.out',
        stagger: 0.09,
        scrollTrigger: {
          trigger: group,
          /* Fires just as the block clears the bottom edge, so the whole
             sweep happens on screen instead of finishing before you see it. */
          start: 'top 92%',
          once: true,
        },
      },
    );
  });
}

/**
 * The giant letters drift horizontally as they pass, so a 20vw character that
 * is wider than the viewport reveals a different part of itself on the way up.
 * Cheap, and it is the difference between "a big letter" and "a big letter
 * that is moving".
 */
export function initLetterDrift(host: HTMLElement): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  host.querySelectorAll<HTMLElement>('.stm__el--xl').forEach((el, i) => {
    gsap.fromTo(
      el,
      { xPercent: i % 2 === 0 ? -8 : 8 },
      {
        xPercent: i % 2 === 0 ? 8 : -8,
        ease: 'none',
        scrollTrigger: {
          trigger: el,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1.2,
        },
      },
    );
  });
}

export { ScrollTrigger };
