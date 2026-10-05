// The text-overflow check itself: it must catch text past the window or cut by a box, and let
// scrollable boxes and deliberate ellipsis pass. Otherwise a green screen run proves nothing.
import { expect, test } from '@playwright/test';
import { findTextOverflow } from '../lib/overflow.js';

const onlyOnce = () =>
  test.skip(test.info().project.name !== 'desktop-1920', 'page-independent; one size is enough');

const page_ = (body: string) =>
  `<!doctype html><html><body style="margin:0;font:16px sans-serif">${body}</body></html>`;

test('flags text past the window edge and text cut by a box', async ({ page }) => {
  onlyOnce();
  await page.setViewportSize({ width: 400, height: 300 });
  await page.setContent(
    page_(`
      <div style="position:fixed;left:350px;top:10px;white-space:nowrap">ข้อความเลยขอบขวา</div>
      <div style="width:80px;overflow:hidden;white-space:nowrap;margin-top:60px">
        <span>ข้อความยาวที่ถูกตัดในกล่อง</span></div>
      <div style="height:12px;overflow:hidden;margin-top:20px;line-height:40px">สูงเกินกล่อง</div>`),
  );
  const hits = await findTextOverflow(page);
  expect(hits.map((h) => h.text)).toEqual([
    'ข้อความเลยขอบขวา',
    'ข้อความยาวที่ถูกตัดในกล่อง',
    'สูงเกินกล่อง',
  ]);
});

test('lets scrollable boxes, ellipsis and hidden text pass', async ({ page }) => {
  onlyOnce();
  await page.setViewportSize({ width: 400, height: 300 });
  await page.setContent(
    page_(`
      <div style="height:40px;overflow:auto"><p>1</p><p>2</p><p>3 อยู่ล่างแต่เลื่อนดูได้</p></div>
      <div style="width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">ตัดด้วยจุดสามจุด</div>
      <div style="display:none">ซ่อนอยู่</div>
      <div style="margin-top:600px">หน้ายาว เลื่อนลงมาอ่านได้</div>
      <div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">สำหรับโปรแกรมอ่านจอ</div>`),
  );
  expect(await findTextOverflow(page)).toEqual([]);
});
