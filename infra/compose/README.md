# infra/compose/

**หน้าที่:** Docker Compose ของ sbc-noc บน sbc-ubuntu

| ไฟล์                 | ใช้ทำอะไร                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `compose.dev.yml`    | dev stack (M02): `sbc-noc-dev-db`, `-api`, `-worker`, `-web`                                                      |
| `dev.env.example`    | แม่แบบไฟล์ env — ไฟล์จริงอยู่ที่ `/opt/sbc-noc/dev.env` สิทธิ์ 600                                                |
| `compose.prod.yml`   | prod stack (M17): `sbc-noc-db`, `-api`, `-worker`, `-web`, `-alloy` — สั่งผ่าน `infra/scripts/deploy.sh` เท่านั้น |
| `prod.env.example`   | แม่แบบ `/opt/sbc-noc/prod.env` สิทธิ์ 600                                                                         |
| `alloy/config.alloy` | ส่ง log container `sbc-noc-*` (prod + staging) เข้า Loki                                                          |

วิธีรันและตรวจสอบ: [docs/modules/M02.md](../../docs/modules/M02.md) (dev), [docs/modules/M17.md](../../docs/modules/M17.md) (prod, deploy/rollback)

**ห้ามทำ:**

- ห้าม commit ไฟล์ env จริง
- ห้ามใช้ชื่อ container/network/volume ที่ไม่ขึ้นต้นด้วย `sbc-noc-`
- ห้ามแก้หรือ restart container ของระบบอื่น (`sbc-redis` ใช้ร่วม — ต่อเข้า network เดิมเท่านั้น)
- dev ต้องใช้ `REDIS_PREFIX=noc:dev:` เพื่อไม่ชนกับ prod (`noc:`)
- ห้ามใส่ `ports:` ให้ service ใด — เข้าได้ทาง NPM เท่านั้น (G3)
- ห้าม `docker compose -f compose.prod.yml up` เอง: ใช้ `deploy.sh` ซึ่ง backup ก่อน migrate (ADR-0015)
