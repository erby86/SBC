# UI ลูกเล่น รอบ 2 — แนว HUD โทนทางการ (เอกสารต่องาน)

สถานะ 2026-10-07: **เสร็จ — ผู้ใช้ยืนยันบน dev** (main `1c01268`, PR #109 `module/ui-modern`); เรื่องที่ยังต้องตัดสินอยู่ในหัวข้อด้านล่าง

## แบบอ้างอิง

Design canvas (artifact ส่วนตัวของผู้ใช้): https://claude.ai/artifact/Eja9nkz4k5Pru8qZjud5Xf
อ่านด้วย Artifact tool `action: read` + `path` (เช่น `project/Cyber.dc.html`, `project/Standard.dc.html`) อย่า web-fetch

- `Cyber.dc.html` คอนโซลหลักที่ผู้ใช้เลือก (`scenario` mixed|storm|stale) · `Standard.dc.html` มาตรฐานสี/การเคลื่อนไหว/ขนาด — ยึดอันนี้
- `Main.dc.html` แนวเก่า ไม่ใช้

## ทำแล้ว (commit)

| ข้อ | เรื่อง                                                                              | commit               | ที่อยู่หลัก                                                           |
| --- | ----------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------- |
| 1–3 | สีชุดใหม่ + IBM Plex Mono, แผงตัดมุม, แถบข้อมูลไม่สด 3 สาเหตุ                       | `9914cd5`            | `packages/ui/src/tokens.css`, `shell/stale.tsx`                       |
| —   | "วิธีใช้" เป็น modal มีฉากหลัง (เมนูทับไม่ได้)                                      | `21749ca`            | `shell/Help.tsx`, `.helpScrim`                                        |
| 4   | รวมเหตุตามต้นเหตุ (`root` ใน incident), การ์ดต้นเหตุ, ตึก/ไฟเบอร์ดับตามเป็นเทา      | `1632bb1`            | `packages/shared/src/status.ts`, `shell/console.ts`, `panels.tsx`     |
| 5   | บันทึกเหตุการณ์แบบ syslog ใต้ผัง (แทนแถบ 24 ชม.)                                    | `ae47ea3`            | `shell/evlog.tsx`, `logLines`                                         |
| 6   | ป้ายบนผังหลบกัน + มุมบ้านพอดีกรอบ                                                   | `9b4b3ea`            | `scene/labels.ts` (`placeTags`), `NocScene.homeView`                  |
| 7   | "เส้นทางจาก core" ในการ์ดแรก                                                        | `e261e86`            | `tracePath` ใน `shell/console.ts`                                     |
| 8   | การเคลื่อนไหวตามมาตรฐาน                                                             | `581ef61`            | `MOTION` ใน `NocScene.ts`, `--t-in/--t-out/--t-press` ใน tokens.css   |
| 9   | e2e `02b-storm`, `02c-stale` + demo `storm` (M38)                                   | `4e12e8f`, `1632bb1` | `tests/e2e/specs/screens.spec.ts`, `packages/shared/src/demo/`        |
| —   | ภาพ 3D ชัด: MSAA 4x ใน composer, มุมบ้านพอดีเฉพาะตึก, ประหยัดอัตโนมัติไม่จำข้ามหน้า | `208146f` + ถัดไป    | `NocScene` (`homeView`, `watchFps`), `shell/Scene3D.tsx` `noc-eco-v2` |

รายละเอียดกติกาแต่ละข้ออยู่ในแถว "UI ลูกเล่น รอบ 2" ของ `CLAUDE.md` และ commit message

### Modern pass (2026-10-07)

- ≥1180: หัวผัง (ชื่อ + ปุ่มบ้าน) ลอยบนฉาก ไม่กินแถว · 1180–1500: คอลัมน์ซ้าย 11.5–13.5rem ขวา 18–21rem · จอเตี้ย
  (≤820 px) log เหลือ 3 บรรทัด → ฉากที่ 1351×627 จาก 792×343 เป็น 846×417
- ฉาก: เส้นชั้น 0.5→0.3, เส้นกระจก 0.12→0.05, ตารางพื้น 0.35→0.2; ตึกที่เลือกเส้นชั้น 0.6 (`FOCUS_FLOOR`)
- sidebar แน่นขึ้น, การ์ดเตือนสีอ่อน, ตัวเลขเวลา/จำนวน `tabular-nums` · CSS ทั้งหมดอยู่ท้าย `shell.css` ("modern pass")

## ตรวจแล้วในเครื่อง cloud

lint, depcruise, typecheck, test, format ผ่านทั้ง repo · e2e 30 passed / 9 skipped (หลังบ้านไม่มีบัญชี e2e, ทีวี) / 0 failed

## รอผู้ใช้ดูบน dev

1. `/?demo=storm`: การ์ดต้นเหตุ + เส้นทาง, ตึกเทาเส้นประ "ดับตาม N", ป้ายไม่ซ้อน
2. แพ็กเก็ตวิ่งพร้อมกันทุก 2.4 วิ (ยืนยันด้วยตาจากเครื่อง cloud ไม่ได้)
3. `/?demo=stale`: ทั้งจอนิ่ง สีเทา
4. จอทีวี `/?tv`: fps ยังราว 44 ไหม

## เรื่องที่ตัดสินแล้ว (2026-10-07 ผู้ใช้ให้ทำตามที่แนะนำ)

- ทีวีไม่วนเหตุทุก 10 วิแล้ว: เข้าโหมดทีวี → ทั้งโรงเรียนแล้วนิ่ง กล้องขยับเฉพาะตอนคนกด (`shell/tv.ts`); เสียงเตือนเหตุล่มใหม่คงเดิม
- ปิดเมนู/วิธีใช้/กล่องยืนยันหลังบ้าน จางออก `--t-out` 0.3 วิ (`shell/leaving.tsx` `Leaving`: ระหว่างจาง inert + aria-hidden;
  ไม่มี Web Animations หรือ reduced motion → ปิดทันที)
- "+N ตัว" ใน log นับแบบการ์ดต้นเหตุ (`logLines(…, outOf)` ← `rootGroup`; storm = +21) — e2e `02b-storm` ตรวจ
- ป้ายพื้นที่โล่ง (โดม สนาม สระ สนามเด็กเล่น, class `area`) ซ่อนตอนมุมบ้าน ขึ้นเมื่อขยับกล้อง

## แก้จากภาพผู้ใช้ (2026-10-07)

- เมนู ☰ สูงไม่เกินขอบล่างจอ (วัดจากตำแหน่งจริง รวมแถบสาธิต) แล้วเลื่อนในเมนู
- สีสายไฟเบอร์ในเมนู: เส้นทางบรรทัดแรก รหัสสายบรรทัดสอง ไม่ตัดกลางรหัส
- แถบข้อมูลไม่สดบังป้ายบนผัง → `placeTags(…, top)` + `NocScene.setTopInset` (shell วัดความสูงแถบ): ป้ายแดง/เหลืองอยู่ใต้แถบ
  ชื่อเงียบที่จุดอยู่ใต้แถบซ่อน

## Layout fit (2026-10-07)

- ≥980: `#first` หดได้ (สูงสุด 62% ของคอลัมน์ เลื่อนในตัว) `#right` เหลืออย่างน้อย 9rem → ที่ 1340×525 + storm
  แจ้งเตือนไม่ล้นจอ หน้าไม่เลื่อน (เดิมล้น 19 px แผงแจ้งเตือนเหลือ 20 px)
- หัวผังลอยไม่มีแถบมืดแล้ว: ป้ายบนฉากอยู่ใต้หัวผังด้วย `setTopInset` (shell วัดหัวผัง + แถบข้อมูลไม่สด)
- แถบ 24 ชม.: เหตุที่ยังค้าง (`.tb.open`) เป็นเส้นประ — เตือนค้างหลายวันเคยเป็นแท่งเหลืองเต็มแถบ ดูเหมือนแถบเสีย
- เมนู ☰ เปิด: ชั้นจางทั้งหน้า (`.menu::before`, z 44 ใน `#top` z 30; ปุ่มเมนู z 46) คลิกชั้นจาง = ปิด — ผู้ใช้เลือกแบบ ข (เดิมขอบแผงขวาโผล่ข้างเมนูที่แคบกว่า); วัดด้วย `elementsFromPoint`: `#menuPanel` > ชั้นจาง > `#first`
- สีสายไฟเบอร์ย้ายออกจากเมนูเป็นหน้าต่างของตัวเอง (`shell/FiberColors.tsx`, `#fibers` กรอบเดียวกับวิธีใช้; Esc/ปุ่มปิด/คลิกฉากหลัง) เมนูเหลือปุ่ม "สีสายไฟเบอร์ (N)" — e2e `06b-fibers` (ใช้ `/?demo=mixed` เพราะ seed ของ CI ไม่มีไฟเบอร์)
- "This is a non-commercial session." มุมขวาล่างในภาพผู้ใช้มาจากโปรแกรม remote desktop ไม่ใช่หน้า NOC
- ถัดไป (หลัง UI ผ่าน): เส้นสาย Switch/AP ให้เป็นระเบียบแบบเส้นไฟเบอร์

## ยังไม่ทำ (นอกขอบเขตรอบนี้)

- รับเรื่องในหน้าเว็บ (ตอนนี้เป็นลิงก์ไปรับใน Zabbix ที่ต้นเหตุ ทั้งกลุ่มนับว่ารับแล้ว) — ต้องให้ NOC เขียน acknowledge ลง
  Zabbix แต่ `noc-api-sync` เขียนได้แค่กลุ่ม `99-NOC-Test`
- ค่า ms ในเส้นทาง — worker ยังไม่อ่าน item latency ต่อ host (`icmppingsec`); ห้ามแต่งตัวเลข
- หน้าพอร์ตสวิตช์, มือถือกดค้างรับเรื่อง, สรุปส่งเวร, เสียง P1 ซ้ำทุก 2 นาที (แผ่น 5 ของแคนวาส)

## กับดักที่เจอ (session ถัดไปอ่านก่อน)

- ภาพ 3D ไม่ชัด: ดู 3 อย่าง — composer ไม่มี MSAA (แก้แล้ว), โหมดประหยัด (pixel ratio 1) เคยถูกเปิดเองแล้วจำถาวร (เปลี่ยน key เป็น `noc-eco-v2`), กรอบมุมบ้านรวมโดม/สนามทำให้ตึกเล็ก (ตัดออกแล้ว)
- PostgreSQL ในเครื่อง: role `noc` ต้องเป็น SUPERUSER (migration `0002_roles` สร้าง role)

- อย่าใส่ `animation-play-state: paused` ทั้งหน้า: การ์ดที่มี entrance แบบ `backwards` ค้างมองไม่เห็น
- `clip-path` ตัดมุมตัด popover ที่ล้นออก — ห้ามใส่ใน `#top`
- เครื่อง cloud มี Node 22 แต่ repo ต้อง Node 24 → `npx -y node@24 -e "console.log(process.execPath)"` แล้วเติม dir นั้นเข้า
  PATH ก่อน `pnpm test`; `pnpm test` ฝั่ง web ต้อง build `@sbc-noc/shared` ก่อน
- stack e2e ในเครื่อง (เหมือน job `e2e` ใน `.gitea/workflows/build.yml`): PostgreSQL 16 ต้องวาง data dir ที่ user postgres
  เข้าถึงได้ (เช่น `/var/lib/postgresql/e2e`, scratchpad ไม่ได้), redis-server รันจาก cwd อื่น (ไม่งั้น `dump.rdb` โผล่ใน repo),
  migrate/seed/routes-cli, api `DEMO_MODE=true`, `vite preview --port 4173`,
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; สคริปต์ Playwright ชั่วคราววางใน `tests/e2e/`
  แล้ว import `@playwright/test` (ลบทิ้งก่อน commit)
- ลบ `tests/e2e/{report,results,shots}` ก่อน `pnpm format:check`
- อย่า `pkill -f` ด้วย pattern ที่อยู่ในบรรทัดคำสั่งของ bash เอง
- session อื่นอาจ push branch เดียวกัน → `git fetch` ก่อน push, merge ไม่ rebase
- snapshot เก่าใน Redis ไม่มี `root` → schema ใส่ค่าเริ่มต้น `null`; fixture ใน test ต้องมี `root: null`
- demo topology มี AP 1 ตัวที่ไม่อยู่ในผัง → เลขบนหัวนับเฉพาะอุปกรณ์ที่อยู่ใน layout (`topCounts(snap, known)`)

## ถัดไปหลังผู้ใช้ยืนยัน

อัปเดตแถว "UI ลูกเล่น รอบ 2" ใน `CLAUDE.md` เป็น "เสร็จ (ผู้ใช้ยืนยันบน dev)" แล้วทำตามแถว "ถัดไป" (M34 จอทีวี → M24–M26/M37 → M36)
