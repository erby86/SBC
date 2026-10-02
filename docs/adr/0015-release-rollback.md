# ADR-0015: การออกรุ่นและย้อนกลับ

- **สถานะ:** Accepted
- **วันที่:** 2026-10-02

## บริบท

การ deploy ต้องย้อนกลับได้เร็ว และ migration ฐานข้อมูลต้องไม่ทำให้รุ่นก่อนพัง

## การตัดสินใจ

- SemVer ออกรุ่นด้วย tag `vX.Y.Z`
- image tag = รุ่น + git sha เช่น `0.3.0-ab12cd3`
- backup ฐานก่อน migrate ทุกครั้ง
- migration แบบ expand/contract

## ผลที่ตามมา

- rollback = deploy image tag ก่อนหน้า โดยไม่ต้องย้อน schema
- คอลัมน์เก่าลบได้ในรุ่นถัดไปเท่านั้น
