# infra/zabbix/

**หน้าที่:** template, network discovery (ADR-0004) และการเฝ้า `/metrics` ของ worker (ADR-0010)

**มีแล้ว:** `templates/sbc-noc-selfmon.yaml` (M35) — import แล้วผูกกับ host `sbc-noc` ตาม `docs/modules/M35.md`

**โมดูลที่จะเติม:** โมดูลเชื่อม Zabbix ตาม sbc-noc-modules-by-gate-v2

**ห้ามทำ:** ห้ามใส่ Zabbix token ในไฟล์; dev/staging ใช้ token อ่านอย่างเดียว (ADR-0013)
