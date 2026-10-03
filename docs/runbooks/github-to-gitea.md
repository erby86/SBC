# ส่งงานจาก GitHub เข้า Gitea และอัปเดต dev

Claude Code (cloud) เข้า Gitea ใน LAN ไม่ได้ จึง push งานไว้ที่ GitHub branch `claude/new-session-cawqf1`
(repo `erby86/SBC`) แล้วผู้ใช้ดึงเข้า Gitea `sbc/sbc-noc` บน sbc-ubuntu ด้วยขั้นตอนนี้ — ใช้มาตั้งแต่ M01

## 1. ดึงงานเข้า branch ใหม่ใน Gitea (clone ทำงาน `~/sbc-noc`)

เปลี่ยน `module/Mxx-ชื่อ` ให้ตรงโมดูล (เช่น `module/M19-3d-scene`); ถ้า branch ชื่อนี้เคยใช้แล้วให้ต่อท้าย `-2`

```bash
cd ~/sbc-noc
git switch main && git pull
git switch -c module/Mxx-ชื่อ
git pull --no-rebase https://github.com/erby86/SBC.git claude/new-session-cawqf1
git log --oneline -5
git push -u origin module/Mxx-ชื่อ
```

ควรเห็น commit ของโมดูลนั้นใน `git log`

## 2. PR ใน Gitea

เปิด `http://git.sbc.lan/sbc/sbc-noc/compare/main...module/Mxx-ชื่อ` → New Pull Request → รอ CI (`ci / quality`,
`ci / secrets`, `ci / audit`, `build`, `db-integration`) เขียวครบ → Merge

- "This branch is already included in the target branch" = งานเข้า main ไปแล้ว (หรือดึงจาก GitHub ไม่สำเร็จ) → ปิด PR นั้น
  แล้วเช็ก `git log origin/main`
- checkout ล้มด้วย "remove /root/.cache/act/… no such file" = runner ใช้ cache ชนกัน → กด re-run job

## 3. อัปเดต dev (หลัง merge เท่านั้น)

```bash
cd /opt/sbc-noc/src && git pull -q && git log --oneline -1
docker compose --env-file /opt/sbc-noc/dev.env -f infra/compose/compose.dev.yml up -d --build 2>&1 | tail -2
```

- สั่งงาน worker ให้รันทันที (ไม่รอรอบ): `docker exec sbc-noc-dev-worker node dist/run-job-cli.js <ชื่องาน>`
  (`unifi-aps`, `omada-aps`, `asset-locs`, `zabbix-match`, `zabbix-tags`, `registry-stats`)
- เบราว์เซอร์ยังเห็นหน้าเก่า → Ctrl+F5
