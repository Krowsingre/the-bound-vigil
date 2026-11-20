// The splash settling into TBV (embre, 20 November): the words and emblem
// drift up a little and fade, the painting eases forward and fades, and the
// splash's dark colour gives way to the page underneath, all in about half a
// second. The same on every device: over the page on a phone or tablet, and
// as the computer's card over its window.

/** How long the whole settle takes (ms); matches .splash.is-settling in splash.css. */
export const SETTLE = 550;

export function settle(splash: HTMLElement): Promise<void> {
  return new Promise((done) => {
    splash.classList.add("is-settling");
    setTimeout(() => {
      splash.remove();
      done();
    }, SETTLE + 50);
  });
}
