# การร่วมพัฒนา sbc-noc

## Branch และ PR

- `main` ถูกป้องกัน: push ตรงไม่ได้ ต้องผ่าน PR และ status check ของ `ci.yml`
- ตั้งชื่อ branch: `feat/m03-schema`, `fix/api-health`, `docs/adr-0018`
- กรอก checklist ใน PR template ให้ครบ

## Conventional Commits

รูปแบบ: `<type>(<scope>): <สรุปภาษาอังกฤษ>`

| type       | ใช้เมื่อ                      |
| ---------- | ----------------------------- |
| `feat`     | เพิ่มความสามารถ               |
| `fix`      | แก้บั๊ก                       |
| `docs`     | เอกสาร/ADR                    |
| `test`     | เพิ่มหรือแก้ test             |
| `refactor` | ปรับโค้ดโดยพฤติกรรมไม่เปลี่ยน |
| `ci`       | workflow / CI                 |
| `chore`    | งานอื่น (dependency, config)  |

scope = ชื่อแอป/แพ็กเกจหรือรหัสโมดูล เช่น `feat(api): add /health endpoint`, `docs(adr): add ADR-0018`
การเปลี่ยนที่ไม่เข้ากันกับของเดิมให้ใส่ `!` เช่น `feat(db)!: ...`

## ก่อนเปิด PR

```bash
pnpm format:check && pnpm lint && pnpm depcruise && pnpm typecheck && pnpm test && pnpm build
```

ห้าม commit secret — ใช้ `.env` (ไม่อยู่ใน git) และ Gitea secrets (ADR-0005)
