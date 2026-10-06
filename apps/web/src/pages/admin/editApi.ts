// M21 back-office data access. The session cookie (M23) says who is editing; calls fail with the
// api's { message, field } so forms can point at the wrong field.
import {
  deviceEditSchema,
  editErrorSchema,
  editOptionsSchema,
  historyEntrySchema,
  locationEditSchema,
  locationSchema,
  deviceSchema,
  unplacedApSchema,
  type DeviceEdit,
  type LocationEdit,
} from '@sbc-noc/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

export class EditError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
  }
}

let unauthorized: (() => void) | null = null;

/** Called when the api answers 401 (session expired or account disabled); returns an unsubscribe. */
export function onUnauthorized(fn: () => void): () => void {
  unauthorized = fn;
  return () => {
    if (unauthorized === fn) unauthorized = null;
  };
}

async function call<T>(
  method: string,
  url: string,
  parse: (v: unknown) => T,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return parse(null);
  if (res.status === 401) unauthorized?.();
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = editErrorSchema.safeParse(json);
    throw new EditError(
      res.status,
      e.success ? e.data.message : `HTTP ${res.status}`,
      e.success ? e.data.field : undefined,
    );
  }
  return parse(json);
}

export const api = {
  options: () => call('GET', '/api/registry/edit/options', (v) => editOptionsSchema.parse(v)),
  device: (code: string) =>
    call('GET', `/api/registry/edit/devices/${encodeURIComponent(code)}`, (v) =>
      deviceEditSchema.parse(v),
    ),
  updateDevice: (code: string, patch: Partial<DeviceEdit> & { rowVersion: number }) =>
    call(
      'PATCH',
      `/api/registry/edit/devices/${encodeURIComponent(code)}`,
      (v) => deviceEditSchema.parse(v),
      patch,
    ),
  createDevice: (input: object) =>
    call('POST', '/api/registry/edit/devices', (v) => deviceEditSchema.parse(v), input),
  deleteDevice: (code: string, rowVersion: number) =>
    call(
      'DELETE',
      `/api/registry/edit/devices/${encodeURIComponent(code)}?rowVersion=${rowVersion}`,
      () => null,
    ),
  location: (loc: string) =>
    call('GET', `/api/registry/edit/locations/${loc}`, (v) => locationEditSchema.parse(v)),
  updateLocation: (loc: string, patch: Partial<LocationEdit> & { rowVersion: number }) =>
    call('PATCH', `/api/registry/edit/locations/${loc}`, (v) => locationEditSchema.parse(v), patch),
  createLocation: (input: object) =>
    call('POST', '/api/registry/edit/locations', (v) => locationEditSchema.parse(v), input),
  unplaced: () =>
    call('GET', '/api/registry/edit/unplaced', (v) => z.array(unplacedApSchema).parse(v)),
  placeAp: (system: string, mac: string, where: object) =>
    call(
      'POST',
      `/api/registry/edit/unplaced/${system}/${encodeURIComponent(mac)}`,
      (v) => deviceEditSchema.parse(v),
      where,
    ),
  history: (kind: 'device' | 'location', code: string) =>
    call('GET', `/api/registry/edit/history/${kind}/${encodeURIComponent(code)}`, (v) =>
      z.array(historyEntrySchema).parse(v),
    ),
  devices: () => call('GET', '/api/registry/devices', (v) => z.array(deviceSchema).parse(v)),
  locations: (building?: string, floor?: number | null) =>
    call(
      'GET',
      `/api/registry/locations?${new URLSearchParams({
        ...(building ? { building } : {}),
        ...(floor !== null && floor !== undefined ? { floor: String(floor) } : {}),
      }).toString()}`,
      (v) => z.array(locationSchema).parse(v),
    ),
};

export const useOptions = () =>
  useQuery({ queryKey: ['edit-options'], queryFn: api.options, staleTime: 5 * 60_000 });
export const useDevices = () => useQuery({ queryKey: ['devices'], queryFn: api.devices });
export const useRooms = (building?: string, floor?: number | null) =>
  useQuery({
    queryKey: ['rooms', building ?? '', floor ?? ''],
    queryFn: () => api.locations(building, floor),
  });
