// M22 / G4 close: every main screen at 1920×1080 (dark), 1366×768 (light) and 390×844 (phone)
// has no text past an edge. Incidents come from the demo mode (M38, ADR-0014), so the run
// never depends on what the real network is doing.
import { expect, test } from '@playwright/test';
import { checkScreen, isPhone, openNoc, panel } from '../lib/noc.js';

const LINKS = {
  zabbix:
    'http://zabbix.sbc.lan/zabbix.php?action=problem.view&filter_set=1&hostids[]={zabbixHostId}' +
    ' || http://zabbix.sbc.lan/zabbix.php?action=host.view&filter_set=1&filter_name={name}',
  grafana: 'http://grafana.sbc.lan/d/noc-host/noc-host?var-host={name}',
  glpi: 'http://glpi.sbc.lan/front/search.php?globalsearch={code}',
};

test('NOC page (real data)', async ({ page }, info) => {
  await openNoc(page, '/');
  await expect(page.getByTestId('demo-bar')).toHaveCount(0);
  await checkScreen(page, info, '01-noc');
});

test('demo: incidents', async ({ page }, info) => {
  await openNoc(page, '/?demo=mixed');
  await expect(page.getByTestId('demo-bar')).toBeVisible();
  await expect(panel(page, info).locator('.inc').first()).toBeVisible();
  await checkScreen(page, info, '02-incidents');
});

test('demo: device details with Zabbix/Grafana/GLPI buttons', async ({ page }, info) => {
  await page.route('**/api/config/links', (r) => r.fulfill({ json: LINKS }));
  await openNoc(page, '/?demo=mixed');
  // an incident of a device on the map (the scenario also has one without a position)
  await panel(page, info).locator('.inc', { hasText: 'NVR' }).first().click();
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
  await panel(page, info).getByRole('tab', { name: 'ประวัติ' }).click();
  await expect(page.getByTestId('history').first()).toBeVisible();
  await checkScreen(page, info, '04-history');
});

test('search', async ({ page }, info) => {
  await openNoc(page, '/');
  if (isPhone(info)) await panel(page, info).getByRole('tab', { name: 'ค้นหา' }).click();
  else await page.keyboard.press('/');
  const box = page.getByRole('combobox', { name: 'ค้นหา' }).locator('visible=true');
  await box.fill('main');
  await expect(page.locator('[role="listbox"] [role="option"]').first()).toBeVisible();
  await checkScreen(page, info, '05-search');
});

test('help', async ({ page }, info) => {
  await openNoc(page, '/');
  await page.getByRole('button', { name: 'วิธีใช้' }).locator('visible=true').first().click();
  await expect(page.getByTestId('help')).toBeVisible();
  await checkScreen(page, info, '06-help');
});

test('registry admin', async ({ page }, info) => {
  await page.goto('/admin/checks');
  await expect(page.locator('main, #root').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await checkScreen(page, info, '07-admin-checks');
});
