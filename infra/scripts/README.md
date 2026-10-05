# infra/scripts/

**หน้าที่:** สคริปต์ปฏิบัติการบน sbc-ubuntu

| สคริปต์              | ใช้ทำอะไร                                                                              | โมดูล |
| -------------------- | -------------------------------------------------------------------------------------- | ----- |
| `pg-backup.sh`       | pg_dump รายวัน เก็บ 14 daily / 8 weekly                                                | M02   |
| `pg-restore.sh`      | กู้ dump ลงฐานใหม่ (ไม่ทับของเดิม)                                                     | M02   |
| `pg-restore-test.sh` | ทดลองกู้คืนแล้วเทียบกับฐานจริง                                                         | M02   |
| `deploy.sh`          | deploy/rollback prod และ staging: build + Trivy + SBOM, backup ก่อน migrate (ADR-0022) | M17   |
| `gitea-issues.mjs`   | สร้าง milestone G1–G6, label, issue M00–M38 จาก `docs/baseline/modules-by-gate-v2.md`  | M01   |

**โมดูลที่จะเติม:** M35 (เฝ้าตัวเอง)

**ห้ามทำ:** ห้ามสคริปต์ที่แก้ระบบอื่นนอก sbc-noc; ห้ามฝัง secret (รับจาก env เท่านั้น)
