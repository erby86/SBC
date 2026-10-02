# @sbc-noc/shared

ค่าคงที่ ชนิดข้อมูล และ zod schema ที่ใช้ร่วมทุกแอป

- `BUILDING_CODES` — รหัสอาคาร `sp i2 i1 b1 b2 s8 ba bb`
- `outletCodeSchema`, `rackCodeSchema`, `cableCodeSchema`, `locCodeSchema` — รูปแบบรหัสป้ายตาม ADR-0006 / ADR-0001
- `serverEnvSchema`, `parseEnv` — ตรวจ env ของ api/worker
- `healthResponseSchema` — รูปแบบคำตอบ `GET /health`
