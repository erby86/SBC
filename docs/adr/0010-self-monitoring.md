# ADR-0010: การเฝ้าระบบตัวเอง

- **สถานะ:** Accepted
- **วันที่:** 2026-10-02

## บริบท

ถ้า sbc-noc ล่ม ผู้ดูแลต้องรู้ แม้ตัว NOC เองจะใช้แจ้งเตือนไม่ได้

## การตัดสินใจ

- Netwatch บน MikroTik CCR2116 ping/HTTP check `noc.sbc.lan` และแจ้ง Telegram
- Zabbix เฝ้า `/metrics` ของ worker (คิว, งานค้าง, เวลาซิงก์ล่าสุด)

## ผลที่ตามมา

- worker ต้องเปิด endpoint `/metrics`
- มีช่องทางแจ้งเตือนที่ไม่พึ่ง sbc-noc

## ปรับใน M35 (2026-10-05)

- `/metrics` อยู่ที่ api (`/api/metrics` ผ่าน NPM) แทน worker เพราะ worker ไม่มีพอร์ต HTTP และ M17 ปิดพอร์ตที่เปิดตรงทั้งหมด; worker เขียน heartbeat และตัวนับคิวลง Redis ส่วน api อ่านค่านี้พร้อมกับ `sync.runs`
- ฝั่งเราเตอร์ใช้ script + scheduler ทุก 30 วินาที (`infra/mikrotik/noc-watch.rsc`) แทนการตั้ง Netwatch เพื่อให้ตรวจ `/api/health/ready` ทั้ง URL และเนื้อหา และคุมการส่ง Telegram ครั้งเดียวต่อเหตุได้ในที่เดียว
