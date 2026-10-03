// M06 (Omada): Omada devices → controller-aps (type ap = access point).
import type { OmadaClient } from '../connectors/omada.js';
import { controllerApsJob } from './controller-aps.js';
import type { JobDefinition } from './types.js';

export const DEFAULT_OMADA_CONTROLLER_CODE = 'ctl-omada';

export function omadaApsJob(
  omada: OmadaClient,
  controller: { name: string; ip: string | null; code?: string },
): JobDefinition {
  return controllerApsJob({
    name: 'omada-aps',
    system: 'omada',
    label: 'Omada',
    configHint: 'OMADA_URL / OMADA_SITE',
    controller: { ...controller, code: controller.code || DEFAULT_OMADA_CONTROLLER_CODE },
    async devices() {
      return (await omada.devices()).map((d) => ({
        mac: d.mac,
        name: d.name,
        model: d.model,
        isAp: d.type === 'ap',
        ip: d.ip,
        version: d.version,
        online: d.status === 1,
        uplinkMac: d.uplinkMac,
        uplinkPort: d.uplinkPort,
      }));
    },
  });
}
