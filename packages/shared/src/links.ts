// M22: buttons that open a device or room in Zabbix, Grafana and GLPI (baseline §8, G4).
// The api serves URL templates from its env (LINK_*_URL); the web fills them per device.
// Template: `http://zabbix.sbc.lan/zabbix.php?action=problem.view&filter_set=1&hostids[]={zabbixHostId}`
// Several templates may be joined with ` || `: the first one whose placeholders all have a value
// wins (e.g. by Zabbix hostid, else by host name).
import { z } from 'zod';

export const LINK_PLACEHOLDERS = [
  'code',
  'name',
  'hostname',
  'ip',
  'loc',
  'building',
  'zabbixHostId',
  'assetTag',
] as const;
export type LinkPlaceholder = (typeof LINK_PLACEHOLDERS)[number];
export type LinkValues = Partial<Record<LinkPlaceholder, string | number | null | undefined>>;

export const outLinksSchema = z.object({
  zabbix: z.string().nullable(),
  grafana: z.string().nullable(),
  glpi: z.string().nullable(),
});
export type OutLinks = z.infer<typeof outLinksSchema>;
export type OutLinkSystem = keyof OutLinks;

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;
const isPlaceholder = (k: string): k is LinkPlaceholder =>
  (LINK_PLACEHOLDERS as readonly string[]).includes(k);

/** Env value check: http(s) templates with known placeholders only. */
export const linkTemplateSchema = z
  .string()
  .trim()
  .refine(
    (v) =>
      v.split('||').every((t) => {
        const s = t.trim();
        return (
          /^https?:\/\/[^\s]+$/.test(s) &&
          [...s.matchAll(PLACEHOLDER)].every((m) => isPlaceholder(m[1] ?? ''))
        );
      }),
    { message: 'http(s) URL; placeholders: ' + LINK_PLACEHOLDERS.join(', ') },
  );

/** Env key of a template: empty or unset = no button (compose passes `${VAR:-}` as ""). */
export const optionalLinkTemplateSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  linkTemplateSchema.optional(),
);

/** Fills the first template whose placeholders all have a value; null = no usable link. */
export function fillLinkTemplate(template: string | null, values: LinkValues): string | null {
  if (!template) return null;
  for (const t of template.split('||')) {
    let missing = false;
    const url = t.trim().replace(PLACEHOLDER, (_, key: string) => {
      const v = isPlaceholder(key) ? values[key] : undefined;
      if (v === null || v === undefined || v === '') {
        missing = true;
        return '';
      }
      return encodeURIComponent(String(v));
    });
    if (!missing && url) return url;
  }
  return null;
}
