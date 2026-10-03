// M05: sync rooms (LOC) and registry PC counts from SBC ASSET (read-only).
// - LOC not in the database → created on its floor (owner sbc_asset). A non-LOC code (SPORT-xx)
//   gets the next number from this database and keeps its code as legacy_code (ADR-0001).
// - LOC that exists but SBC ASSET shows another building/floor/name → `loc_conflict` issue; the
//   database is never overwritten by the sync (people decide).
// - LOC numbers from the NOC range (≥ 187) that this database never issued → `loc_conflict`.
// - LOC owned by sbc_asset that disappeared from SBC ASSET → `loc_missing` issue (not deleted).
// - registry_pc_count in core.location_metrics follows SBC ASSET (source sbc_asset).
import type { SbcAssetClient } from '../connectors/sbc-asset.js';
import type { JobDefinition } from './types.js';

const LOC_RE = /^LOC-(\d{3,})$/;
/** First number issued by this database (LOC-187 = server room, core.loc_code_seq starts at 188). */
const NOC_RANGE_START = 187;

interface IssueRow {
  kind: 'loc_conflict' | 'loc_missing';
  externalId: string;
  message: string;
}

interface DbLoc {
  id: string;
  loc_code: string;
  legacy: string | null;
  name: string;
  building: string;
  asset_name: string | null;
  level: number;
  owner_system: string;
}

export function assetLocsJob(asset: SbcAssetClient): JobDefinition {
  return {
    name: 'asset-locs',
    systemCode: 'sbc_asset',
    schedule: { every: 60 * 60_000 },
    attempts: 3,
    async run({ db, runId }) {
      const rows = await asset.locations();

      const c = await db.connect();
      let created = 0;
      let updated = 0;
      const issues: IssueRow[] = [];
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.actor', 'worker:asset-locs', true)`);

        const floors = new Map<string, string>(); // "<asset building name>/<level>" → floor id
        for (const r of (
          await c.query<{ asset_name: string; level: number; id: string }>(
            `SELECT b.asset_name, f.level, f.id FROM core.floors f
             JOIN core.buildings b ON b.id = f.building_id WHERE b.asset_name IS NOT NULL`,
          )
        ).rows) {
          floors.set(`${r.asset_name}/${r.level}`, r.id);
        }

        const locs = (
          await c.query<DbLoc>(
            `SELECT l.id, l.loc_code, l.attributes->>'legacy_code' AS legacy, l.name, b.code AS building,
                    b.asset_name, f.level, l.owner_system
             FROM core.locations l JOIN core.floors f ON f.id = l.floor_id
             JOIN core.buildings b ON b.id = f.building_id
             WHERE l.deleted_at IS NULL`,
          )
        ).rows;
        const byCode = new Map<string, DbLoc>();
        for (const l of locs) {
          byCode.set(l.loc_code, l);
          if (l.legacy) byCode.set(l.legacy, l);
        }

        // An empty or truncated export must not mark every room as missing.
        const owned = locs.filter((l) => l.owner_system === 'sbc_asset').length;
        if (rows.length < owned / 2) {
          throw new Error(
            `sbc-asset: export has ${rows.length} rooms but ${owned} are registered from SBC ASSET — check the sheet`,
          );
        }

        const seen = new Set<string>();
        for (const row of rows) {
          seen.add(row.loc);
          const where = `${row.building} ชั้น ${row.floor ?? '?'}`;
          const floorId =
            row.floor === null ? undefined : floors.get(`${row.building}/${row.floor}`);
          let loc = byCode.get(row.loc);

          if (loc) {
            const diffs: string[] = [];
            if (loc.asset_name !== row.building || loc.level !== row.floor) {
              diffs.push(
                `ที่ตั้ง: ฐาน ${loc.asset_name ?? loc.building} ชั้น ${loc.level} / SBC ASSET ${where}`,
              );
            }
            if (loc.name !== row.room)
              diffs.push(`ชื่อ: ฐาน "${loc.name}" / SBC ASSET "${row.room}"`);
            if (diffs.length) {
              issues.push({
                kind: 'loc_conflict',
                externalId: row.loc,
                message: `${loc.loc_code} ไม่ตรงกับ SBC ASSET — ${diffs.join('; ')}`,
              });
            }
          } else if (!floorId) {
            issues.push({
              kind: 'loc_conflict',
              externalId: row.loc,
              message: `${row.loc} "${row.room}": ไม่รู้จักอาคาร/ชั้น "${where}" ในฐาน`,
            });
            continue;
          } else if (Number(LOC_RE.exec(row.loc)?.[1] ?? 0) >= NOC_RANGE_START) {
            issues.push({
              kind: 'loc_conflict',
              externalId: row.loc,
              message: `${row.loc} "${row.room}": เลขนี้ไม่ได้ออกจากฐาน NOC (ADR-0001 — ขอเลขใหม่จาก NOC)`,
            });
            continue;
          } else {
            const legacy = LOC_RE.test(row.loc) ? null : row.loc;
            const ins = await c.query<{ id: string; loc_code: string }>(
              `INSERT INTO core.locations (loc_code, floor_id, name, owner_system, attributes)
               VALUES (${legacy ? 'core.next_loc_code()' : '$4'}, $1, $2, 'sbc_asset', $3)
               RETURNING id, loc_code`,
              [
                floorId,
                row.room,
                { source: 'sbc_asset', ...(legacy ? { legacy_code: legacy } : {}) },
                ...(legacy ? [] : [row.loc]),
              ],
            );
            const r = ins.rows[0] as { id: string; loc_code: string };
            loc = {
              id: r.id,
              loc_code: r.loc_code,
              legacy,
              name: row.room,
              building: '',
              asset_name: row.building,
              level: row.floor ?? 0,
              owner_system: 'sbc_asset',
            };
            byCode.set(row.loc, loc);
            created += 1;
          }

          if (row.registry !== null) {
            const m = await c.query(
              `INSERT INTO core.location_metrics (location_id, metric, value, source)
               VALUES ($1, 'registry_pc_count', $2, 'sbc_asset')
               ON CONFLICT (location_id, metric, source) DO UPDATE SET value = EXCLUDED.value, as_of = now()
               WHERE core.location_metrics.value IS DISTINCT FROM EXCLUDED.value`,
              [loc.id, row.registry],
            );
            updated += m.rowCount ?? 0;
          }
        }

        for (const l of locs) {
          if (
            l.owner_system !== 'sbc_asset' ||
            seen.has(l.loc_code) ||
            (l.legacy && seen.has(l.legacy))
          ) {
            continue;
          }
          issues.push({
            kind: 'loc_missing',
            externalId: l.legacy ?? l.loc_code,
            message: `${l.loc_code} "${l.name}" ไม่อยู่ใน SBC ASSET แล้ว — ยกเลิกห้องหรือเปลี่ยนเลข?`,
          });
        }

        // One open issue per (kind, LOC); resolve the ones that no longer apply.
        for (const i of issues) {
          await c.query(
            `INSERT INTO sync.issues (run_id, system_code, kind, external_id, entity_table, message)
             SELECT $1, 'sbc_asset', $2, $3, 'core.locations', $4
             WHERE NOT EXISTS (SELECT 1 FROM sync.issues WHERE system_code = 'sbc_asset' AND kind = $2
                               AND external_id = $3 AND resolved_at IS NULL)`,
            [runId, i.kind, i.externalId, i.message],
          );
        }
        await c.query(
          `UPDATE sync.issues SET resolved_at = now()
           WHERE system_code = 'sbc_asset' AND resolved_at IS NULL AND kind IN ('loc_conflict', 'loc_missing')
             AND NOT ((kind || '/' || external_id) = ANY($1::text[]))`,
          [issues.map((i) => `${i.kind}/${i.externalId}`)],
        );
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK');
        throw err;
      } finally {
        c.release();
      }

      const count = (k: IssueRow['kind']) => issues.filter((i) => i.kind === k).length;
      return {
        created,
        updated,
        errors: count('loc_conflict'),
        detail: {
          asset_rows: rows.length,
          conflicts: count('loc_conflict'),
          missing: count('loc_missing'),
        },
      };
    },
  };
}
