import gsap from 'gsap';
import { ScrollTrigger } from '../scroll';

/**
 * Section two — the dual wave panel.
 *
 * What this actually is, because it is easy to mistake for "text that
 * scrolls": it is a **pinned overlay that covers the hero with dead black**,
 * holding two columns of twelve words. Nothing about it scrolls in the normal
 * sense. Scroll drives three separate things at once:
 *
 *   1. the whole list slides vertically past a fixed centreline;
 *   2. every row is pushed sideways by a **sine arch whose phase travels down
 *      the column** — this is the zigzag, and it is why the shape at the top
 *      of the section is inverted by the time you reach the bottom;
 *   3. whichever row is nearest the centreline becomes focused, which flips
 *      its label and swaps the plate in the middle of the screen.
 *
 * The arch:
 *
 *     tx(i) = A · sin²( π · (i + φ) / (N − 1) )       φ advances with scroll
 *
 * `sin²` rather than `sin` because the arch has to be strictly one-sided — a
 * plain sine would push half the rows across the centreline and the two
 * columns would interleave. Squaring keeps every row on its own side and
 * gives the fat, slow crest that reads as a swell rather than a spike.
 *
 * The columns run the same phase at different gains and **opposite signs**,
 * so they breathe apart and together instead of sliding in parallel. Measured
 * off the reference: left peaked at +163.5px and right at −221.6px on a
 * 1081px viewport — a ratio of 1.355 held to three decimals across all twelve
 * rows, so it is one wave with two amplitudes, not two waves.
 */

export interface WaveRow {
  /** Resting label. */
  en: string;
  /** What it flips to when this row reaches the centreline. */
  alt: string;
  /** Swapped into the centre plate while this row is focused. */
  image: string;
}

export interface WavePanelOptions {
  panel: HTMLElement;
  /** Element whose height provides the scroll length. */
  section: HTMLElement;
  left: WaveRow[];
  right: WaveRow[];
}

/* ── Tunables ─────────────────────────────────────────────────────────────
   Amplitudes in vw so the arch holds its proportion at every width.
   15.1 / 20.5 are the measured reference values. */
const AMP_LEFT_VW = 15.1;
const AMP_RIGHT_VW = 20.5;

/** Phase units travelled across the full section. 1 = one complete swell. */
const WAVE_TRAVEL = 1.35;

/**
 * The chapter's scrub range, shared with the entrance so the two cannot drift.
 *
 * They have to agree with when the panel is actually on screen. On the obvious
 * pair — entrance at `top 85%`, scrub at `top top`/`bottom bottom` — the panel
 * finishes arriving 495px before the scrub reports any progress and stops
 * moving 765px before the chapter has finished fading out. Both stretches are
 * scrolling against a frozen list. Measured on a 900px viewport, not guessed.
 *
 * `bottom top` is the driver's own bottom edge, which is exactly where the
 * master clock reaches p = 0.44 and declares this panel gone — so the rows
 * keep travelling right up to that instant and not a pixel further. The old
 * `bottom 15%` stopped them 15vh early, against a panel that was still fading.
 */
const SECTION_START = 'top 85%';
const SECTION_END = 'bottom top';

/** How far past each end of the list the scroll carries it, in rows. */
const OVERSCAN_ROWS = 2.5;

interface Column {
  el: HTMLElement;
  /** Outer element. The wave owns its transform. */
  rows: HTMLElement[];
  /** Inner element. GSAP owns its transform. */
  inners: HTMLElement[];
  data: WaveRow[];
  sign: 1 | -1;
  ampVw: number;
}

export function initWavePanel(options: WavePanelOptions): void {
  const { panel, section } = options;

  const wrapper = panel.querySelector<HTMLElement>('.wave__wrapper');
  /* Two stacked plates, not one. See createPlateSwapper below. */
  const plates = [...panel.querySelectorAll<HTMLImageElement>('.wave__thumb-img')];
  if (!wrapper) return;
  const track = wrapper;
  const swapPlate = createPlateSwapper(plates);

  const columns: Column[] = [
    { el: wrapper.querySelector('.wave__col--left') as HTMLElement, rows: [], inners: [], data: options.left, sign: 1, ampVw: AMP_LEFT_VW },
    { el: wrapper.querySelector('.wave__col--right') as HTMLElement, rows: [], inners: [], data: options.right, sign: -1, ampVw: AMP_RIGHT_VW },
  ];

  for (const col of columns) {
    if (!col.el) continue;
    for (const row of col.data) {
      /* Two nested elements per row, deliberately.
         The scrubbed wave writes `style.transform` on the outer one every
         frame; the entrance timeline writes xPercent/opacity on the inner
         one. GSAP does not compose with a transform some other code is also
         writing — it caches its own matrix and stamps the whole string — so
         one owner per element is the only way both can run at once. */
      const outer = document.createElement('div');
      outer.className = 'wave__row';

      const inner = document.createElement('div');
      inner.className = 'wave__inner';

      const flip = document.createElement('span');
      flip.className = 'wave__flip';

      const en = document.createElement('span');
      en.className = 'wave__en';
      en.textContent = row.en;

      const alt = document.createElement('span');
      alt.className = 'wave__alt';
      alt.textContent = row.alt;

      flip.append(en, alt);
      inner.appendChild(flip);
      outer.appendChild(inner);
      col.el.appendChild(outer);
      col.rows.push(outer);
      col.inners.push(inner);
    }
  }

  const span = Math.max(options.left.length, options.right.length) - 1;
  let focused = -1;

  /* Layout constants, measured once and on resize rather than per frame.
     Reading offsetHeight inside a scroll handler is how a panel like this
     ends up janky on a 120Hz display. */
  let pitch = 1;
  let vw = window.innerWidth / 100;

  function measure(): void {
    vw = window.innerWidth / 100;
    const first = columns[0].rows[0];
    if (!first) return;
    const gap = parseFloat(getComputedStyle(columns[0].el).rowGap || '0') || 0;
    pitch = first.offsetHeight + gap;
  }

  let progress = 0;

  function paint(): void {
    /* Vertical travel.
       The wrapper is flex-centred inside the panel, so translateY(0) puts the
       MIDDLE of the list on the centreline, not the top of it. Everything
       below is therefore measured from the list's centre — getting this wrong
       is what leaves the flipped row sitting a third of the way up the screen
       while the hairline runs through some other word.

       Row i's centre sits at:  centreline + offset + (i − span/2) · pitch
       so the row on the line is:  i = span/2 − offset/pitch. */
    const half = span / 2;
    const from = (half + OVERSCAN_ROWS) * pitch;
    const to = -(half + OVERSCAN_ROWS) * pitch;
    const offset = from + (to - from) * progress;
    track.style.transform = `translate3d(0, ${offset}px, 0)`;

    /* Phase advances with scroll. This is the travelling part. */
    const phi = progress * WAVE_TRAVEL * span;

    for (const col of columns) {
      const amp = col.ampVw * vw * col.sign;
      for (let i = 0; i < col.rows.length; i++) {
        const s = Math.sin((Math.PI * (i + phi)) / span);
        col.rows[i].style.transform = `translate3d(${amp * s * s}px, 0, 0)`;
      }
    }

    /* Which row is on the centreline. Derived from the offset that just
       positioned the list — no per-row rect reads. */
    const next = clamp(Math.round(half - offset / pitch), 0, span);
    if (next === focused) return;
    focused = next;

    for (const col of columns) {
      col.rows.forEach((el, i) => el.classList.toggle('is-focused', i === focused));
    }

    const src = options.left[focused]?.image;
    if (src) swapPlate(src);
  }

  measure();

  ScrollTrigger.create({
    trigger: section,
    start: SECTION_START,
    end: SECTION_END,
    scrub: true,
    onUpdate: (self) => {
      progress = self.progress;
      paint();
    },
    onRefresh: () => {
      measure();
      paint();
    },
  });

  window.addEventListener('resize', () => {
    measure();
    paint();
  });
  paint();

  buildEntrance(panel, columns, section);
}

/**
 * The entrance.
 *
 * The panel rises from below while the hero blacks out behind it, and the
 * rows arrive **from the left**, staggered. Two details make it read as one
 * movement rather than as a pile of tweens:
 *
 *   - The blackout leads. If the panel arrives before the hero is covered,
 *     the words sit over a photograph for a few frames and the whole thing
 *     looks cheap.
 *   - Both columns stagger from index 0 downward and the right column is
 *     offset a beat, so the two sides do not read as one wide block dropping
 *     in. `-55 * sign` also means each column enters from its own outer edge
 *     rather than both coming from the same side.
 */
function buildEntrance(panel: HTMLElement, columns: Column[], section: HTMLElement): void {
  for (const col of columns) {
    gsap.set(col.inners, { xPercent: -55 * col.sign, opacity: 0 });
  }

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });

  /* Neither the blackout NOR the panel's own opacity is animated here.
     `initStage` in Chapters.ts owns `.stage__mask` and `.wave-panel`, both
     hand-placed against the master clock.

     This timeline used to write the panel's opacity and yPercent as well, and
     that is why the panel never went away: a timed 1.0s tween and a scrubbed
     clock both writing the same inline style, whichever ran last in a given
     frame winning. Reversing the timeline on the way back up then re-asserted
     opacity 1 over a stage that had already decided the panel was gone, so
     the word columns stayed legible behind the cube for the rest of the
     section. One property, one owner — the rows below follow the same rule,
     and opacity is no different. */

  columns.forEach((col, ci) => {
    tl.to(col.inners, { xPercent: 0, opacity: 1, duration: 0.9, stagger: 0.055 }, 0.25 + ci * 0.03);
  });

  tl.fromTo(
    panel.querySelectorAll('.wave__line'),
    { scaleX: 0 },
    { scaleX: 1, duration: 1.1, ease: 'power2.inOut' },
    0.45,
  );

  tl.fromTo(
    panel.querySelectorAll('.wave__chapter, .wave__header, .wave__plate'),
    { opacity: 0 },
    { opacity: 1, duration: 0.7, stagger: 0.08 },
    0.8,
  );

  const trigger = ScrollTrigger.create({
    trigger: section,
    start: SECTION_START,
    onEnter: () => tl.play(),
    onLeaveBack: () => tl.reverse(),
  });

  /* Land mid-section on a refresh or a deep link and `onEnter` never fires,
     because you were never outside the trigger to enter it. Snap the
     entrance to its end state instead of leaving the panel invisible. */
  if (trigger.scroll() > trigger.start) tl.progress(1);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Crossfade the centre plate.
 *
 * The obvious version — fade the image out, swap `src`, fade it back in — is
 * what produces the flash of black: for the whole middle of that sequence
 * there is nothing on screen, and the plate sits over a black panel, so the
 * dip reads as a hard blink on every row change. Shortening the durations
 * does not fix it; it just blinks faster.
 *
 * A crossfade needs two elements. The incoming image is stacked ON TOP at
 * opacity 0 and fades up while the outgoing one **stays fully opaque
 * underneath the whole time**. Composite opacity never drops below 1, so
 * there is nothing to see. Only once the incoming plate is solid does the old
 * one get zeroed, and by then it is hidden anyway.
 *
 * Two further things this has to handle, both of which reintroduce the dip if
 * you skip them:
 *
 *   - **Queue, do not interrupt.** Scrub fast and rows change faster than a
 *     420ms fade. Starting a second crossfade mid-flight means resetting a
 *     plate that is currently carrying the image to opacity 0, and the
 *     composite drops to whatever the half-faded one was at. So an in-flight
 *     swap is never interrupted; the newest request is remembered and run
 *     when the current one lands. Intermediate requests are simply dropped —
 *     nobody can see an image that would have been on screen for 80ms.
 *   - **Decode before fading.** Assigning `src` and fading immediately means
 *     the first frames of the fade are of an empty element. `decode()` costs
 *     nothing on a cached image and removes that.
 */
function createPlateSwapper(plates: HTMLImageElement[]) {
  let active = 0;
  let busy = false;
  let pending: string | null = null;
  let shown = plates[0]?.getAttribute('src') ?? '';

  gsap.set(plates[0], { opacity: 1, zIndex: 2 });
  gsap.set(plates[1], { opacity: 0, zIndex: 1 });

  function run(src: string): void {
    const current = plates[active];
    const nextIndex = (active + 1) % plates.length;
    const next = plates[nextIndex];

    busy = true;
    shown = src;
    next.src = src;
    gsap.set(next, { opacity: 0, zIndex: 2 });
    gsap.set(current, { zIndex: 1 });

    const start = () => {
      gsap.to(next, {
        opacity: 1,
        duration: 0.42,
        ease: 'power2.inOut',
        onComplete: () => {
          /* Only now is it safe to clear the outgoing plate. Doing it in
             parallel is the same bug wearing a different hat. */
          gsap.set(current, { opacity: 0 });
          active = nextIndex;
          busy = false;
          if (pending && pending !== shown) {
            const q = pending;
            pending = null;
            run(q);
          } else {
            pending = null;
          }
        },
      });
    };

    if (next.decode) next.decode().then(start, start);
    else start();
  }

  return (src: string): void => {
    if (!src || plates.length < 2) return;
    if (src === shown) return;
    if (busy) {
      pending = src;
      return;
    }
    run(src);
  };
}
