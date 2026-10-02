# apps/

**หน้าที่:** แอปที่ deploy ได้ — `web` (หน้า 3D, Vite + React), `api` (Fastify), `worker` (งานเบื้องหลัง)

**โมดูลที่จะเติม:** M01 วางโครง; ฟีเจอร์ของแต่ละแอปเติมตามโมดูลใน sbc-noc-modules-by-gate-v2 (image/deploy ใน M17, e2e ใน M22)

**ห้ามทำ:**

- `web` ห้าม import `packages/db` — เรียกได้เฉพาะ `packages/shared`, `packages/ui`
- `api`, `worker` เรียกได้เฉพาะ `packages/db`, `packages/shared`
- แอปห้าม import กันเอง (ใช้ `packages/shared` แทน)
- ห้ามใส่ค่า secret ในโค้ด อ่านจาก env เท่านั้น
