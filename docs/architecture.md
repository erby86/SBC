# สถาปัตยกรรม sbc-noc

## ภาพรวมระบบ

sbc-noc คือระบบ NOC แสดงผังเครือข่าย 3 มิติของโรงเรียน SB School ใช้งานเฉพาะใน LAN (`*.sbc.lan`, ADR-0008)

```
 ผู้ใช้ / จอทีวี ──► web (หน้า 3D, Vite + React)
                         │ HTTP
                         ▼
                    api (Fastify) ──────► PostgreSQL  sbc-noc-db
                         ▲                     ▲
                         │                     │
                    worker (งานเบื้องหลัง) ─────┘
                         │   ▲
              คิว/แคช    ▼   │  สถานะอุปกรณ์ / ปัญหา
                 Redis sbc-redis (prefix noc:)    Zabbix (แหล่งสถานะ)
```

| ส่วน                       | หน้าที่                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`                 | หน้า 3D แสดงอาคาร ตู้ อุปกรณ์ และสถานะ                                                                                                                       |
| `apps/api`                 | REST API, auth (OIDC + บัญชีฉุกเฉิน ADR-0011), `GET /health`                                                                                                 |
| `apps/worker`              | ดึงสถานะจาก Zabbix, งานตามเวลา, `/metrics` (ADR-0010)                                                                                                        |
| PostgreSQL 16 `sbc-noc-db` | ข้อมูลหลักตาม schema v1.1 / design v1.2: `core`, `catalog`, `asset`, `net`, `viz`, `auth`, `ops`, `sync`, `audit` และ view `api.*` สำหรับระบบอื่น (ADR-0018) |
| Redis `sbc-redis`          | ใช้ร่วมกับระบบอื่น — key ทั้งหมดขึ้นต้น `noc:`                                                                                                               |
| Zabbix                     | แหล่งความจริงของสถานะออนไลน์/ปัญหา; sbc-noc อ่านอย่างเดียว ยกเว้น acknowledge ใน prod (ADR-0013)                                                             |

## โครงสร้างโฟลเดอร์ (ADR-0009)

```
sbc-noc/
├─ apps/
│  ├─ web/      Vite + React + TypeScript
│  ├─ api/      Fastify + TypeScript
│  └─ worker/   TypeScript worker
├─ packages/
│  ├─ db/       schema + client (M03)
│  ├─ shared/   ค่าคงที่, ชนิดข้อมูล, zod schema
│  └─ ui/       React component ร่วม
├─ infra/
│  ├─ compose/  Docker Compose (M02/M17)
│  ├─ zabbix/   template / discovery
│  ├─ scripts/  backup/กู้คืน, สร้าง issue, deploy
│  └─ seed/     ข้อมูลตั้งต้นจาก Google Sheet (M04)
├─ docs/
│  ├─ architecture.md
│  ├─ baseline/  baseline-v8, schema-design-v1.2, modules-by-gate-v2, kickoff-plan-v2
│  ├─ prototype/ ต้นแบบหน้าจอ sb-noc-3d-baseline-v3.html
│  ├─ adr/
│  ├─ modules/
│  └─ runbooks/
├─ CLAUDE.md    บริบทสำหรับ Claude Code ทุก session
├─ tests/e2e/   Playwright (M22)
└─ .gitea/workflows/  ci.yml, build.yml
```

## กติกาทิศทางการเรียกใช้

บังคับด้วย dependency-cruiser (`.dependency-cruiser.cjs`) — CI job `quality` ล้มเมื่อผิดกติกา

| จาก                       | เรียกได้                         | ห้าม                   |
| ------------------------- | -------------------------------- | ---------------------- |
| `apps/web`                | `packages/shared`, `packages/ui` | `packages/db`, แอปอื่น |
| `apps/api`, `apps/worker` | `packages/db`, `packages/shared` | `packages/ui`, แอปอื่น |
| `packages/*`              | แพ็กเกจอื่น (ไม่วนกัน)           | `apps/*`               |

ตรวจในเครื่อง: `pnpm depcruise`

## สภาพแวดล้อม (ADR-0013)

| env     | ที่อยู่           | Zabbix token       | หมายเหตุ                                                                                                                              |
| ------- | ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| dev     | เครื่องผู้พัฒนา   | อ่านอย่างเดียว     | โหมดสาธิตเปิดได้ (ADR-0014)                                                                                                           |
| staging | `noc-dev.sbc.lan` | อ่านอย่างเดียว     | โหมดสาธิตเปิดได้                                                                                                                      |
| prod    | `noc.sbc.lan`     | อ่าน + acknowledge | `infra/scripts/deploy.sh prod` บน sbc-ubuntu, image build ในเครื่อง tag `<version>-<sha>` (ADR-0022), log → Loki ผ่าน `sbc-noc-alloy` |

## CI (ADR-0007, ADR-0016)

- `ci.yml` ทุก push/PR: `quality` (format, lint, ทิศทาง import, typecheck, test), `secrets` (gitleaks), `audit` (pnpm audit high)
- `build.yml` เฉพาะ PR เข้า `main` และ tag `v*`: `build`, `scan` (Trivy lockfile + Dockerfile, SBOM artifact — M17), `db-integration` (PostgreSQL 16 + Redis จริง, M03), `e2e` (Playwright 3 ขนาด บน stack ใน job, artifact `e2e-shots`, M22)

## ADR

- [ADR-0001: เลข LOC](adr/0001-loc-numbering.md)
- [ADR-0002: รหัสอุปกรณ์](adr/0002-device-code.md)
- [ADR-0003: ขอบเขตครุภัณฑ์](adr/0003-asset-scope.md)
- [ADR-0004: เครื่องออนไลน์ห้องคอมพิวเตอร์](adr/0004-computer-lab-online.md)
- [ADR-0005: ที่เก็บ secret](adr/0005-secret-storage.md)
- [ADR-0006: รูปแบบรหัสป้าย](adr/0006-label-format.md)
- [ADR-0007: CI runner](adr/0007-ci-runner.md)
- [ADR-0008: ที่อยู่ระบบ](adr/0008-addresses.md)
- [ADR-0009: โครงสร้าง repo](adr/0009-repo-structure.md)
- [ADR-0010: การเฝ้าระบบตัวเอง](adr/0010-self-monitoring.md)
- [ADR-0011: ล็อกอินเมื่ออินเทอร์เน็ตล่ม](adr/0011-offline-login.md)
- [ADR-0012: การเข้าใช้จากนอกโรงเรียน](adr/0012-remote-access.md)
- [ADR-0013: สภาพแวดล้อม](adr/0013-environments.md)
- [ADR-0014: โหมดสาธิต](adr/0014-demo-mode.md)
- [ADR-0015: การออกรุ่นและย้อนกลับ](adr/0015-release-rollback.md)
- [ADR-0016: ความปลอดภัยใน CI](adr/0016-ci-security.md)
- [ADR-0017: เวลา](adr/0017-time.md)
- [ADR-0018: migration ฐานข้อมูล](adr/0018-db-migrations.md)
- [ADR-0019: ผู้ใช้ Zabbix สำหรับงานซิงก์](adr/0019-zabbix-sync-user.md)
