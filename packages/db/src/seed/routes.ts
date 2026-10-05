// M19: device positions (viz.device_placements) and cable bends (viz.link_routes.waypoints) as
// drawn in the prototype, so the 3D scene matches it. Fill-only: a placement or route that is
// already set (by a person or a later tool) is never overwritten, and a second run writes nothing.
import type pg from 'pg';
import type { PrototypeRoutes } from './files.js';

export interface RoutesReport {
  placements: number;
  routes: number;
  /** Devices in the file that are not in the registry (deleted or renamed). */
  missing: string[];
}

export async function applyPrototypeRoutes(
  c: pg.PoolClient,
  data: PrototypeRoutes,
): Promise<RoutesReport> {
  const report: RoutesReport = { placements: 0, routes: 0, missing: [] };
  for (const p of data.placements) {
    const dev = await c.query<{ id: string }>(
      'SELECT id FROM net.devices WHERE code = $1 AND deleted_at IS NULL',
      [p.device],
    );
    const id = dev.rows[0]?.id;
    if (!id) {
      report.missing.push(p.device);
      continue;
    }
    const res = await c.query(
      `INSERT INTO viz.device_placements (device_id, mode, u, v) VALUES ($1, 'manual', $2, $3)
       ON CONFLICT (device_id) DO UPDATE SET mode = 'manual', u = EXCLUDED.u, v = EXCLUDED.v
       WHERE viz.device_placements.u IS NULL OR viz.device_placements.v IS NULL`,
      [id, p.u, p.v],
    );
    report.placements += res.rowCount ?? 0;
  }
  for (const r of data.routes) {
    // the uplink that feeds the device (the prototype draws one cable per child)
    const link = await c.query<{ id: string }>(
      `SELECT k.id FROM net.links k JOIN net.devices d ON d.id = k.b_device_id
       WHERE d.code = $1 AND d.deleted_at IS NULL AND k.is_uplink AND k.deleted_at IS NULL`,
      [r.device],
    );
    const id = link.rows[0]?.id;
    if (!id) {
      if (!report.missing.includes(r.device)) report.missing.push(r.device);
      continue;
    }
    const res = await c.query(
      `INSERT INTO viz.link_routes (link_id, waypoints, rule) VALUES ($1, $2, 'prototype')
       ON CONFLICT (link_id) DO UPDATE SET waypoints = EXCLUDED.waypoints, rule = EXCLUDED.rule
       WHERE viz.link_routes.waypoints = '[]'::jsonb`,
      [id, JSON.stringify(r.waypoints)],
    );
    report.routes += res.rowCount ?? 0;
  }
  return report;
}
