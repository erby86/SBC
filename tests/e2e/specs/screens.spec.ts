// M22 / G4 close: every main screen at 1920×1080 (dark), 1366×768 (light) and 390×844 (phone)
// has no text past an edge. Incidents come from the demo mode (M38, ADR-0014), so the run
// never depends on what the real network is doing.
import { expect, test } from '@playwright/test';
import { checkScreen, openNoc, panel } from '../lib/noc.js';

const LINKS = {
  zabbix:
    'http://zabbix.sbc.lan/zabbix.php?action=problem.view&filter_set=1&hostids[]={zabbixHostId}' +
    ' || http://zabbix.sbc.lan/zabbix.php?action=host.view&filter_set=1&filter_name={name}',
  grafana: 'http://grafana.sbc.lan/d/noc-host/noc-host?var-host={name}',
  glpi: 'http://glpi.sbc.lan/front/search.php?globalsearch={code}',
};

test('page is served with a Content-Security-Policy (M17)', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.headers()['content-security-policy'] ?? '').toContain("default-src 'self'");
});

test('NOC page (real data)', async ({ page }, info) => {
  await openNoc(page, '/');
  await expect(page.getByTestId('demo-bar')).toHaveCount(0);
  await checkScreen(page, info, '01-noc');
});

test('demo: incidents', async ({ page }, info) => {
  await openNoc(page, '/?demo=mixed');
  await expect(page.getByTestId('demo-bar')).toBeVisible();
  await expect(panel(page).locator('.inc').first()).toBeVisible();
  await checkScreen(page, info, '02-incidents');
});

test('demo: one root cause takes 21 devices with it (storm)', async ({ page }, info) => {
  await openNoc(page, '/?demo=storm');
  await expect(page.getByTestId('one-root')).toBeVisible();
  // followers have no card of their own: the root cause and the separate warning only
  await expect(panel(page).locator('.inc')).toHaveCount(2);
  await expect(page.getByTestId('root-group')).toContainText('ดับตาม 21 ตัว ใน 6 อาคาร');
  await page
    .getByTestId('root-group')
    .getByRole('button', { name: /ดูรายชื่อ/ })
    .click();
  await expect(page.getByTestId('root-group').locator('.glist li')).toHaveCount(21);
  // event log: the devices Zabbix also sees down fold into one line behind the root cause
  await expect(page.getByTestId('event-log')).toContainText('รวมเข้าเหตุเดียวกัน');
  await checkScreen(page, info, '02b-storm');
});

test('demo: device details with Zabbix/Grafana/GLPI buttons', async ({ page }, info) => {
  await page.route('**/api/config/links', (r) => r.fulfill({ json: LINKS }));
  await openNoc(page, '/?demo=mixed');
  // an incident of a device on the map (the scenario also has one without a position)
  await panel(page).locator('.inc', { hasText: 'NVR' }).first().click();
  const card = page.getByTestId('info');
  await expect(card).toBeVisible();
  const links = card.getByTestId('out-links').locator('a');
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveAttribute('href', /^http:\/\/zabbix\.sbc\.lan\/zabbix\.php\?/);
  await expect(links.nth(1)).toHaveAttribute('href', /^http:\/\/grafana\.sbc\.lan\/d\/noc-host/);
  await expect(links.nth(2)).toHaveAttribute('href', /globalsearch=/);
  await expect(links.nth(0)).toHaveAttribute('target', '_blank');
  await page.waitForTimeout(1500); // fly-to the device
  await checkScreen(page, info, '03-details');
});

test('demo: 24 h history', async ({ page }, info) => {
  await openNoc(page, '/?demo=mixed');
  await panel(page).getByRole('tab', { name: 'ประวัติ' }).click();
  await expect(page.getByTestId('history').first()).toBeVisible();
  await checkScreen(page, info, '04-history');
});

test('search', async ({ page }, info) => {
  await openNoc(page, '/');
  await page.keyboard.press('/');
  const box = page.getByRole('combobox', { name: 'ค้นหา' }).locator('visible=true');
  await box.fill('main');
  await expect(page.locator('[role="listbox"] [role="option"]').first()).toBeVisible();
  await checkScreen(page, info, '05-search');
});

test('help', async ({ page }, info) => {
  await openNoc(page, '/');
  await page.getByTestId('menu').click();
  await page.getByRole('button', { name: 'วิธีใช้' }).click();
  await expect(page.getByTestId('help')).toBeVisible();
  await checkScreen(page, info, '06-help');
});

// M23: /admin needs login. CI creates the account (user-cli) and sets E2E_EMAIL / E2E_PASSWORD;
// without them (e.g. a run against staging) only the login screen is checked.
const e2eEmail = process.env['E2E_EMAIL'];
const e2ePassword = process.env['E2E_PASSWORD'];

test('registry admin', async ({ page }, info) => {
  await page.goto('/admin/checks');
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeVisible();
  await checkScreen(page, info, '07-admin-login');
  test.skip(!e2eEmail || !e2ePassword, 'no e2e account (E2E_EMAIL / E2E_PASSWORD)');
  await page.getByLabel('อีเมล').fill(e2eEmail ?? '');
  await page.getByLabel('รหัสผ่าน').fill(e2ePassword ?? '');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByTestId('whoami')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await checkScreen(page, info, '08-admin-checks');
});
