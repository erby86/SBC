// SBC ASSET is a Google Sheet (SBC_ASSET_Field_Survey). The tab NOC_LOC_Export copies only
// building/floor/room/LOC/counts from 08_ควบคุมการปิดพื้นที่ and is published to the web as CSV,
// so the worker needs no Google credentials and sees no staff names (M05).
import { parseCsv } from '@sbc-noc/db';

export interface AssetLocRow {
  building: string; // name in SBC ASSET, e.g. "อาคาร 8 เซียน" (core.buildings.asset_name)
  floor: number | null;
  room: string;
  loc: string; // LOC-001, or SPORT-01 (ADR-0001 legacy code)
  registry: number | null;
}

export interface SbcAssetClient {
  locations(): Promise<AssetLocRow[]>;
}

const COLUMNS = ['building', 'floor', 'room', 'loc', 'registry'] as const;

export function parseAssetCsv(text: string): AssetLocRow[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  const missing = COLUMNS.filter((c) => rows.length > 0 && !(c in (rows[0] ?? {})));
  if (rows.length === 0 || missing.length) {
    throw new Error(
      `sbc-asset CSV: expected columns ${COLUMNS.join(', ')} — missing ${missing.join(', ') || 'rows'}`,
    );
  }
  const num = (s: string | undefined) => (s && /^\d+$/.test(s.trim()) ? Number(s) : null);
  return rows
    .filter((r) => r['loc'])
    .map((r) => ({
      building: r['building'] ?? '',
      floor: num(/(\d+)/.exec(r['floor'] ?? '')?.[1]), // "▶ ชั้น 3"
      room: r['room'] ?? '',
      loc: (r['loc'] ?? '').toUpperCase(),
      registry: num(r['registry']),
    }));
}

export function createSbcAssetClient(
  csvUrl: string,
  fetchImpl: typeof fetch = fetch,
): SbcAssetClient {
  return {
    async locations() {
      const res = await fetchImpl(csvUrl, {
        signal: AbortSignal.timeout(30_000),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`sbc-asset CSV: HTTP ${res.status}`);
      return parseAssetCsv(await res.text());
    },
  };
}
