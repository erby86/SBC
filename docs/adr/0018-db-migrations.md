# ADR-0018: migration ฐานข้อมูล

- **สถานะ:** Accepted
- **วันที่:** 2026-10-02

## บริบท

DDL ของ sbc-noc-schema-v1.1 เขียนเป็น SQL ตรง (หลาย schema, trigger, view, DO block) และ design v1.2 กำหนด PostgreSQL 16 ส่วน M01 วางแผนใช้ Testcontainers ใน CI แต่ job container บน act_runner ที่ใช้ร่วมกับ Portal ไม่มี Docker socket

## การตัดสินใจ

- migration เป็นไฟล์ SQL ใน `packages/db/migrations/NNNN_name.sql` รันด้วยตัวรันของเราเอง (`migrate-cli`) บันทึกใน `public.schema_migrations` พร้อม checksum
- ไฟล์ที่ apply แล้วห้ามแก้ — ตัวรันปฏิเสธถ้า checksum เปลี่ยน; การเปลี่ยนแปลงต้องเป็นไฟล์ใหม่ (expand/contract ตาม ADR-0015)
- ไม่ใช้ ORM สร้าง schema; DDL v1.1 ใช้ตามต้นฉบับ
- PostgreSQL 16 ทุกสภาพแวดล้อม
- CI ทดสอบกับฐานจริงด้วย `services: postgres:16-alpine` ใน `build.yml` แทน Testcontainers

## ผลที่ตามมา

- ไม่ต้องแก้ config ของ runner (ADR-0007)
- dev stack มี container `sbc-noc-dev-migrate` รันก่อน api/worker
- prod ต้อง backup ก่อน migrate (ADR-0015, M17)
