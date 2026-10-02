# ADR-0007: CI runner

- **สถานะ:** Accepted
- **วันที่:** 2026-10-02

## บริบท

มี act_runner เครื่องเดียวที่ใช้ร่วมกับ SBC Portal ทรัพยากรจำกัด งาน CI ของ sbc-noc ต้องไม่แย่ง Portal

## การตัดสินใจ

- ใช้ runner ร่วมกับ Portal ตั้ง `capacity: 2`
- งานเบา (lint/typecheck/test/gitleaks/audit) ทุก push; งานหนัก (build, image, e2e) เฉพาะ PR เข้า main และ tag `v*`
- `concurrency` + `cancel-in-progress` ยกเลิกงานซ้ำ
- จำกัด container (`--cpus`, `--memory`) และ cache pnpm store
- แยก runner เมื่อ CI ทำให้ Portal ช้าลงหรือคิวรอนานเป็นประจำ (เกณฑ์ตัวเลขกำหนดตอนทบทวน)

## ผลที่ตามมา

- PR ใช้เวลารอเพิ่มเมื่อ Portal มีงาน
- การแก้ config runner ต้องขออนุญาตผู้ดูแลก่อน
