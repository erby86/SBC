# infra/scripts/

**หน้าที่:** สคริปต์ปฏิบัติการ เช่น backup ก่อน migrate, deploy, rollback (ADR-0015)

**โมดูลที่จะเติม:** M17 และโมดูล backup/ออกรุ่น

**ห้ามทำ:** ห้ามสคริปต์ที่แก้ระบบอื่นนอก `/opt/sbc-noc`; ห้ามฝัง secret
