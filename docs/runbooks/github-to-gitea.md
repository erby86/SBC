# ส่งงานจาก GitHub เข้า Gitea และอัปเดต dev

Claude Code (cloud) เข้า Gitea ใน LAN ไม่ได้ จึง push งานไว้ที่ GitHub repo `erby86/SBC` แล้วผู้ใช้ดึงเข้า Gitea
`sbc/sbc-noc` บน sbc-ubuntu ด้วยขั้นตอนนี้ — ใช้มาตั้งแต่ M01

**แต่ละ session ของ Claude ได้ branch ของตัวเอง** (เช่น `claude/new-session-cawqf1`, `claude/claude-md-m19-n9sxn2`)
— เมื่อจบโมดูล Claude ต้องบอกชื่อ branch ที่ push และให้คำสั่งข้อ 1 ที่ใส่ชื่อนั้นแล้ว (`<branch>` ข้างล่าง)

## 1. ดึงงานเข้า branch ใหม่ใน Gitea (clone ทำงาน `~/sbc-noc`)

เปลี่ยน `module/Mxx-ชื่อ` ให้ตรงโมดูล (เช่น `module/M19-3d-scene`); ถ้า branch ชื่อนี้เคยใช้แล้วให้ต่อท้าย `-2`

```bash
cd ~/sbc-noc
git switch main && git pull
git switch -c module/Mxx-ชื่อ
git pull --no-rebase https://github.com/erby86/SBC.git <branch>
git log --oneline -5
git push -u origin module/Mxx-ชื่อ
```

ควรเห็น commit ของโมดูลนั้นใน `git log`

- รันข้อ 1 ใน `~/sbc-noc` เท่านั้น — **ห้ามรันใน `/opt/sbc-noc/src`** (clone ของ dev ใช้แค่ข้อ 3 บน `main`)
- ส่งผลให้ Claude: คัดจาก terminal วางในแชท อย่าวางกลับลง terminal (บรรทัด log กลายเป็นคำสั่ง ได้ไฟล์ขยะชื่อแปลก ๆ เช่น
  `"and a calmer top bar …"` — ดูด้วย `head` แล้ว `rm -- "<ชื่อ>"`)
- `CONFLICT` หลัง Claude รวม commit ใหม่ (squash/force-push) ทับงานที่เคยดึงเข้า Gitea แล้ว: ตรวจ
  `git log --oneline <base>..ORIG_HEAD` ว่ามีแค่งานรุ่นเก่าของ branch เดียวกัน แล้วใช้ฝั่ง GitHub
  `git diff --name-only --diff-filter=U -z | xargs -0 git checkout --theirs -- && git add -A && git commit --no-edit`
  (มีงานอื่นปน → หยุด ถาม Claude)
- push ถูกปฏิเสธ `(stale info)` = มีคน push branch นี้ไปแล้ว → `git fetch origin <branch>` ดูก่อน อย่า force ทับ

## 2. PR ใน Gitea

เปิด `http://git.sbc.lan/sbc/sbc-noc/compare/main...module/Mxx-ชื่อ` → New Pull Request → รอ CI (`ci / quality`,
`ci / secrets`, `ci / audit`, `build`, `scan`, `db-integration`, `e2e`) เขียวครบ — `e2e` ใช้ราว 10–20 นาที ภาพอยู่ใน artifact `e2e-shots` → Merge

- "This branch is already included in the target branch" = งานเข้า main ไปแล้ว (หรือดึงจาก GitHub ไม่สำเร็จ) → ปิด PR นั้น
  แล้วเช็ก `git log origin/main`
- checkout ล้มด้วย "remove /root/.cache/act/… no such file" = runner ใช้ cache ชนกัน → กด re-run job

## 3. อัปเดต dev (หลัง merge เท่านั้น)

```bash
cd /opt/sbc-noc/src && git switch main && git pull -q && git log --oneline -1
infra/scripts/deploy.sh staging 2>&1 | tail -6
```

`deploy.sh staging` (M17) = backup ฐาน dev → build → Trivy → `up -d` → รอ health; ควรจบด้วย `staging OK`
prod ใช้ `infra/scripts/deploy.sh prod` แยกต่างหาก (`docs/modules/M17.md`)

- สั่งงาน worker ให้รันทันที (ไม่รอรอบ): `docker exec sbc-noc-dev-worker node dist/run-job-cli.js <ชื่องาน>`
  (`unifi-aps`, `omada-aps`, `asset-locs`, `zabbix-match`, `zabbix-tags`, `registry-stats`)
- เบราว์เซอร์ยังเห็นหน้าเก่า → Ctrl+F5
