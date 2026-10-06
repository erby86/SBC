# infra/

**หน้าที่:** ไฟล์ปฏิบัติการ — `compose/` (Docker Compose), `zabbix/` (template/discovery), `mikrotik/` (script บนเราเตอร์ เช่น M35 เฝ้าตัวเอง), `scripts/` (สคริปต์ backup, deploy)

**โมดูลที่จะเติม:** M02 / M17 (compose, image), โมดูล Zabbix

**ห้ามทำ:** ห้ามใส่ secret จริง (ใช้ `.env` บนเซิร์ฟเวอร์ สิทธิ์ 600 นอก repo ตาม ADR-0005), ห้ามแตะ container ของ SBC Portal
