// M22 / G4 close: the TV screen (1920×1080) keeps ≥ 30 frames per second and has no text past
// an edge. The fps chip (`?fps`) averages 5 s after a 6 s warm-up. Software rendering in CI is
// far slower than a TV's GPU, so the 30 fps bar applies only when E2E_MIN_FPS is set (on the TV
// itself, or a machine like it — docs/uat/M22-uat.md).
import { expect, test } from '@playwright/test';
import { checkScreen, openNoc } from '../lib/noc.js';

test('TV mode: fps and no text past an edge', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1920', 'TV screens are 1920×1080');
  await openNoc(page, '/?tv&fps&demo=mixed');
  await expect(page.locator('#app.tv')).toBeVisible();
  const chip = page.getByTestId('fps');
  await expect(chip).toBeVisible({ timeout: 30_000 });
  const fps = Number((await chip.textContent())?.match(/\d+/)?.[0] ?? 0);
  info.annotations.push({ type: 'fps', description: String(fps) });
  console.info(`TV fps (${info.project.name}): ${fps}`);
  await checkScreen(page, info, '08-tv');
  const min = Number(process.env['E2E_MIN_FPS'] ?? 0);
  if (min) expect(fps, 'frames per second on the TV screen').toBeGreaterThanOrEqual(min);
});
