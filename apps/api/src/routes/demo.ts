// M38 demo mode (ADR-0014): replays the prototype scenarios through the shared status rules.
// Registered only when DEMO_MODE=true (dev/staging); every response is labelled as demo data so it
// can never pass for the real network state. Admin-only access in prod arrives with login (G5).
import {
  computeStatus,
  DEMO_LABEL,
  DEMO_SCENARIOS,
  DEMO_TOPOLOGY,
  findScenario,
  scenarioInput,
  statusHistorySchema,
  statusSnapshotSchema,
  unlocatedListSchema,
} from '@sbc-noc/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const meta = z.object({ name: z.string(), title: z.string(), description: z.string() });
const demoFlag = { demo: z.literal(true), label: z.string() };

export function demoRoutes(app: FastifyInstance, now: () => Date = () => new Date()): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['demo'];

  r.get(
    '/demo/scenarios',
    {
      schema: {
        tags,
        summary: 'สถานการณ์สาธิต (เฉพาะ dev/staging)',
        response: { 200: z.object({ ...demoFlag, scenarios: z.array(meta) }) },
      },
    },
    async () => ({
      demo: true as const,
      label: DEMO_LABEL,
      scenarios: DEMO_SCENARIOS.map(({ name, title, description }) => ({
        name,
        title,
        description,
      })),
    }),
  );

  r.get(
    '/demo/scenarios/:name',
    {
      schema: {
        tags,
        summary: 'สถานะของสถานการณ์สาธิต ณ ตอนนี้ (คำนวณด้วยกฎเดียวกับของจริง)',
        params: z.object({ name: z.string() }),
        response: {
          200: z.object({
            ...demoFlag,
            scenario: meta,
            snapshot: statusSnapshotSchema,
            // same shapes as /status/history and /status/unlocated, so the screen shows both alike
            unlocated: unlocatedListSchema,
            history: statusHistorySchema,
          }),
          404: z.object({ message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const s = findScenario(req.params.name);
      if (!s) return reply.code(404).send({ message: `ไม่มีสถานการณ์ ${req.params.name}` });
      const at = now();
      const ago = (min: number) => new Date(at.getTime() - min * 60_000).toISOString();
      return {
        demo: true as const,
        label: DEMO_LABEL,
        scenario: { name: s.name, title: s.title, description: s.description },
        snapshot: computeStatus(DEMO_TOPOLOGY, scenarioInput(s, at), at),
        unlocated: {
          updatedAt: at.toISOString(),
          hosts: s.unlocated.map((u) => ({
            hostid: u.name,
            name: u.name,
            ip: u.ip,
            groups: [u.group],
            state: u.state,
          })),
        },
        history: {
          updatedAt: at.toISOString(),
          hours: 24,
          // open problems first (still going), then the resolved ones, newest first
          events: [
            ...s.signals.map((x) => ({
              device: x.device,
              host: x.device,
              severity: x.severity,
              start: ago(x.sinceMin),
              end: null,
              message: x.message,
            })),
            ...s.history.map((h) => ({
              device: h.device,
              host: h.device,
              severity: h.severity,
              start: ago(h.startMin),
              end: ago(h.endMin),
              message: h.message,
            })),
          ].sort((x, y) => Date.parse(y.start) - Date.parse(x.start)),
        },
      };
    },
  );
}
