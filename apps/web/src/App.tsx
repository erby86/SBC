import { BUILDING_CODES, healthResponseSchema } from '@sbc-noc/shared';
import { useEffect, useState } from 'react';
import { LiveStatus } from './LiveStatus.js';
import { RegistryChecks } from './RegistryChecks.js';

export const SYSTEM_NAME = 'SBC NOC';

type ApiStatus = { state: 'loading' } | { state: 'ok'; version: string } | { state: 'offline' };

export function App() {
  const [api, setApi] = useState<ApiStatus>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((res) => res.json())
      .then((body: unknown) => {
        const health = healthResponseSchema.parse(body);
        if (!cancelled) setApi({ state: 'ok', version: health.version });
      })
      .catch(() => {
        if (!cancelled) setApi({ state: 'offline' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>{SYSTEM_NAME}</h1>
      <p>ผังเครือข่าย 3 มิติ SB School — {BUILDING_CODES.length} อาคาร</p>
      <p data-testid="api-status">
        API:{' '}
        {api.state === 'loading'
          ? 'กำลังตรวจสอบ…'
          : api.state === 'ok'
            ? `ออนไลน์ (v${api.version})`
            : 'ออฟไลน์'}
      </p>
      <LiveStatus
        wsUrl={`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/status/ws`}
      />
      <RegistryChecks />
    </main>
  );
}
