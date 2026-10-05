import { describe, expect, it } from 'vitest';
import { fillLinkTemplate, linkTemplateSchema, optionalLinkTemplateSchema } from './links.js';

describe('fillLinkTemplate', () => {
  const zbx =
    'http://zabbix.sbc.lan/zabbix.php?action=problem.view&filter_set=1&hostids[]={zabbixHostId}' +
    ' || http://zabbix.sbc.lan/zabbix.php?action=host.view&filter_set=1&filter_name={hostname}';

  it('fills placeholders and encodes values', () => {
    expect(
      fillLinkTemplate('http://g/d/x?var-host={hostname}&ip={ip}', {
        hostname: 'B1 F2',
        ip: '10.0.0.1',
      }),
    ).toBe('http://g/d/x?var-host=B1%20F2&ip=10.0.0.1');
  });

  it('uses the first template whose placeholders all have values', () => {
    expect(fillLinkTemplate(zbx, { zabbixHostId: '10084', hostname: 'core' })).toBe(
      'http://zabbix.sbc.lan/zabbix.php?action=problem.view&filter_set=1&hostids[]=10084',
    );
    expect(fillLinkTemplate(zbx, { zabbixHostId: null, hostname: 'core' })).toBe(
      'http://zabbix.sbc.lan/zabbix.php?action=host.view&filter_set=1&filter_name=core',
    );
  });

  it('returns null without a template or when a value is missing', () => {
    expect(fillLinkTemplate(null, { code: 'x' })).toBeNull();
    expect(fillLinkTemplate(zbx, {})).toBeNull();
    expect(fillLinkTemplate('http://glpi/?q={assetTag}', { assetTag: '' })).toBeNull();
  });
});

describe('linkTemplateSchema', () => {
  it('accepts http(s) templates with known placeholders', () => {
    expect(linkTemplateSchema.safeParse('https://g.sbc.lan/d/a?var-host={hostname}').success).toBe(
      true,
    );
    expect(linkTemplateSchema.safeParse('http://a/{loc} || http://b/{code}').success).toBe(true);
  });

  it('rejects other schemes and unknown placeholders', () => {
    expect(linkTemplateSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(linkTemplateSchema.safeParse('http://a/{password}').success).toBe(false);
  });
});

describe('optionalLinkTemplateSchema', () => {
  it('treats empty or unset env values as no template', () => {
    expect(optionalLinkTemplateSchema.parse('')).toBeUndefined();
    expect(optionalLinkTemplateSchema.parse('  ')).toBeUndefined();
    expect(optionalLinkTemplateSchema.parse(undefined)).toBeUndefined();
    expect(optionalLinkTemplateSchema.parse('http://a/{ip}')).toBe('http://a/{ip}');
    expect(optionalLinkTemplateSchema.safeParse('ftp://a').success).toBe(false);
  });
});
