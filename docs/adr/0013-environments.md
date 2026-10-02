# ADR-0013: สภาพแวดล้อม

- **สถานะ:** Accepted
- **วันที่:** 2026-10-02

## บริบท

ต้องทดสอบกับข้อมูล Zabbix จริงโดยไม่เสี่ยงไปกด acknowledge หรือแก้ข้อมูลใน prod

## การตัดสินใจ

- dev (เครื่องผู้พัฒนา), staging `noc-dev.sbc.lan`, prod `noc.sbc.lan`
- dev และ staging ใช้ Zabbix token อ่านอย่างเดียว (`ZABBIX_TOKEN_READ`)
- เฉพาะ prod มี `ZABBIX_TOKEN_ACK`

## ผลที่ตามมา

- ฟีเจอร์ acknowledge ทดสอบจริงได้เฉพาะ prod หรือด้วย mock
- ค่า config แยกตาม environment ผ่าน `.env`
