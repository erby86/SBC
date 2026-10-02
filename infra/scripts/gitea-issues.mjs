#!/usr/bin/env node
// Creates milestones G0–G6, labels DEV/NET/FIELD/OWNER and one issue per module (M00–M38)
// from docs/baseline/modules-by-gate-v2.md (M01 v2, step 6). Idempotent: existing milestones,
// labels and issues (matched by "Mxx " title prefix) are left untouched.
//
//   node infra/scripts/gitea-issues.mjs                     # print the plan only (no token needed)
//   GITEA_TOKEN=... node infra/scripts/gitea-issues.mjs --apply
//
// Env: GITEA_URL (default http://git.sbc.lan), GITEA_REPO (default sbc/sbc-noc)
import { readFileSync } from 'node:fs';

const BASE = (process.env.GITEA_URL ?? 'http://git.sbc.lan').replace(/\/$/, '');
const REPO = process.env.GITEA_REPO ?? 'sbc/sbc-noc';
const TOKEN = process.env.GITEA_TOKEN;
const APPLY = process.argv.includes('--apply');
const DONE = new Set(['M00', 'M01']); // closed on creation (M00 passed 29 Sep 2026, M01 merged)
const LABELS = { DEV: '1d76db', NET: 'fbca04', FIELD: '0e8a16', OWNER: '5319e7' };

const doc = readFileSync(
  new URL('../../docs/baseline/modules-by-gate-v2.md', import.meta.url),
  'utf8',
);

/** Parses "### Gn title" sections and their "| Mxx | ..." table rows. */
function parseModules(text) {
  const gates = new Map();
  const modules = [];
  let gate = null;
  let header = [];
  for (const line of text.split('\n')) {
    const h = /^### (G\d) (.+)$/.exec(line);
    if (h) {
      gate = h[1];
      gates.set(gate, h[2].trim());
      continue;
    }
    if (!gate || !line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells[0] === 'รหัส') header = cells;
    if (!/^M\d{2}$/.test(cells[0] ?? '')) continue;
    const row = Object.fromEntries(header.map((k, i) => [k, cells[i] ?? '']));
    modules.push({
      code: cells[0],
      name: cells[1].replace(/`/g, ''),
      gate,
      owner: row['ผู้รับผิดชอบ'] ?? '',
      size: row['ขนาด'] ?? '',
      deps: row['ขึ้นกับ'] ?? '',
      deliver: row['ส่งมอบ'] ?? '',
      done: row['เสร็จเมื่อ'] ?? '',
    });
  }
  return { gates, modules };
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api/v1/repos/${REPO}${path}`, {
    method,
    headers: { Authorization: `token ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function listAll(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await api('GET', `${path}${sep}limit=50&page=${page}`);
    out.push(...batch);
    if (batch.length < 50) return out;
  }
}

const { gates, modules } = parseModules(doc);
console.log(`parsed ${gates.size} gates, ${modules.length} modules`);
if (modules.length !== 39) throw new Error(`expected 39 modules (M00–M38), got ${modules.length}`);

const body = (m) =>
  [
    `**Gate:** ${m.gate} ${gates.get(m.gate)}`,
    `**ผู้รับผิดชอบ:** ${m.owner} · **ขนาด:** ${m.size} · **ขึ้นกับ:** ${m.deps}`,
    '',
    `**ส่งมอบ:** ${m.deliver}`,
    '',
    `**เสร็จเมื่อ:** ${m.done || 'กำหนดเมื่อเริ่ม gate (G6)'}`,
    '',
    '_ที่มา: docs/baseline/modules-by-gate-v2.md_',
  ].join('\n');
const labelsOf = (m) => Object.keys(LABELS).filter((l) => m.owner.includes(l));

if (!APPLY) {
  for (const m of modules) {
    console.log(
      `${m.gate}  ${m.code} ${m.name}  [${labelsOf(m).join(',')}]${DONE.has(m.code) ? '  (closed)' : ''}`,
    );
  }
  console.log('\ndry run — add --apply with GITEA_TOKEN set to create them');
  process.exit(0);
}
if (!TOKEN) throw new Error('GITEA_TOKEN is not set');

const milestones = new Map((await listAll('/milestones?state=all')).map((m) => [m.title, m.id]));
for (const [g, title] of gates) {
  if (milestones.has(g)) continue;
  const created = await api('POST', '/milestones', { title: g, description: title });
  milestones.set(g, created.id);
  console.log(`milestone ${g} created`);
}

const labels = new Map((await listAll('/labels')).map((l) => [l.name, l.id]));
for (const [name, color] of Object.entries(LABELS)) {
  if (labels.has(name)) continue;
  const created = await api('POST', '/labels', { name, color: `#${color}` });
  labels.set(name, created.id);
  console.log(`label ${name} created`);
}

const existing = new Set(
  (await listAll('/issues?state=all&type=issues')).map((i) => i.title.split(' ')[0]),
);
for (const m of modules) {
  if (existing.has(m.code)) {
    console.log(`skip ${m.code} (exists)`);
    continue;
  }
  const issue = await api('POST', '/issues', {
    title: `${m.code} ${m.name}`,
    body: body(m),
    milestone: milestones.get(m.gate),
    labels: labelsOf(m).map((l) => labels.get(l)),
  });
  if (DONE.has(m.code)) await api('PATCH', `/issues/${issue.number}`, { state: 'closed' });
  console.log(`issue #${issue.number} ${m.code}${DONE.has(m.code) ? ' (closed)' : ''}`);
}
console.log('done');
