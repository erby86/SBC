# infra/compose/

**หน้าที่:** Docker Compose สำหรับ dev/staging/prod (`/opt/sbc-noc` บน sbc-ubuntu)

**โมดูลที่จะเติม:** M02 (dev stack), M17 (staging/prod + image จาก `git.sbc.lan`)

**ห้ามทำ:** ห้าม commit `.env`; ห้ามใช้ชื่อ container/network/volume ชนกับ SBC Portal; Redis ใช้ร่วม `sbc-redis` ต้องใช้ prefix `noc:`
