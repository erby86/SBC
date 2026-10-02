import { BUILDING_CODES } from '@sbc-noc/shared';

export const SYSTEM_NAME = 'SBC NOC';

export function App() {
  return (
    <main>
      <h1>{SYSTEM_NAME}</h1>
      <p>ผังเครือข่าย 3 มิติ SB School — {BUILDING_CODES.length} อาคาร</p>
    </main>
  );
}
