# CLAUDE.md — บริบทสำหรับ Claude Code ทุก session

อ่านไฟล์นี้ก่อนเริ่มงานทุกครั้ง แล้วอัปเดตส่วน "สถานะโมดูล" ทุกครั้งที่ปิดโมดูล

## ระบบนี้คืออะไร

sbc-noc — ระบบ NOC ผังเครือข่าย 3 มิติของโรงเรียน SB School ใช้งานเฉพาะใน LAN (`*.sbc.lan`)

- สถาปัตยกรรม: `docs/architecture.md`
- baseline และแผน: `docs/baseline/` (baseline-v8, schema-design-v1.2, modules-by-gate-v2, kickoff-plan-v2) — **แหล่งอ้างอิงหลัก ถ้าขัดกับที่อื่นให้ยึดเอกสารนี้แล้วแจ้งผู้ใช้**
- การตัดสินใจ: `docs/adr/` · เอกสารต่อโมดูล: `docs/modules/Mxx.md`
- ต้นแบบหน้าจอ: `docs/prototype/sb-noc-3d-baseline-v3.html` (อ้างอิงสำหรับ M18–M20)
- schema ต้นฉบับ: `packages/db/reference/schema-v1.1.sql`

## วิธีทำงาน

- ทำทีละโมดูลตาม `docs/baseline/modules-by-gate-v2.md` ตรวจขอบเขตและเงื่อนไข "เสร็จเมื่อ" ของโมดูลก่อนเริ่มเสมอ
- จบโมดูล: รายงานผลตามเงื่อนไขเสร็จ อัปเดต `docs/modules/Mxx.md` และไฟล์นี้ แล้ว**รอผู้ใช้ยืนยันก่อนเริ่มโมดูลถัดไป**
- branch: `module/Mxx-ชื่อ`; commit แบบ Conventional Commits (`CONTRIBUTING.md`); main ป้องกันไว้ ต้องผ่าน PR + CI
- สื่อสารกับผู้ใช้เป็นภาษาไทย; โค้ด ชื่อไฟล์ commit เป็นภาษาอังกฤษ
- ผู้ใช้ (STF-01) ทำทุกบทบาท ให้คำสั่งบนเซิร์ฟเวอร์ทีละขั้น คัดวางได้ทั้งก้อน และบอกผลที่ควรเห็น

## กติกาที่ห้ามละเมิด

- ทิศทางการเรียกใช้: `apps/web` → `packages/shared`, `packages/ui` เท่านั้น · `apps/api`, `apps/worker` → `packages/db`, `packages/shared` · `packages/*` ห้ามเรียก `apps/*` (dependency-cruiser ใน CI)
- ไม่มี secret ใน repo หรือฐานข้อมูล (ฐานเก็บแค่ `secret_ref`) — ADR-0005
- ห้ามแตะ container/ระบบอื่นบน sbc-ubuntu (Portal, Zabbix, sbc-redis, sbc-npm ฯลฯ) และห้ามแก้ config ของ act_runner เอง — เตรียมคำสั่งแล้วขออนุญาตก่อน
- เปลี่ยนโครงชั้นบนของ repo ต้องมี ADR (ADR-0009)
- migration ที่ apply แล้วห้ามแก้ เพิ่มไฟล์ใหม่ (ADR-0018)
- ขั้นไหนล้ม หยุดและรายงานพร้อม error อย่าเดาทางแก้ที่กระทบระบบอื่น

## คำสั่งหลัก

```bash
pnpm install
pnpm lint && pnpm depcruise && pnpm typecheck && pnpm test && pnpm build
pnpm format:check
TEST_DATABASE_URL=postgres://.../ฐานว่าง pnpm --filter @sbc-noc/db test   # schema บน PostgreSQL 16 จริง
```

## สภาพแวดล้อมจริง (ยืนยันแล้ว 2026-10-02)

- Gitea `http://git.sbc.lan` (= 192.168.1.6:3000) repo `sbc/sbc-noc`; runner `sbc-main-runner` (container `sbc-gitea-runner`, ใช้ร่วมกับ Portal) label `ubuntu-latest` แบบ docker, capacity 2
- dev stack บน sbc-ubuntu: `/opt/sbc-noc/src` (clone), env `/opt/sbc-noc/dev.env` (600), compose `infra/compose/compose.dev.yml`, เว็บ `http://noc-dev.sbc.lan` (NPM → `sbc-noc-dev-web:80` บน network ของ NPM, access list `sbc-noc-mgmt` = 192.168.1.0/24, ไม่เปิดพอร์ตตรง)
- `sbc-redis` อยู่ network `db-net` ต้องใช้รหัสผ่าน; dev ใช้ prefix `noc:dev:`
- DNS `*.sbc.lan` → 192.168.1.6 บน MikroTik
- Renovate รันทุกจันทร์ 05:00 ด้วยบัญชี `renovate-bot`

## สถานะโมดูล

| โมดูล                   | สถานะ                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| M00 ทดสอบต้นแบบ         | ผ่าน 29 ก.ย. 2026                                                                                         |
| M01 monorepo + CI       | เสร็จ                                                                                                     |
| M02 sbc-noc-db + backup | เสร็จ 2026-10-02 — RESTORE TEST PASSED, ไม่เปิดพอร์ต, cron backup 02:30                                   |
| M03 schema + migration  | เสร็จ 2026-10-02 — 61 ตาราง บน PostgreSQL 16, CI `db-integration` ผ่าน                                    |
| ค้าง                    | สร้าง issue ใน Gitea (`infra/scripts/gitea-issues.mjs`), access list NPM ของ `noc-dev.sbc.lan` (ก่อน M04) |
| ถัดไป                   | M04 นำเข้าข้อมูลตั้งต้น, M09 worker + คิวงาน — รอผู้ใช้ยืนยัน                                             |
