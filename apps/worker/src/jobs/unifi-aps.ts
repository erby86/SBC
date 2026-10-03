// M06 (UniFi): UniFi devices → controller-aps (type uap = access point).
import type { UnifiClient } from '../connectors/unifi.js';
import { controllerApsJob } from './controller-aps.js';
import type { JobDefinition } from './types.js';

export { apCode, parseApName, placeAp } from './ap-placement.js';

/** Registry code of the controller APs are managed_by. Moving to the UDM Pro Max: set it to `udm`. */
export const DEFAULT_CONTROLLER_CODE = 'ctl-unifi';

export function unifiApsJob(
  unifi: UnifiClient,
  controller: { name: string; ip: string | null; code?: string },
): JobDefinition {
  return controllerApsJob({
    name: 'unifi-aps',
    system: 'unifi',
    label: 'UniFi',
    configHint: 'UNIFI_URL / UNIFI_SITE',
    controller: { ...controller, code: controller.code || DEFAULT_CONTROLLER_CODE },
    async devices() {
      return (await unifi.devices()).map((d) => ({
        mac: d.mac,
        name: d.name,
        model: d.model,
        isAp: d.type === 'uap',
        ip: d.ip,
        version: d.version,
        online: d.state === 1,
        uplinkMac: d.uplinkMac,
        uplinkPort: d.uplinkPort,
      }));
    },
  });
}
