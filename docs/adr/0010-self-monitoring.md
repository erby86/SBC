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
