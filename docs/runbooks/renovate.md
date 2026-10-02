# Runbook: Renovate bot

Renovate รันจาก `.gitea/workflows/renovate.yml` ทุกวันจันทร์ 05:00 (Asia/Bangkok) และกดรันเองได้จากแท็บ Actions กติกาการจัดกลุ่มอยู่ใน `renovate.json`

## ติดตั้งครั้งแรก

1. สร้างผู้ใช้ Gitea `renovate-bot` (Site Administration → User Accounts) ไม่ต้องเป็น admin
2. เพิ่ม `renovate-bot` เป็น collaborator ของ `sbc/sbc-noc` สิทธิ์ **Write**
3. ล็อกอินเป็น `renovate-bot` → Settings → Applications → สร้าง token สิทธิ์ `repository: read/write`, `issue: read/write`, `user: read`, `organization: read`
4. ใน `sbc/sbc-noc` → Settings → Actions → Secrets เพิ่ม `RENOVATE_TOKEN` = token จากข้อ 3
5. แท็บ Actions → workflow `renovate` → Run workflow แล้วตรวจ log

## หมายเหตุ

- PR ของ Renovate ต้องผ่าน CI และกติกา branch protection เหมือน PR ปกติ
- ห้ามใส่ token ลงไฟล์ใน repo (ADR-0005)
- ถ้าต้องหยุดชั่วคราว: ปิด workflow ในแท็บ Actions
