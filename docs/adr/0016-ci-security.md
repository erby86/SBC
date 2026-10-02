# ADR-0016: ความปลอดภัยใน CI

- **สถานะ:** Accepted
- **วันที่:** 2026-10-02

## บริบท

repo มี config ระบบเครือข่ายของโรงเรียน ต้องป้องกัน secret รั่วและช่องโหว่จาก dependency

## การตัดสินใจ

- gitleaks ทุก push/PR ล้มเมื่อเจอ secret
- `pnpm audit --audit-level=high`
- Trivy สแกน image และสร้าง SBOM (M17)
- ป้องกัน branch `main`: ต้องผ่าน PR และ status check
- แอปใช้ CSP และ rate limit

## ผลที่ตามมา

- dependency ที่มีช่องโหว่ high ขึ้นไปทำให้ merge ไม่ได้จนกว่าจะอัปเดต
- Renovate ช่วยอัปเดต dependency รายสัปดาห์
