import './styles.css';
import './styles/sections.css';
import { WebGLManager, type SlideSource } from './WebGLManager';
import { Slideshow } from './Slideshow';
import { startGrain } from './grain';
import { initScroll, ScrollTrigger } from './scroll';
import { initNav } from './sections/Nav';
import { initWavePanel, type WaveRow } from './sections/WavePanel';
import { initTitleMarquee } from './sections/TitleMarquee';
import { initCube } from './sections/Cube';
import { initStage } from './sections/Chapters';
import { initStatementLayer, initLetterDrift } from './sections/StatementLayer';
import { RingGallery } from './sections/RingGallery';
import { initMarquee } from './sections/Marquee';

/**
 * Five slides. Any entry can carry `video` instead of (or alongside) an
 * `image` poster; a video slide feeds the shader through a hidden 1x1
 * element and the rest of the pipeline is unchanged.
 */
const SLIDES: SlideSource[] = [
  { image: '/slides/slide1.jpg', title: 'Nocturne House' },
  { image: '/slides/slide2.jpg', title: 'Mono Objects' },
  { image: '/slides/slide3.jpg', title: 'Frame / Space' },
  { image: '/slides/slide4.jpg', title: 'Signal / Material' },
  { image: '/slides/slide5.jpg', title: 'Arc Objects' },
];

/**
 * Section two. Twelve rows a side; the left column supplies the plate image
 * for whichever row is on the centreline, so its `image` field is the one
 * that matters. Keep both columns the same length — the wave phase is
 * normalised over `count - 1` and mismatched lengths desynchronise the two
 * sides.
 */
const WAVE_LEFT: WaveRow[] = [
  { en: 'Core Collection', alt: '( signature pieces )', image: '/ring/01.jpg' },
  { en: 'Material Palette', alt: '( natural materials )', image: '/ring/04.jpg' },
  { en: 'Form Language', alt: '( shape and proportion )', image: '/ring/07.jpg' },
  { en: 'Craftsmanship', alt: '( made with intention )', image: '/ring/10.jpg' },
  { en: 'Comfort', alt: '( designed to live in )', image: '/ring/13.jpg' },
  { en: 'Sculptural Form', alt: '( objects with presence )', image: '/ring/16.jpg' },
  { en: 'Natural Materials', alt: '( wood, stone, fabric )', image: '/ring/19.jpg' },
  { en: 'Precision Detail', alt: '( considered to the last line )', image: '/ring/22.jpg' },
  { en: 'Timeless Design', alt: '( made beyond trends )', image: '/ring/02.jpg' },
  { en: 'Fine Joinery', alt: '( built to endure )', image: '/ring/05.jpg' },
  { en: 'Tactile Surfaces', alt: '( texture you can feel )', image: '/ring/08.jpg' },
  { en: 'Quiet Luxury', alt: '( refined without excess )', image: '/ring/11.jpg' },
];

const WAVE_RIGHT: WaveRow[] = [
  { en: 'Collection', alt: '( the pieces )', image: '' },
  { en: 'Form', alt: '( the silhouette )', image: '' },
  { en: 'Craft', alt: '( the hours )', image: '' },
  { en: 'Materials', alt: '( the foundation )', image: '' },
  { en: 'Comfort', alt: '( the experience )', image: '' },
  { en: 'Proportion', alt: '( the balance )', image: '' },
  { en: 'Heritage', alt: '( the knowledge )', image: '' },
  { en: 'Detail', alt: '( the finishing touch )', image: '' },
  { en: 'Interiors', alt: '( the spaces )', image: '' },
  { en: 'Atelier', alt: '( where it is made )', image: '' },
  { en: 'Objects', alt: '( designed to belong )', image: '' },
  { en: 'Enduring', alt: '( made for years )', image: '' },
];

/** Chapter B. Big word + the small label that shares its baseline. */
const MARQUEE_WORDS = [
  { word: 'INTERIORS', label: 'Room Tone' },
  { word: 'TABLEWARE', label: 'Objects' },
  { word: 'TEXTILES', label: 'Material' },
  { word: 'JEWELRY', label: 'Heirloom' },
];

/** Chapter C. Six faces, in order: front, back, right, left, top, bottom. */
const CUBE_FACES = [
  { src: '/ring/03.jpg' },
  { src: '/ring/09.jpg' },
  { src: '/ring/14.jpg' },
  { src: '/ring/18.jpg' },
  { src: '/ring/21.jpg' },
  { src: '/ring/06.jpg' },
];

/**
 * The four-line blocks that scroll over the pinned chapters. `pos` is one of
 * four x-stations; the giant letters get interleaved between them.
 */
const CAPTION_STACKS = [
  { pos: 1 as const, lines: ['Furniture design', 'Material studies', 'Interior spaces', 'Object language'] },
  { pos: 3 as const, lines: ['Form direction', 'Collection design', 'Visual styling', 'Interior experience'] },
  { pos: 2 as const, lines: ['Collection development', 'Material selection', 'Brand philosophy', 'Living experience'] },
  { pos: 4 as const, lines: ['Design research', 'Form development', 'Ergonomic studies', 'Detail refinement'] },
  { pos: 1 as const, lines: ['Furniture editions', 'Space styling', 'Interior collections', 'Material identity'] },
  { pos: 3 as const, lines: ['Visual identity', 'Product detailing', 'Finish direction', 'Design language'] },
];

/** 24 tiles, cycled across the 72 planes of the ring gallery. */
const RING_SOURCES = Array.from(
  { length: 24 },
  (_, i) => `/ring/${String(i + 1).padStart(2, '0')}.jpg`,
);

declare global {
  interface Window {
    __hero?: {
      next: () => void;
      goTo: (i: number) => void;
      progress: () => number;
      current: () => number;
    };
  }
}

const container = document.getElementById('webgl-container');
if (!container) throw new Error('Missing #webgl-container.');

/* Scroll first: ScrollTrigger has to exist before anything registers against
   it, and Lenis has to be driving the ticker before the first refresh. */
const lenis = initScroll();

const manager = new WebGLManager(container, SLIDES);
const slideshow = new Slideshow(manager, SLIDES, document);

void manager.showFirst(0).then(() => {
  /* Slide 2 preloads a beat after boot so it never fights the first slide
     for bandwidth; the rest warm on hover or on demand. */
  window.setTimeout(() => void manager.preload(1), 600);
  slideshow.startAutoplay();
});

/* ── Section two: three chapters, one pinned stage ───────────────────────── */

/* Only the wave chapter is still looked up. The marquee and cube drivers are
   pure scroll length now — they exist so the master clock has distance to run
   across, and nothing anchors a trigger to them any more. */
const chWave = document.getElementById('ch-wave');
const wavePanel = document.querySelector<HTMLElement>('.wave-panel');
const tmPanel = document.querySelector<HTMLElement>('.tm');
const cubePanel = document.querySelector<HTMLElement>('.cube');
const stmLayer = document.getElementById('stm-layer');

/* Panels first, stage last.
   The panels build their own DOM and register their own internal scrubs; the
   stage is the thing that decides which of them is on screen, and it paints
   once at the end of setup. Register it first and that opening paint runs
   against panels that do not have their rows or their marquee sets yet, so
   the first frame after boot is measured off an empty layout. */
const panelClock: ((p: number) => void)[] = [];

if (chWave && wavePanel) {
  initWavePanel({ panel: wavePanel, section: chWave, left: WAVE_LEFT, right: WAVE_RIGHT });
}

if (tmPanel) {
  panelClock.push(initTitleMarquee({ host: tmPanel, words: MARQUEE_WORDS, lenis }));
}

if (cubePanel) {
  panelClock.push(initCube({ host: cubePanel, faces: CUBE_FACES }));
}

/* One clock for the whole pinned run. The marquee and the cube no longer own
   a ScrollTrigger each — they are handed the same progress value and place
   themselves against fixed breakpoints in it, which is what makes the cube
   able to grow *inside* the marquee's phase instead of waiting for a section
   of its own. */
const scrollTrack = document.querySelector<HTMLElement>('.scroll-track');
const stageMask = document.querySelector<HTMLElement>('.stage__mask');
const heroEl = document.querySelector<HTMLElement>('.hero');

if (scrollTrack && stageMask && heroEl && wavePanel && tmPanel && cubePanel) {
  initStage({
    track: scrollTrack,
    mask: stageMask,
    hero: heroEl,
    wavePanel,
    marqueePanel: tmPanel,
    cubePanel,
    subscribers: panelClock,
  });
}

if (stmLayer) {
  initStatementLayer({ host: stmLayer, letters: 'VYRA', stacks: CAPTION_STACKS });
  initLetterDrift(stmLayer);
}

/* Scroll depth, not section membership: the pill is a fact about how far down
   the page you are, so it does not flicker at every chapter boundary. */
initNav(lenis);

/* The ring band is the only ambient marquee on the page. Its direction and
   duration are stated outright rather than derived from a DOM index, which
   would silently reverse it the moment another .marquee is added above it. */
const ringMarquee = document.querySelector<HTMLElement>('.ring__marquee');
if (ringMarquee) initMarquee(ringMarquee, { direction: 1, duration: 30 });

const ringSection = document.getElementById('ring-gallery');
const ringHost = ringSection?.querySelector<HTMLElement>('.ring__canvas');
if (ringSection && ringHost) {
  /* The heading and its sub-line, not the stats row. The stats span nearly
     the full width and the cards are meant to pass behind them; feeding them
     in as clearance would push the ring clean off the screen. */
  const clearance = [
    ringSection.querySelector<HTMLElement>('.ring__title'),
    ringSection.querySelector<HTMLElement>('.ring__sub'),
  ].filter((el): el is HTMLElement => el !== null);

  new RingGallery({
    sources: RING_SOURCES,
    section: ringSection,
    canvasHost: ringHost,
    clearance,
  });
}

const grainCanvas = document.getElementById('grain') as HTMLCanvasElement | null;
if (grainCanvas) startGrain(grainCanvas);

/* Images finishing after first paint change the document height, and every
   ScrollTrigger start/end was measured against the old one. */
window.addEventListener('load', () => ScrollTrigger.refresh());

window.__hero = {
  next: () => slideshow.next(),
  goTo: (i: number) => slideshow.goTo(i),
  progress: () => manager.uniformProgress(),
  current: () => slideshow.current,
};
