# docs/runbooks/

**หน้าที่:** ขั้นตอนปฏิบัติเมื่อเกิดเหตุ (ระบบล่ม, อินเทอร์เน็ตล่ม, restore backup, rollback)

**โมดูลที่จะเติม:** M17 (deploy/rollback) และโมดูลที่เกี่ยวกับการเฝ้าระบบ

**ห้ามทำ:** ห้ามใส่รหัสผ่านของบัญชีผู้ใช้ NOC (ADR-0023) หรือ secret อื่น — อ้างที่เก็บแทน

- [github-to-gitea.md](github-to-gitea.md) — ส่งงานจาก GitHub (Claude Code) เข้า Gitea และอัปเดต dev
