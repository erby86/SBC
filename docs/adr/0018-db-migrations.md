# ADR-0018: migration ฐานข้อมูล

- **สถานะ:** Accepted
- **วันที่:** 2026-10-02

## บริบท

baseline-v8 เลือก Drizzle ORM + drizzle-kit และ Testcontainers แต่ DDL ของ schema v1.1 เขียนเป็น SQL ตรง (หลาย schema, trigger, view, DO block) ซึ่ง drizzle-kit สร้าง migration แทนไม่ได้ครบ และ job container บน act_runner ที่ใช้ร่วมกับ Portal ไม่มี Docker socket ให้ Testcontainers

## การตัดสินใจ

- **SQL เป็นต้นทาง:** migration เป็นไฟล์ SQL ใน `packages/db/migrations/NNNN_name.sql` (ไฟล์แรกคือ DDL v1.1 ตามต้นฉบับ) รันด้วย `migrate-cli` บันทึกใน `public.schema_migrations` พร้อม checksum; ไฟล์ที่ apply แล้วห้ามแก้
- **Drizzle ใช้สำหรับ query แบบมี type:** `src/schema/` สร้างด้วย `pnpm db:pull` (drizzle-kit pull) จากฐานที่ migrate แล้ว ห้ามแก้มือ; ไม่ใช้ `drizzle-kit generate/migrate`
- PostgreSQL 16 ทุกสภาพแวดล้อม
- CI ทดสอบกับฐานจริงด้วย `services: postgres:16-alpine` ใน `build.yml` แทน Testcontainers

## ผลที่ตามมา

- ไม่ต้องแก้ config ของ runner (ADR-0007)
- เพิ่ม migration ใหม่ต้องรัน `db:pull` แล้ว commit schema ที่สร้างใหม่ใน PR เดียวกัน
- prod ต้อง backup ก่อน migrate (ADR-0015, M17)
