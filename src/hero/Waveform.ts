/**
 * The bar readout under the slider.
 *
 * Reverse-engineered from the reference build rather than guessed, because
 * the feel lives entirely in three numbers that are easy to get wrong:
 *
 *   1. The bars are laid out with `justify-content: space-between` across a
 *      fixed-width rail, so the *pitch* is a function of the rail, not of a
 *      gap value. 60 bars over 720px = 12px pitch, 2px ink, 10px air.
 *   2. Nothing is random. Every idle bar is exactly the base height. The
 *      "waveform" is a single cosine lobe centred on the active segment.
 *   3. The motion is a CSS `height` transition, not a GSAP `scaleY`. That
 *      distinction is the whole difference in feel: scaleY squashes a bar of
 *      fixed height (and smears its 2px width if the origin is off), whereas
 *      transitioning height with `align-items: flex-end` grows the bar from
 *      the baseline with crisp edges the entire way.
 *
 * The lobe, measured off the reference at 1px resolution:
 *
 *   a(d) = cos( (d / R) * PI/2 )     d = |barIndex - segmentCentre|, R = 8.5
 *   height = 15px + 35px * a(d)
 *   alpha  = 0.30  + 0.40  * a(d)
 *
 * Height and opacity ride the *same* curve, which is why the crest reads as
 * light rather than as a shape. Getting one without the other looks wrong.
 */

export interface WaveformOptions {
  /** Total bars on the rail. */
  bars?: number;
  /** How many slides the rail is divided between. */
  segments?: number;
  /** Lobe radius in bars. Beyond this the bar is fully at rest. */
  radius?: number;
  minHeight?: number;
  maxHeight?: number;
  minAlpha?: number;
  maxAlpha?: number;
}

const DEFAULTS = {
  bars: 60,
  segments: 5,
  minHeight: 15,
  maxHeight: 50,
  minAlpha: 0.3,
  maxAlpha: 0.7,
} as const;

export class Waveform {
  private els: HTMLElement[] = [];
  private readonly bars: number;
  private readonly segments: number;
  private readonly per: number;
  private readonly radius: number;
  private readonly minH: number;
  private readonly maxH: number;
  private readonly minA: number;
  private readonly maxA: number;

  /** The slide the rail returns to when nothing is hovered. */
  private activeSegment = 0;
  /** A hovered thumbnail temporarily steals the crest. */
  private focusedSegment: number | null = null;

  constructor(host: HTMLElement, options: WaveformOptions = {}) {
    this.bars = options.bars ?? DEFAULTS.bars;
    this.segments = options.segments ?? DEFAULTS.segments;
    this.per = this.bars / this.segments;
    /* A 17-bar-wide lobe over a 12-bar segment is the measured reference
       ratio; expressing it as a ratio keeps the shape correct if the slide
       count ever changes. */
    this.radius = options.radius ?? this.per * (17 / 24);
    this.minH = options.minHeight ?? DEFAULTS.minHeight;
    this.maxH = options.maxHeight ?? DEFAULTS.maxHeight;
    this.minA = options.minAlpha ?? DEFAULTS.minAlpha;
    this.maxA = options.maxAlpha ?? DEFAULTS.maxAlpha;

    host.style.setProperty('--wave-height', `${this.maxH}px`);
    for (let i = 0; i < this.bars; i++) {
      const bar = document.createElement('span');
      bar.className = 'wave__bar';
      host.appendChild(bar);
      this.els.push(bar);
    }
    this.paint();
  }

  /** Centre of a segment, in bar-index space. Segment 0 of 12 -> 5.5. */
  private centreOf(segment: number): number {
    return segment * this.per + (this.per - 1) / 2;
  }

  /** The lobe. 1 at the crest, 0 at and beyond the radius. */
  private amplitude(barIndex: number, centre: number): number {
    const d = Math.abs(barIndex - centre);
    if (d >= this.radius) return 0;
    return Math.cos((d / this.radius) * (Math.PI / 2));
  }

  private paint(): void {
    const centre = this.centreOf(this.focusedSegment ?? this.activeSegment);
    for (let i = 0; i < this.els.length; i++) {
      const a = this.amplitude(i, centre);
      const el = this.els[i];
      el.style.height = `${this.minH + (this.maxH - this.minH) * a}px`;
      el.style.backgroundColor = `rgba(242, 242, 240, ${this.minA + (this.maxA - this.minA) * a})`;
    }
  }

  /** Called when the slideshow commits to a new slide. */
  setActive(segment: number): void {
    this.activeSegment = segment;
    if (this.focusedSegment === null) this.paint();
  }

  /**
   * Called on thumbnail hover. Passing null releases the crest back to the
   * active slide. Note the lobe is *clipped*, not shifted, at the ends of
   * the rail — hovering the first or last thumbnail shows half a crest, and
   * that asymmetry is correct.
   */
  focus(segment: number | null): void {
    if (segment === this.focusedSegment) return;
    this.focusedSegment = segment;
    this.paint();
  }
}
