# infra/zabbix/

**หน้าที่:** template, network discovery (ADR-0004) และการเฝ้า `/metrics` ของ worker (ADR-0010)

**โมดูลที่จะเติม:** โมดูลเชื่อม Zabbix ตาม sbc-noc-modules-by-gate-v2

**ห้ามทำ:** ห้ามใส่ Zabbix token ในไฟล์; dev/staging ใช้ token อ่านอย่างเดียว (ADR-0013)
