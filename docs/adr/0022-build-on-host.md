# ADR-0022: build image บน sbc-ubuntu และ deploy ด้วยสคริปต์

- **สถานะ:** Accepted
- **วันที่:** 2026-10-05

## บริบท

ADR-0015 และ architecture เขียนว่า prod ใช้ image จาก registry `git.sbc.lan` ที่ CI build ให้ แต่ CI ของ NOC รันใน container `node:24-bookworm` บน `sbc-main-runner` ที่ใช้ร่วมกับ Portal ไม่มี docker socket และกติกาห้ามแก้ config ของ act_runner เอง; registry ของ Gitea เปิดเป็น http ซึ่ง docker ต้องตั้ง `insecure-registries` ใน daemon (ต้อง restart docker ทั้งเครื่อง — กระทบระบบอื่น)

## การตัดสินใจ

- `infra/scripts/deploy.sh prod` build image บน sbc-ubuntu จาก commit ที่ checkout อยู่ (ต้องไม่มีไฟล์แก้ค้าง) ติด tag `<version>-<sha7>` ตาม ADR-0015
- Trivy สแกน image ก่อนใช้งาน (HIGH/CRITICAL ที่มีรุ่นแก้แล้ว = หยุด deploy) และเก็บ SBOM CycloneDX ที่ `/opt/sbc-noc/sbom/` — Trivy รันเป็น container ชั่วคราว `aquasec/trivy`
- CI (`build.yml` job `scan`) สแกน lockfile + Dockerfile ด้วย Trivy แบบไม่ใช้ docker และเก็บ SBOM เป็น artifact
- image เก็บในเครื่อง; rollback = `deploy.sh prod --rollback <tag>` ใช้ image tag เดิมที่ยังอยู่ในเครื่อง; push เข้า registry เป็นทางเลือก (`NOC_IMAGE_PREFIX` + `NOC_PUSH=true`) เมื่อ registry ใช้ https ได้
- ชี้แจง ADR-0021: M17 ขึ้น prod stack และเปิด `noc.sbc.lan` ให้วง management เข้าถึงเพื่อตรวจเงื่อนไขปิด G3 ได้ แต่ **การประกาศใช้กับทีม/จอทีวี** ยังรอ G1–G2 ปิดตาม ADR-0021

## ผลที่ตามมา

- ไม่ต้องแตะ act_runner หรือ docker daemon; build ใช้ CPU ของ sbc-ubuntu ช่วง deploy (สั่ง deploy นอกเวลาเรียน)
- image ที่ใช้ตรงกับ commit ที่สแกนแล้ว แต่ไม่มีสำเนานอกเครื่อง — ถ้าเครื่องเสีย build ใหม่จาก tag git ได้
- ต้องลบ image เก่าเอง (`docker image ls 'sbc-noc-*'`) เก็บไว้อย่างน้อย 3 รุ่นล่าสุดเพื่อ rollback
