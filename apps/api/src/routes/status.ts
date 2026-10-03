// M15: the latest status snapshot written by the worker's status engine. Freshness is checked here
// too, so a dead worker shows up as stale even though the stored snapshot says otherwise.
import { STALE_AFTER_MS, statusSnapshotSchema, type StatusSnapshot } from '@sbc-noc/shared';
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
