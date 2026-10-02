# @sbc-noc/db

ฐานข้อมูล PostgreSQL 16 ของ sbc-noc ตาม sbc-noc-schema-v1.1 / design v1.2 (ADR-0018)

- `migrations/NNNN_name.sql` — DDL; ไฟล์ที่ apply แล้วห้ามแก้ ให้เพิ่มไฟล์ใหม่
- `migrate-cli` — `DATABASE_URL=... pnpm --filter @sbc-noc/db migrate` (หลัง build)
- `createDbPool`, `pingDatabase`, `migrate`, `loadMigrations`
- ทดสอบกับฐานจริง: `TEST_DATABASE_URL=postgres://.../ฐานว่าง pnpm --filter @sbc-noc/db test`

ใช้ได้จาก `apps/api`, `apps/worker` เท่านั้น — **`apps/web` ห้าม import**
