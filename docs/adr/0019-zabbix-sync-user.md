# ADR-0019: ผู้ใช้ Zabbix สำหรับงานซิงก์ (เขียน tag)

- **สถานะ:** Accepted (รอผู้ใช้ตั้งค่าใน Zabbix)
- **วันที่:** 2026-10-03

## บริบท

M12 กำหนดผู้ใช้ API อ่านอย่างเดียวกับผู้ใช้รับเรื่อง แต่ M08 ต้องเขียน tag `building` `floor` `loc` `role` `uplink` และ M11 ต้องตั้ง trigger dependency ซึ่งผู้ใช้อ่านอย่างเดียวทำไม่ได้ ADR-0013 ห้าม dev/staging เขียนเข้า host จริง (ทดสอบกับกลุ่ม host ทดสอบแยกเท่านั้น) และ ADR-0016 ให้สิทธิ์น้อยที่สุด

## การตัดสินใจ

- ผู้ใช้ที่ 3 `noc-api-sync` (role `noc-api-sync`, กลุ่ม `noc-api-sync`, frontend Disabled) API allow list: `host.get`, `hostgroup.get`, `host.update` (M11 จะเพิ่ม `trigger.get` + dependency methods)
- dev/staging: กลุ่มผู้ใช้ได้ **Read-write เฉพาะกลุ่ม host `99-NOC-Test`** (host ทดสอบ ไม่มี template ไม่แจ้งเตือน) — token เก็บเป็น `ZABBIX_TOKEN_SYNC` ใน `dev.env`
- prod (M17): token แยก, Read-write ที่กลุ่มเครือข่าย `01-`/`02-`/`03-`
- งาน `zabbix-tags` เขียนเฉพาะ tag 5 ตัวที่ NOC ดูแล คง tag อื่นของ host ไว้ และไม่เขียนถ้าค่าเท่าเดิม; ขอบเขต host ที่เขียนได้ถูกบังคับด้วยสิทธิ์ใน Zabbix ไม่ใช่โค้ด

## ผลที่ตามมา

- dev พิสูจน์การเขียน tag ได้โดยไม่แตะ host จริง; เงื่อนไขเสร็จ M08 "tag ครบ 100%" บน host จริงผ่านได้ตอน M17
- ต้องดูแล token เพิ่ม 1 ตัวต่อสภาพแวดล้อม
