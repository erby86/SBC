# infra/compose/

**หน้าที่:** Docker Compose ของ sbc-noc บน sbc-ubuntu

| ไฟล์              | ใช้ทำอะไร                                                          |
| ----------------- | ------------------------------------------------------------------ |
| `compose.dev.yml` | dev stack (M02): `sbc-noc-dev-db`, `-api`, `-worker`, `-web`       |
| `dev.env.example` | แม่แบบไฟล์ env — ไฟล์จริงอยู่ที่ `/opt/sbc-noc/dev.env` สิทธิ์ 600 |

วิธีรันและตรวจสอบ: [docs/modules/M02.md](../../docs/modules/M02.md)

**โมดูลที่จะเติม:** M17 (staging/prod + image จาก registry)

**ห้ามทำ:**

- ห้าม commit ไฟล์ env จริง
- ห้ามใช้ชื่อ container/network/volume ที่ไม่ขึ้นต้นด้วย `sbc-noc-`
- ห้ามแก้หรือ restart container ของระบบอื่น (`sbc-redis` ใช้ร่วม — ต่อเข้า network เดิมเท่านั้น)
- dev ต้องใช้ `REDIS_PREFIX=noc:dev:` เพื่อไม่ชนกับ prod (`noc:`)
