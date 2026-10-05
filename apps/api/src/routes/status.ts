// M15: the latest status snapshot written by the worker's status engine. Freshness is checked here
// too, so a dead worker shows up as stale even though the stored snapshot says otherwise.
import {
  STALE_AFTER_MS,
  statusHistorySchema,
  statusSnapshotSchema,
  unlocatedListSchema,
  type StatusHistory,
  type StatusSnapshot,
  type UnlocatedList,
} from '@sbc-noc/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export function statusRoutes(
  app: FastifyInstance,
  read: () => Promise<StatusSnapshot | null>,
  now: () => Date = () => new Date(),
): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/status',
    {
      schema: {
        tags: ['status'],
        summary: 'สถานะล่าสุด: สถานะต่ออุปกรณ์, เหตุ (ต้นเหตุ), ความสดของข้อมูล',
        response: { 200: statusSnapshotSchema, 503: z.object({ message: z.string() }) },
      },
    },
    async (_req, reply) => {
      const snap = await read();
      if (!snap) {
        return reply.code(503).send({ message: 'ยังไม่มีสถานะ — ตัวคำนวณสถานะยังไม่ได้ทำงาน' });
      }
      const stale = snap.stale || now().getTime() - Date.parse(snap.lastUpdate) > STALE_AFTER_MS;
      reply.header('Cache-Control', 'no-store');
      return { ...snap, stale };
    },
  );
}

export interface StatusExtras {
  history: () => Promise<StatusHistory | null>;
  unlocated: () => Promise<UnlocatedList | null>;
}

/** M20: 24 h problem history and Zabbix hosts without a registry position (worker → Redis). */
export function statusExtraRoutes(app: FastifyInstance, read: StatusExtras): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const notYet = z.object({ message: z.string() });
  r.get(
    '/status/history',
    {
      schema: {
        tags: ['status'],
        summary: 'เหตุการณ์ 24 ชั่วโมงล่าสุดจาก Zabbix (ใหม่สุดก่อน; end = null คือยังไม่หาย)',
        response: { 200: statusHistorySchema, 503: notYet },
      },
    },
    async (_req, reply) => {
      const h = await read.history();
      if (!h)
        return reply
          .code(503)
          .send({ message: 'ยังไม่มีประวัติ — worker ยังไม่ได้อ่านจาก Zabbix' });
      reply.header('Cache-Control', 'no-store');
      return h;
    },
  );
  r.get(
    '/status/unlocated',
    {
      schema: {
        tags: ['status'],
        summary: 'host ใน Zabbix ที่ไม่ตรงกับอุปกรณ์ในทะเบียน จึงไม่มีตำแหน่งในภาพ 3D',
        response: { 200: unlocatedListSchema, 503: notYet },
      },
    },
    async (_req, reply) => {
      const u = await read.unlocated();
      if (!u)
        return reply.code(503).send({ message: 'ยังไม่มีรายการ — worker ยังไม่ได้อ่านจาก Zabbix' });
      reply.header('Cache-Control', 'no-store');
      return u;
    },
  );
}
