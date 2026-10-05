// M22 / G4: "screenshots at 3 sizes have no text past the edge". Runs in the page and lists every
// visible piece of text that lies outside the window, or is cut off by a box that hides overflow.
// Allowed: text inside a box the user can scroll (overflow auto/scroll) and deliberate
// ellipsis (text-overflow: ellipsis) — both still let the reader get at the whole text.
import type { Page } from '@playwright/test';

export interface OverflowHit {
  text: string;
  where: string;
  why: string;
  rect: { left: number; top: number; right: number; bottom: number };
}

export async function findTextOverflow(page: Page): Promise<OverflowHit[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const hits: OverflowHit[] = [];
    const path = (el: Element) => {
      const parts: string[] = [];
      for (
        let e: Element | null = el;
        e && e !== document.body && parts.length < 4;
        e = e.parentElement
      ) {
        const id = e.id ? `#${e.id}` : '';
        const cls = e.classList.length ? `.${[...e.classList].slice(0, 2).join('.')}` : '';
        parts.unshift(`${e.tagName.toLowerCase()}${id}${cls}`);
      }
      return parts.join(' > ');
    };
    if (document.documentElement.scrollWidth > vw + 1)
      hits.push({
        text: '',
        where: 'html',
        why: `page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`,
        rect: { left: 0, top: 0, right: document.documentElement.scrollWidth, bottom: 0 },
      });

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      const el = n.parentElement;
      if (!text || !el) continue;
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"], canvas, script, style, noscript')) continue;
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      if (!rects.length) continue;
      const box = {
        left: Math.min(...rects.map((r) => r.left)),
        top: Math.min(...rects.map((r) => r.top)),
        right: Math.max(...rects.map((r) => r.right)),
        bottom: Math.max(...rects.map((r) => r.bottom)),
      };
      // visually-hidden helpers (clip to 1px) are for screen readers only
      const cs0 = getComputedStyle(el);
      if (cs0.clip !== 'auto' && cs0.position === 'absolute') continue;

      // Thai glyph boxes reach above/below the line box (tone marks), so vertical checks allow
      // a quarter of the text height; a box only "cuts" when its content really overflows it.
      const slackY = (box.bottom - box.top) / 4;
      let why: string | null = null;
      let scrollable = false;
      for (let a: Element | null = el; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        const ar = a.getBoundingClientRect();
        const outX = box.left < ar.left - 1 || box.right > ar.right + 1;
        const outY = box.top < ar.top - slackY || box.bottom > ar.bottom + slackY;
        const overX = cs.overflowX !== 'visible' && a.scrollWidth > a.clientWidth + 1;
        const overY = cs.overflowY !== 'visible' && a.scrollHeight > a.clientHeight + 1;
        const scrollX = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
        const scrollY = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
        if ((outX && overX && scrollX) || (outY && overY && scrollY)) {
          scrollable = true; // the reader can scroll to it
          break;
        }
        if (a === document.body) break;
        if (outX && overX && cs.textOverflow !== 'ellipsis') {
          why = `cut off sideways by ${path(a)}`;
          break;
        }
        if (outY && overY) {
          why = `cut off at top/bottom by ${path(a)}`;
          break;
        }
      }
      if (!why && !scrollable) {
        if (box.left < -1 || box.right > vw + 1) why = 'past the left/right edge of the window';
        else if (box.top < -slackY || box.bottom > vh + slackY)
          why = 'past the top/bottom edge of the window';
      }
      if (why)
        hits.push({
          text: text.slice(0, 60),
          where: path(el),
          why,
          rect: {
            left: Math.round(box.left),
            top: Math.round(box.top),
            right: Math.round(box.right),
            bottom: Math.round(box.bottom),
          },
        });
    }
    return hits;
  });
}
