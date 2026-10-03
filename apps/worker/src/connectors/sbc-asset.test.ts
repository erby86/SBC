import { describe, expect, it } from 'vitest';
import { createSbcAssetClient, parseAssetCsv } from './sbc-asset.js';

const CSV =
  '\uFEFFbuilding,floor,room,loc,registry,found\r\n' +
  'อาคาร 1,▶ ชั้น 1,ห้องครูตุ๊ก,LOC-001,3,0\r\n' +
  '"อาคารกีฬา 4 ชั้น",▶ ชั้น 2,"Walkthrough, ชั้น 2",sport-02,0,0\r\n' +
  ',,,,,\r\n';

describe('parseAssetCsv', () => {
  it('reads the NOC_LOC_Export columns', () => {
    expect(parseAssetCsv(CSV)).toEqual([
      { building: 'อาคาร 1', floor: 1, room: 'ห้องครูตุ๊ก', loc: 'LOC-001', registry: 3 },
      {
        building: 'อาคารกีฬา 4 ชั้น',
        floor: 2,
        room: 'Walkthrough, ชั้น 2',
        loc: 'SPORT-02',
        registry: 0,
      },
    ]);
  });

  it('rejects an export without the expected columns (e.g. a login page)', () => {
    expect(() => parseAssetCsv('<html>sign in</html>\n')).toThrow('missing');
  });

  it('fetches the published CSV', async () => {
    const client = createSbcAssetClient('https://x/pub?output=csv', async () => new Response(CSV));
    expect(await client.locations()).toHaveLength(2);
  });
});
