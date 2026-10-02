# tests/

**หน้าที่:** การทดสอบข้ามแอป — `e2e/` (Playwright); unit test อยู่ข้างโค้ดในแต่ละแพ็กเกจ (`*.test.ts`)

**โมดูลที่จะเติม:** M22 (Playwright), M03 (integration test ฐานจริงด้วย Testcontainers อยู่ใน `packages/db`)

**ห้ามทำ:** ห้ามยิง Zabbix หรือฐาน prod จาก test; ใช้ fixture/โหมดสาธิต (ADR-0014)
