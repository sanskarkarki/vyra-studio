import gsap from 'gsap';
import type Lenis from 'lenis';

/**
 * The pill nav.
 *
 * Two things here are not what they look like.
 *
 * **It is not tied to a section.** The pill appears at a fixed scroll depth —
 * 300px — and disappears again below it, in both directions. Anchoring it to
 * section two instead means it is present or absent depending on which
 * chapter you happen to be in, and it flickers at every boundary. Depth is a
 * stable fact; section membership is not.
 *
 * **The entrance is CSS, not a tween.** A hairline stretches out to full
 * width, then inflates to a 64px box and squares its corners. That is two
 * different transforms in sequence on the same element, which is exactly what
 * a keyframe list is for; expressing it as a tween means either two chained
 * tweens that can desynchronise, or one tween that cannot describe the middle
 * state at all. All this file does is add and remove a class.
 */

/** Scroll depth, in pixels, at which the pill commits to being visible. */
const SHOW_AT = 300;

export function initNav(lenis: Lenis): void {
  const nav = document.querySelector<HTMLElement>('.topnav');
  if (!nav) return;

  const dropdown = document.querySelector<HTMLElement>('.topnav__menu');
  const toggle = document.querySelector<HTMLElement>('.topnav__burger');

  let showing = false;
  let open = false;

  function closeMenu(): void {
    if (!open || !dropdown || !toggle) return;
    open = false;
    nav?.classList.remove('is-menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    gsap.to(dropdown, {
      height: 0,
      paddingTop: 0,
      paddingBottom: 0,
      opacity: 0,
      duration: 0.45,
      ease: 'power2.in',
    });
  }

  const sync = (): void => {
    const shouldShow = window.scrollY > SHOW_AT;
    if (shouldShow === showing) return;
    showing = shouldShow;
    nav.classList.toggle('topnav--in', showing);
    nav.classList.toggle('topnav--out', !showing);

    /* Closing on the way out matters: the pill animates back to a hairline,
       and a dropdown left open would be clipped mid-collapse and then be
       waiting, still open, the next time it stretches back in. */
    if (!showing) closeMenu();
  };

  /* Driven from Lenis rather than the native scroll event so the check runs on
     the same clock as every scrubbed animation on the page. */
  lenis.on('scroll', sync);
  sync();

  if (!dropdown || !toggle) return;

  toggle.addEventListener('click', () => {
    open = !open;
    nav.classList.toggle('is-menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    gsap.to(dropdown, {
      height: open ? 'auto' : 0,
      /* The 1.4rem side padding is in the stylesheet, but the vertical
         padding has to arrive with the height or the links sit flush against
         the row above them for the whole open animation. */
      paddingTop: open ? '0.6rem' : 0,
      paddingBottom: open ? '1rem' : 0,
      opacity: open ? 1 : 0,
      duration: 0.45,
      ease: open ? 'power3.out' : 'power2.in',
    });
  });
}
