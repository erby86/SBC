# packages/

**หน้าที่:** โค้ดที่ใช้ร่วมกัน

- `db` — schema และ client ของ PostgreSQL `sbc-noc-db` (M03)
- `shared` — ค่าคงที่ ชนิดข้อมูล และ zod schema ที่ใช้ทั้ง frontend/backend (เช่น `BUILDING_CODES`)
- `ui` — React component ที่ใช้ร่วม

**โมดูลที่จะเติม:** M03 (`db`), โมดูลฝั่งหน้าจอ (`ui`), ทุกโมดูลเติม `shared` ตามต้องการ

**ห้ามทำ:**

- `packages/*` ห้าม import `apps/*`
- `shared` ห้ามมีโค้ดที่ผูกกับ Node หรือ browser อย่างใดอย่างหนึ่ง และห้ามมี secret
