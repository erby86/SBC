# sbc-noc

ระบบ NOC ผังเครือข่าย 3 มิติของโรงเรียน SB School (ใช้งานเฉพาะใน LAN `*.sbc.lan`)

- สถาปัตยกรรม: [docs/architecture.md](docs/architecture.md)
- ADR: [docs/adr/](docs/adr/)
- โมดูลปัจจุบัน: [M01 monorepo + CI](docs/modules/M01.md)
- วิธีร่วมพัฒนา: [CONTRIBUTING.md](CONTRIBUTING.md)

## เริ่มต้นเร็ว

```bash
nvm use            # Node 24 LTS (.nvmrc)
corepack enable    # pnpm ตาม packageManager
pnpm install
pnpm lint && pnpm depcruise && pnpm typecheck && pnpm test && pnpm build
```
