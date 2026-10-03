import { ScrollTrigger } from '../scroll';

/**
 * Section two is one pinned stage running one clock.
 *
 * It used to be three chapters cross-fading against three separate scroll
 * drivers, and that is what produced the ghosting: chapter N faded out across
 * `bottom 75% → bottom 15%` of its own driver while chapter N+1 faded in
 * across `top 75% → top 15%` of its own. Because the drivers are stacked
 * siblings, driver N's bottom edge *is* driver N+1's top edge — so those two
 * windows are not merely overlapping, they are the identical stretch of
 * scroll. Two panels at partial opacity, every time, by construction.
 *
 * The fix is not to nudge the windows apart. It is to stop having two owners
 * for "what is on screen". One progress value, `p`, runs 0 → 1 across the
 * whole pinned stage, and every element is hand-placed against fixed
 * breakpoints in that one number:
 *
 *     0.00 ─ 0.12   black shutter climbs over the hero
 *     0.12 ─ 0.44   the wave panel holds
 *     0.44          the wave panel is GONE. Not fading. Gone.
 *     0.44 ─ 0.60   marquee reveals; the cube tumbles in behind it
 *     0.60 ─ 0.78   the cube takes one more turn
 *     0.78 ─ 1.00   marquee exits upward; the cube zooms to one face
 *
 * A hand-off where the outgoing element's window *ends* exactly where the
 * incoming one's *begins* cannot produce an overlap frame, and no amount of
 * retuning is needed when a driver's height changes — the breakpoints are
 * fractions of the whole, so they move together.
 *
 * The drivers still exist and still supply the scroll length; they are just
 * no longer the thing that decides visibility. Their heights are chosen so
 * each driver's edges land on a breakpoint, which is what lets the wave
 * panel keep scrubbing its rows against its own element.
 */

/** Black shutter has fully covered the hero. */
export const P_REVEAL = 0.12;
/** Wave panel is at zero. The marquee and the cube both start here. */
export const P_TEXT_OUT = 0.44;
/** Cube has finished growing and levelling out. */
export const P_TUMBLE = 0.6;
/** Marquee lines have all arrived. */
export const P_PRE_EXIT = 0.72;
/** Cube has finished its extra revolution; the zoom begins. */
export const P_SPIN = 0.78;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * One ease for every phase. Using a different curve per element is what makes
 * hand-sequenced choreography look like several unrelated animations that
 * happen to share a scrollbar.
 */
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Maps `v` from [a, b] to [0, 1], clamped. Returns 0 for a degenerate range. */
export const span = (v: number, a: number, b: number): number =>
  b === a ? 0 : clamp01((v - a) / (b - a));

export interface StageOptions {
  /** The element whose height is the whole pinned run. */
  track: HTMLElement;
  mask: HTMLElement;
  hero: HTMLElement;
  wavePanel: HTMLElement;
  marqueePanel: HTMLElement;
  cubePanel: HTMLElement;
  /** Anything that needs the master clock. Called once per frame. */
  subscribers?: ((p: number) => void)[];
}

export function initStage(options: StageOptions): void {
  const { track, mask, hero, wavePanel, marqueePanel, cubePanel } = options;
  const subscribers = options.subscribers ?? [];

  /* The mask is opaque from the start and revealed by clip-path instead of
     opacity. A fading black plane lets the hero show through it the whole
     way; a clipped one is either covering a pixel or it is not, so the hero
     is never visible through a half-transparent sheet of black. */
  mask.style.opacity = '1';

  let last = -1;

  const paint = (p: number): void => {
    if (p === last) return;
    last = p;

    /* ── Shutter ──────────────────────────────────────────────────────── */
    const shutter = (1 - easeInOutCubic(span(p, 0, P_REVEAL))) * 100;
    mask.style.clipPath = `inset(${shutter}% 0 0 0)`;

    /* The hero steps back rather than simply being covered, so the two read
       as one gesture instead of a plane dropping on a static picture. */
    const heroOut = easeInOutCubic(span(p, 0, P_REVEAL));
    hero.style.opacity = String(1 - heroOut);
    hero.style.transform = `translate3d(0, ${-40 * heroOut}px, 0)`;

    /* ── Wave panel ───────────────────────────────────────────────────── */
    const panelT = span(p, P_REVEAL, P_TEXT_OUT);
    /* Arrives with the shutter, leaves in the last 17% of its own phase. The
       whole panel moves — columns, plate, captions, caption image — as one
       object. Animating the parts separately is what leaves the photograph
       hanging in the middle of the screen after the words have gone. */
    const panelIn = easeInOutCubic(span(p, 0, P_REVEAL));
    const panelOut = easeInOutCubic(span(panelT, 0.83, 1));
    wavePanel.style.opacity = String(panelIn * (1 - panelOut));
    wavePanel.style.transform = `translate3d(0, ${-18 * easeInOutCubic(span(panelT, 0.84, 1))}vh, 0)`;
    /* Once it is at zero it stops costing anything: no paint, no hit-test,
       and the row scrub underneath has nothing to composite against. */
    wavePanel.style.visibility = panelOut >= 1 ? 'hidden' : 'visible';

    /* ── Marquee and cube ─────────────────────────────────────────────── */
    /* A hard switch, not a fade. Both panels are black-on-black; what the eye
       reads as their entrance is the masked line reveal and the cube growing
       from zero, both of which start at this same instant. */
    const stageTwo = p >= P_TEXT_OUT;
    marqueePanel.style.opacity = stageTwo ? '1' : '0';
    marqueePanel.style.visibility = stageTwo ? 'visible' : 'hidden';
    cubePanel.style.opacity = stageTwo ? '1' : '0';
    cubePanel.style.visibility = stageTwo ? 'visible' : 'hidden';

    /* The cube passes in FRONT of the giant words from the moment it starts
       growing, so the marquee drops below the cube layer here rather than
       being ordered once in the stylesheet. */
    marqueePanel.classList.toggle('tm--behind', stageTwo);

    for (const fn of subscribers) fn(p);
  };

  ScrollTrigger.create({
    trigger: track,
    start: 'top top',
    end: 'bottom bottom',
    /* One smoothing stage. Lenis already interpolates the scroll position;
       the reference's own lerp-toward-target is the same idea expressed
       manually. Adding a second here would round off the phase boundaries
       and let two neighbouring phases briefly co-exist again. */
    scrub: 0.6,
    onUpdate: (self) => paint(self.progress),
    onRefresh: (self) => paint(self.progress),
  });

  paint(0);
}

export { ScrollTrigger };
