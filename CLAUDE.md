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
- ส่งงาน: Claude Code push ที่ GitHub `erby86/SBC` (branch ของ session นั้น) → ผู้ใช้ดึงเข้า Gitea + PR + อัปเดต dev ตาม `docs/runbooks/github-to-gitea.md` (ให้คำสั่งชุดนั้นเมื่อจบโมดูล)
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
- Zabbix 7.0.31 `http://zabbix.sbc.lan`; ผู้ใช้ API `noc-api-read` (กลุ่ม `noc-api`, Read เฉพาะ 01-/02-/03- กลุ่มเครือข่าย); token อยู่ใน `dev.env` (`ZABBIX_TOKEN_READ`); ผู้ใช้เขียน `noc-api-sync` (role Admin, RW เฉพาะกลุ่ม `99-NOC-Test`, host ทดสอบ `NOC-Test-CCR1036`) token `ZABBIX_TOKEN_SYNC`
- UniFi OS Server 5.1.42 (Network 10.6.106) บน Ubuntu `https://172.16.0.30:11443` (ใบรับรองออกเอง, 443/8443 ปิด); site ภายใน `02gt1bcf`; ผู้ใช้ View Only แบบ local ใน `dev.env` (`UNIFI_USERNAME`/`UNIFI_PASSWORD`)
- Omada 6.3.0.45 `https://192.168.1.118` (ใบรับรองออกเอง), site `SBC_Main`; Open API app `sbc-noc-read` (Client, Viewer) ค่าใน `dev.env` (`OMADA_*`)
- SBC ASSET = Google Sheet `SBC_ASSET_Field_Survey` (แท็บห้อง `08_ควบคุมการปิดพื้นที่`); NOC อ่านแท็บ `NOC_LOC_Export` ที่เผยแพร่เป็น CSV ลิงก์อยู่ใน `dev.env` (`SBC_ASSET_CSV_URL`)

## สถานะโมดูล

| โมดูล                        | สถานะ                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M00 ทดสอบต้นแบบ              | ผ่าน 29 ก.ย. 2026                                                                                                                                                                                                                                                                                                                                                                                                          |
| M01 monorepo + CI            | เสร็จ                                                                                                                                                                                                                                                                                                                                                                                                                      |
| M02 sbc-noc-db + backup      | เสร็จ 2026-10-02 — RESTORE TEST PASSED, ไม่เปิดพอร์ต, cron backup 02:30                                                                                                                                                                                                                                                                                                                                                    |
| M03 schema + migration       | เสร็จ 2026-10-02 — 61 ตาราง บน PostgreSQL 16, CI `db-integration` ผ่าน                                                                                                                                                                                                                                                                                                                                                     |
| งานก่อน M04                  | เสร็จ — issue M00–M38 ใน Gitea, access list `sbc-noc-mgmt` ยืนยันแล้ว (วง 192.168.1.x เข้าได้, วงอื่นได้ 403), ปิดพอร์ต 5190                                                                                                                                                                                                                                                                                               |
| M04 นำเข้าข้อมูลตั้งต้น      | เสร็จ 2026-10-02 — นำเข้าบน dev: 173 LOC (LOC-187, SPORT → LOC-188..191), อุปกรณ์ 50, ไฟเบอร์ FO-\* 8 เส้น; CI นำเข้า 2 รอบ รอบสองเขียน 0 แถว                                                                                                                                                                                                                                                                              |
| M09 worker + คิวงาน          | เสร็จ 2026-10-02 — dev: `registry-stats` success; CI: รันตามเวลา + ล้มแล้วลองใหม่ผ่าน                                                                                                                                                                                                                                                                                                                                      |
| M07 รายงานตรวจความครบ        | โค้ดเสร็จ + ใช้บน dev — error 47 = not_in_zabbix ทั้งหมด (ปิดใน M08); AP ตัวอย่าง `ap-ba-2-1` soft delete แล้ว                                                                                                                                                                                                                                                                                                             |
| M12 ผู้ใช้ API Zabbix        | บางส่วน — `noc-api-read` + token ใช้ได้ (อ่านอย่างเดียว, เห็นเฉพาะกลุ่มเครือข่าย); discovery ห้องคอมฯ เลื่อน, ผู้ใช้รับเรื่องไป M24                                                                                                                                                                                                                                                                                        |
| M08 Zabbix tag + จับคู่ host | dev พิสูจน์แล้ว: จับคู่ 5/8 host; เขียน tag ลง host ทดสอบ `NOC-Test-CCR1036` ถูกต้อง (ADR-0019); tag ครบ 100% บน host จริง → M17                                                                                                                                                                                                                                                                                           |
| M06 นำเข้า AP (UniFi)        | UniFi ใช้บน dev แล้ว 2026-10-03 — AP 80: ในทะเบียน 58 (ชื่อ 44 + สวิตช์ประจำชั้น 14), 22 รอตั้งชื่อใน UniFi (Mesh ICET1 12, Canteen, ITB, LRA อาคาร A 8); Omada ใช้บน dev แล้ว (24 AP อาคาร 1/2 รอตั้งชื่อชั้นใน Omada); LINK เลื่อนไปหลังสุด (`http://172.17.0.50/`, ระวังชนวง docker0)                                                                                                                                   |
| M05 ซิงก์ LOC (SBC ASSET)    | เสร็จ 2026-10-03 — dev: อ่าน 172 แถวจาก CSV `NOC_LOC_Export`, ตรงกับฐาน (สร้าง 0, ขัดแย้ง 0, หาย 0); ห้องใหม่/ขัดแย้งพิสูจน์ใน test                                                                                                                                                                                                                                                                                        |
| M13 API พื้นฐาน              | เสร็จ 2026-10-03 — CI build image ผ่าน; dev: `/api/health` ตอบ, `/api/docs/` เปิดได้, `/api/metrics` มีค่า; zod + OpenAPI, log pino                                                                                                                                                                                                                                                                                        |
| M14 API ทะเบียนและผัง        | เสร็จ 2026-10-03 — dev: `/api/registry/layout` อาคาร 8, ห้อง 173, อุปกรณ์ 109, ลิงก์ 35, สาย 8; ETag → 304; ค้นหา IP/ชื่อเรียกถูก; schema กลาง `packages/shared/src/registry.ts`                                                                                                                                                                                                                                           |
| M38 โหมดสาธิต + ชุดทดสอบ     | ส่วนข้อมูลเสร็จ 2026-10-03 — dev: `/api/demo/*` 4 สถานการณ์ได้ผลตรงที่คาด (mixed ล่ม2/เตือน2/บำรุง1, s8down เหตุเดียว impacted 4, stale ค้าง, normal ว่าง); กฎ `computeStatus` ใน `packages/shared` (M15 ต้องผ่าน); ป้ายบนหน้าจอ: ทำแล้วใน M20                                                                                                                                                                             |
| M15 เครื่องคำนวณสถานะ        | เสร็จ 2026-10-03 — ปิด worker 150 s → `stale True`, เปิดใหม่ → `False`; Zabbix problem 5 = เหตุ 4 (m-s8 ล่ม 2 ปัญหา กระทบ 3, เตือน m-b1/mainB/m-i1) ครบทุกตัว; role `noc-api-read` เพิ่ม problem.get/trigger.get/maintenance.get แล้ว; ผ่าน 4 สถานการณ์ M38                                                                                                                                                                |
| M16 ข้อมูลสด WebSocket       | เสร็จ 2026-10-03 — ผู้ใช้ยืนยันบน dev; `/api/status/ws` (snapshot + delta จาก Redis `status:updates`), fallback ดึงทุก 30 s, หน้าทดสอบบนหน้าแรก, NPM เปิด Websockets Support                                                                                                                                                                                                                                               |
| M18 โครงหน้าเว็บ             | เสร็จ 2026-10-03 — dev: หน้าผังแสดงอาคาร 8 (จำนวนอุปกรณ์จริง), เหตุ 4 จาก Zabbix, ชิปสถานะ, เวลาอัปเดต; 3 ขนาดจอตรวจด้วย Chromium; ฟอนต์ไทยในเครื่อง; `/admin` หลังบ้าน                                                                                                                                                                                                                                                    |
| M21 หน้าจัดการทะเบียน        | เสร็จ 2026-10-03 (ผู้ใช้ยืนยันบน dev, ADR-0020) — `/admin`: อุปกรณ์ ห้อง AP รอตำแหน่ง ประวัติ; ตรวจก่อนบันทึก (IP ซ้ำ, วงวน uplink, ห้อง/ชั้น), row_version, ผู้แก้ + IP ใน audit; API `/api/registry/edit/*` เฉพาะ `REGISTRY_EDIT=true` (dev)                                                                                                                                                                             |
| M19 ฉาก 3D                   | เสร็จ 2026-10-03 (ผู้ใช้ยืนยันบน dev) — ฉาก three.js แยกจาก React อ่านผังจาก API; จอทีวี 44 fps; ตำแหน่งอุปกรณ์ 45 + เส้นทางสาย 12 จากต้นแบบ (`infra/seed/prototype-routes.json`, `routes-cli` เขียนเฉพาะที่ว่าง) — dev เขียนครบ 45/12, ภาพตรงต้นแบบ; PR #69                                                                                                                                                               |
| M20 แผงแจ้งเตือน/ค้นหา/ทีวี  | เสร็จ 2026-10-05 (ผู้ใช้ยืนยันบน dev) — ค้นหาแบบรายการ + ไฮไลต์, ประวัติ 24 ชม. (`event.get` + เหตุที่ยังเปิดจาก `problem.get` → Redis `status:history`), ไม่มีตำแหน่ง (`status:unlocated`; dev จับคู่ครบ 8/8 จึงว่าง), บำรุงรักษาใน snapshot, ห้องคอมฯ, วิธีใช้ + แนะนำครั้งแรก, โหมดทีวี `/?tv`, โหมดสาธิต `/?demo=` แถบ/กรอบเหลือง; role `noc-api-read` มี `event.get` แล้ว                                             |
| M22 E2E + UAT                | เสร็จ 2026-10-05 — UAT ผ่าน, จอทีวี 44 fps, **G4 ปิด**; ปุ่ม Zabbix (Grafana/GLPI รอ URL) จาก `LINK_*_URL` (`/api/config/links`, ค่าว่าง = ไม่มีปุ่ม); Playwright `tests/e2e` 3 ขนาด × 7 หน้า ไม่มีข้อความเลยขอบ, CI job `e2e` (artifact `e2e-shots`); ภาพแตกครั้งเดียวบนทีวี หายเอง ถ้าซ้ำดู bloom                                                                                                                        |
| UI audit                     | 2026-10-05 — contrast AA (token `--*-ink`, `--link`), ตัวอักษร ≥ 12 px, ปุ่มจอสัมผัส ≥ 44 px; `docs/reviews/ui-audit-2026-10-05.md`                                                                                                                                                                                                                                                                                        |
| M17 deploy + ความปลอดภัย     | เสร็จ 2026-10-05 — **G3 ปิด**: prod `0.1.0-a87498f` บน `noc.sbc.lan` (health 200, CSP, demo 404, stale ≤ 30 s, ไม่มีพอร์ตเปิดตรง, วงอื่น 403, log ใน Loki `sbc-loki`/`sbc-net`, Zabbix web scenario `NOC health`); staging ผ่าน Trivy + rate limit; runtime ลบ npm/corepack + OS upgrade; clone เซิร์ฟเวอร์เป็น 600 → web `RUN chmod`; ห้ามรันข้อ 3 (สร้าง `prod.env`) ซ้ำ                                                 |
| UI ลูกเล่น                   | 2026-10-05 — วงแหวนสุขภาพ (% ใช้งานได้), การ์ดเด้งเหตุใหม่/แย่ลง/กลับปกติ (`shell/events.ts`, `feed.tsx`), ป้าย "ใหม่" 1 นาที, เวลานับเอง, สรุปล่ม/เตือน + ปุ่มเหตุถัดไป, แป้นลัด N 1–9 H T E L F; หยุดเคลื่อนไหวในโหมดประหยัด/ลดการเคลื่อนไหว; e2e 27/27; แถบบนใหม่ (โลโก้, ปุ่มไอคอนเป็นกลุ่ม `shell/icons.tsx`), ฟอนต์ Noto Sans Thai + Chakra Petch (หัวข้อ/ตัวเลข), `color-scheme` ตามธีม → dropdown สลับมืด/สว่างได้ |
| ถัดไป                        | prod ประกาศใช้หลัง G1–G2 ปิด (ADR-0021/0022) · ผู้ใช้: M10/M11 Zabbix, tag host จริง (M17 ข้อ 9 หลัง G2), วาง AP ที่เหลือใน `/admin/unplaced`; LINK หลังสุด · โมดูลถัดไป: M35 เฝ้าตัวเอง (รอผู้ใช้ยืนยัน)                                                                                                                                                                                                                  |
