// Zabbix problem names in plain Thai for school staff ("TP-LINK: Unavailable by ping" →
// "ติดต่ออุปกรณ์ไม่ได้ (ไม่ตอบ ping)"). Only English messages are translated; Thai text (demo,
// hand-written triggers) is shown as is. The original stays available as a tooltip.

const RULES: [RegExp, string][] = [
  [
    /unavailable by (icmp )?ping|no ping|icmp.*(unreachable|down)/i,
    'ติดต่ออุปกรณ์ไม่ได้ (ไม่ตอบ ping)',
  ],
  [/(high )?(icmp )?ping loss|packet loss/i, 'สัญญาณขาดหายบางส่วน (packet loss)'],
  [/(high )?(icmp )?ping (response time|latency)|high latency/i, 'ตอบสนองช้า (ping สูง)'],
  [/no snmp data|snmp.*(no data|unavailable|not available)/i, 'ไม่ได้รับข้อมูลสถิติ (SNMP)'],
  [/link down/i, 'พอร์ตเชื่อมต่อหลุด'],
  [/(high )?bandwidth|(inbound|outbound) .*(high|exceed)/i, 'ใช้แบนด์วิดท์สูง'],
  [/(high )?cpu/i, 'CPU ทำงานหนัก'],
  [/(high )?memory|ram utili[sz]ation/i, 'หน่วยความจำใกล้เต็ม'],
  [/restarted|uptime/i, 'อุปกรณ์เพิ่งรีสตาร์ต'],
  [/temperature/i, 'อุณหภูมิสูง'],
  [/\bfan\b/i, 'พัดลมมีปัญหา'],
  [/power supply|\bpsu\b/i, 'แหล่งจ่ายไฟมีปัญหา'],
  [/duplex/i, 'การตั้งค่าพอร์ตไม่ตรงกัน (duplex)'],
  [/(errors?|discards?) on interface|interface .*errors?/i, 'พอร์ตมีข้อมูลเสียหาย'],
];

const THAI = /[฀-๿]/;

/** Plain-Thai text for a Zabbix message; unknown or Thai messages come back unchanged. */
export function plainMessage(msg: string): string {
  // "(+1 ปัญหา)" added by the status engine stays at the end
  const extra = /\s*(\(\+\d+ ปัญหา\))\s*$/.exec(msg);
  const core = extra ? msg.slice(0, extra.index) : msg;
  if (THAI.test(core)) return msg;
  const body = core.replace(/^[^:]{1,40}:\s*/, ''); // "TP-LINK: ..." vendor/template prefix
  // numbers that matter to the reader (4%, 38 ms) stay with the translation
  const num = /\d+(?:\.\d+)?\s?(?:%|ms\b)/.exec(body)?.[0];
  for (const [re, out] of RULES)
    if (re.test(body)) return `${out}${num ? ` ${num}` : ''}${extra ? ` ${extra[1]}` : ''}`;
  return msg;
}
