// M07 registry completeness report (G1 close condition: no errors). Pure SQL over schema v1.1.
import type { RegistryCheck, RegistryCheckItem, RegistryCheckReport } from '@sbc-noc/shared';
import type pg from 'pg';

interface CheckDef {
  check: string;
  severity: 'error' | 'warning';
  title: string;
  /** Must return columns code, name, detail. */
  sql: string;
}

// Active, real devices only: soft-deleted rows and sample data from the prototype are excluded
// from every check except `sample_data`, which exists to flag them.
const ACTIVE = `d.deleted_at IS NULL AND d.data_status <> 'sample'`;

export const CHECKS: CheckDef[] = [
  {
    check: 'no_position',
    severity: 'error',
    title: 'อุปกรณ์ไม่มีตำแหน่ง (ไม่มีทั้งชั้นและห้อง)',
    sql: `SELECT d.code, d.display_name AS name, d.role_code AS detail FROM net.devices d
          WHERE ${ACTIVE} AND d.location_id IS NULL AND d.floor_id IS NULL
            AND d.role_code NOT IN ('wan', 'controller') ORDER BY d.code`,
  },
  {
    check: 'duplicate_ip',
    severity: 'error',
    title: 'IP จัดการซ้ำกัน',
    sql: `SELECT d.code, d.display_name AS name, host(d.mgmt_ip) AS detail FROM net.devices d
          WHERE ${ACTIVE} AND d.mgmt_ip IN (
            SELECT mgmt_ip FROM net.devices WHERE deleted_at IS NULL AND mgmt_ip IS NOT NULL
            GROUP BY mgmt_ip HAVING count(*) > 1)
          ORDER BY d.mgmt_ip, d.code`,
  },
  {
    check: 'uplink_missing',
    severity: 'error',
    title: 'uplink ชี้ไปอุปกรณ์ที่ไม่มี (ถูกลบแล้ว)',
    sql: `SELECT b.code, b.display_name AS name, 'uplink → ' || a.code AS detail
          FROM net.links l JOIN net.devices b ON b.id = l.b_device_id JOIN net.devices a ON a.id = l.a_device_id
          WHERE l.is_uplink AND l.deleted_at IS NULL AND b.deleted_at IS NULL AND a.deleted_at IS NOT NULL
          ORDER BY b.code`,
  },
  {
    check: 'uplink_cycle',
    severity: 'error',
    title: 'uplink วนเป็นวง',
    sql: `WITH RECURSIVE up AS (
            SELECT l.b_device_id AS start, l.a_device_id AS cur, ARRAY[l.b_device_id] AS path
            FROM net.links l WHERE l.is_uplink AND l.deleted_at IS NULL
            UNION ALL
            SELECT up.start, l.a_device_id, up.path || up.cur
            FROM up JOIN net.links l ON l.b_device_id = up.cur AND l.is_uplink AND l.deleted_at IS NULL
            WHERE NOT up.cur = ANY(up.path)
          )
          SELECT d.code, d.display_name AS name, 'วนกลับมาที่ตัวเอง' AS detail
          FROM up JOIN net.devices d ON d.id = up.start
          WHERE up.cur = up.start AND d.deleted_at IS NULL
          GROUP BY d.code, d.display_name ORDER BY d.code`,
  },
  {
    check: 'not_in_zabbix',
    severity: 'error',
    title: 'อุปกรณ์ที่ต้องเฝ้าระวังแต่ยังไม่จับคู่กับ host ใน Zabbix',
    sql: `SELECT d.code, d.display_name AS name, d.role_code AS detail FROM net.devices d
          JOIN catalog.device_roles r ON r.code = d.role_code
          WHERE ${ACTIVE} AND d.lifecycle = 'active' AND r.monitored
            AND NOT EXISTS (SELECT 1 FROM core.external_refs x
                            WHERE x.entity_table = 'net.devices' AND x.entity_id = d.id AND x.system_code = 'zabbix')
          ORDER BY d.code`,
  },
  {
    check: 'sample_data',
    severity: 'error',
    title: 'ข้อมูลตัวอย่างจากต้นแบบปนอยู่ในทะเบียนจริง (ADR-0014)',
    sql: `SELECT d.code, d.display_name AS name, 'data_status = sample' AS detail FROM net.devices d
          WHERE d.deleted_at IS NULL AND d.data_status = 'sample' ORDER BY d.code`,
  },
  {
    check: 'no_room',
    severity: 'warning',
    title: 'อุปกรณ์ระบุแค่ชั้น ยังไม่ระบุห้อง (LOC)',
    sql: `SELECT d.code, d.display_name AS name, b.code || ' ชั้น ' || f.level AS detail FROM net.devices d
          JOIN core.floors f ON f.id = d.floor_id JOIN core.buildings b ON b.id = f.building_id
          WHERE ${ACTIVE} AND d.location_id IS NULL ORDER BY b.code, f.level, d.code`,
  },
  {
    check: 'no_uplink',
    severity: 'warning',
    title: 'อุปกรณ์ไม่มี uplink (นอกจากอุปกรณ์ต้นทางของเครือข่าย)',
    sql: `SELECT d.code, d.display_name AS name, d.role_code AS detail FROM net.devices d
          WHERE ${ACTIVE} AND d.role_code <> 'core'
            AND NOT EXISTS (SELECT 1 FROM net.links l WHERE l.b_device_id = d.id AND l.is_uplink AND l.deleted_at IS NULL)
          ORDER BY d.code`,
  },
  {
    check: 'no_mgmt_ip',
    severity: 'warning',
    title: 'อุปกรณ์ที่ต้องเฝ้าระวังแต่ยังไม่มี IP จัดการ',
    sql: `SELECT d.code, d.display_name AS name, d.role_code AS detail FROM net.devices d
          JOIN catalog.device_roles r ON r.code = d.role_code
          WHERE ${ACTIVE} AND d.lifecycle = 'active' AND r.monitored AND d.role_code <> 'wan' AND d.mgmt_ip IS NULL
          ORDER BY d.code`,
  },
];

export async function runRegistryChecks(db: pg.Pool | pg.PoolClient): Promise<RegistryCheckReport> {
  const checks: RegistryCheck[] = [];
  for (const def of CHECKS) {
    const { rows } = await db.query<RegistryCheckItem>(def.sql);
    checks.push({
      check: def.check,
      severity: def.severity,
      title: def.title,
      count: rows.length,
      items: rows.map((r) => ({ code: r.code, name: r.name, detail: r.detail ?? null })),
    });
  }
  const total = (s: 'error' | 'warning') =>
    checks.filter((c) => c.severity === s).reduce((n, c) => n + c.count, 0);
  return {
    generatedAt: new Date().toISOString(),
    errors: total('error'),
    warnings: total('warning'),
    checks,
  };
}
