# tests/e2e/

**หน้าที่:** Playwright (M22) — ถ่ายภาพหน้าหลักที่ 1920×1080 มืด, 1366×768 สว่าง, มือถือ 390×844 และล้มเมื่อมีข้อความเลยขอบจอหรือถูกกล่องตัด (`lib/overflow.ts`, ตัวตรวจมีทดสอบของตัวเองใน `specs/overflow-check.spec.ts`); ตรวจปุ่ม Zabbix/Grafana/GLPI; วัด fps โหมดทีวี

**ห้ามทำ:** ห้ามรันกับ `noc.sbc.lan` (prod — config โยน error) ให้ใช้ staging `noc-dev.sbc.lan` หรือ stack ในเครื่อง; ไม่อยู่ใน `pnpm test`

## รัน

stack ในเครื่อง (เหมือน CI job `e2e` ใน `.gitea/workflows/build.yml`): ฐาน PostgreSQL 16 ที่ migrate + seed แล้ว, api ที่ `:3001` (`DEMO_MODE=true`), `pnpm build` แล้ว

```bash
pnpm --filter @sbc-noc/e2e e2e                       # เปิด vite preview :4173 ให้เอง
E2E_BASE_URL=http://noc-dev.sbc.lan pnpm --filter @sbc-noc/e2e e2e   # กับ dev
E2E_MIN_FPS=30 ...                                   # บังคับ fps โหมดทีวี (เครื่องที่มี GPU)
PW_CHROMIUM_PATH=/path/to/chrome ...                 # Chromium ของเครื่อง ถ้าไม่ได้ติดตั้งของ Playwright
```

ผล: ภาพ `shots/<ขนาด>-<หน้า>.png`, รายงาน `report/index.html`
