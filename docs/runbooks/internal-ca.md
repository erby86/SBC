# CA ภายใน + https ผ่าน NPM (ADR-0023 ข้อ 8)

ทำครั้งแรกก่อนเปิดล็อกอิน (M23) บน prod และทำข้อ 9 ทุกปี

- root CA `SBC Internal CA`: EC P-256 อายุ 10 ปี ใช้ออกใบได้เฉพาะชื่อใน `sbc.lan` (nameConstraints) และห้ามออกใบให้ IP — ถ้า key หลุด ก็ปลอมเป็นเว็บนอก `sbc.lan` ไม่ได้
- ใบของ NOC: `noc.sbc.lan` + `noc-dev.sbc.lan` อายุ 1 ปี (macOS/iOS ไม่รับใบที่อายุเกิน 825 วัน)
- แก้เฉพาะ proxy host ของ NOC สองตัวใน `sbc-npm` ห้ามแตะ host อื่น
- `ca.key` เข้ารหัสด้วย passphrase และ**ไม่เก็บบนเซิร์ฟเวอร์** เก็บสำเนาในแฟลชไดรฟ์ 2 อันแยกที่ passphrase เก็บในที่เก็บรหัสผ่านของทีม ห้ามใส่ใน git หรือ `dev.env`/`prod.env` (ADR-0005)
- `sbc-ca.crt` (ใบ root) เปิดเผยได้ แจกให้ทุกเครื่องได้

ลำดับสำคัญ: ใส่ใบใน NPM โดยยังไม่บังคับ https (ข้อ 3) → ติดตั้ง root CA บนเครื่อง (ข้อ 4–5) → เปลี่ยน script เราเตอร์ (ข้อ 6) → บังคับ https (ข้อ 7) — ถ้าสลับลำดับ เราเตอร์จะส่ง Discord ว่า NOC ล่ม หรือเบราว์เซอร์จะเตือนใบรับรอง

## 1. สร้าง CA และใบของ NOC บน sbc-ubuntu

```bash
sudo -i
install -d -m 700 /root/sbc-ca && cd /root/sbc-ca
cat > ca.cnf <<'EOF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = SBC Internal CA
O = SB School
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
nameConstraints = critical, permitted;DNS:sbc.lan, excluded;IP:0.0.0.0/0.0.0.0, excluded;IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0
subjectKeyIdentifier = hash
EOF
cat > noc.cnf <<'EOF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = noc.sbc.lan
[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:noc.sbc.lan, DNS:noc-dev.sbc.lan
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EOF
openssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout ca.key -out sbc-ca.crt -days 3650 -config ca.cnf
```

ระบบถาม `Enter PEM pass phrase` 2 ครั้ง — ตั้ง passphrase ยาว (อย่างน้อย 20 ตัว) แล้วบันทึกในที่เก็บรหัสผ่านของทีมทันที

```bash
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc -keyout noc.key -out noc.csr -config noc.cnf
openssl x509 -req -in noc.csr -CA sbc-ca.crt -CAkey ca.key -CAcreateserial -days 365 -extfile noc.cnf -extensions ext -out noc.crt
chmod 600 ca.key noc.key
openssl verify -CAfile sbc-ca.crt noc.crt
openssl x509 -in noc.crt -noout -enddate -ext subjectAltName
openssl x509 -in sbc-ca.crt -noout -fingerprint -sha256
```

ระบบถาม passphrase ของ CA 1 ครั้ง ผลที่ควรเห็น: `noc.crt: OK`, `notAfter=` อีก 1 ปี, `DNS:noc.sbc.lan, DNS:noc-dev.sbc.lan` และ `sha256 Fingerprint=…` — **จด fingerprint ไว้** ใช้ตรวจตอนติดตั้งบนแต่ละเครื่อง

## 2. ส่งไฟล์ไปเครื่องตัวเอง แล้วเอา `ca.key` ออกจากเซิร์ฟเวอร์

บนเซิร์ฟเวอร์ (ยังเป็น root) — เปลี่ยน `<ผู้ใช้>` เป็นชื่อผู้ใช้ SSH ของคุณ:

```bash
install -d -m 700 -o <ผู้ใช้> /tmp/sbc-ca-out
install -m 600 -o <ผู้ใช้> /root/sbc-ca/{ca.key,sbc-ca.crt,noc.crt,noc.key} /tmp/sbc-ca-out/
```

บนเครื่องของคุณ (PowerShell หรือ Terminal):

```bash
scp <ผู้ใช้>@192.168.1.6:/tmp/sbc-ca-out/* .
```

คัด `ca.key` + `sbc-ca.crt` ลงแฟลชไดรฟ์ 2 อัน แล้วลองเปิดดูว่าอ่านได้ — **ทำข้อนี้ให้เสร็จก่อนลบ** จากนั้นบนเซิร์ฟเวอร์:

```bash
shred -u /root/sbc-ca/ca.key /tmp/sbc-ca-out/ca.key /tmp/sbc-ca-out/noc.key
ls /root/sbc-ca /tmp/sbc-ca-out
```

ผลที่ควรเห็น: ไม่มี `ca.key` ในทั้งสองที่ (`noc.key`, `noc.crt`, `*.cnf` ใน `/root/sbc-ca` ยังอยู่ ใช้ตอนต้องอัปโหลดใหม่และต่ออายุ) — ลบ `ca.key` ออกจากเครื่องของคุณด้วยหลังคัดลงแฟลชไดรฟ์แล้ว

## 3. ใส่ใบใน NPM (ยังไม่บังคับ https)

1. NPM → **SSL Certificates** → Add SSL Certificate → **Custom** → Name `sbc-noc-2026`, Certificate Key = `noc.key`, Certificate = `noc.crt`, Intermediate ว่าง → Save
2. **Hosts → Proxy Hosts** → `noc.sbc.lan` → Edit → แท็บ **SSL** → SSL Certificate `sbc-noc-2026`, เปิด **HTTP/2 Support**, **ปิด** Force SSL, **ปิด** HSTS → Save
3. ทำซ้ำข้อ 2 กับ `noc-dev.sbc.lan`
4. เปิด Edit อีกครั้ง ตรวจแท็บ Details ว่า Access List ยังเป็น `sbc-noc-mgmt` และ Websockets Support ยังเปิด
5. ลบไฟล์ `noc.key` บนเครื่องของคุณ

## 4. ติดตั้ง root CA บนเครื่อง STF

ส่ง `sbc-ca.crt` ให้แต่ละเครื่อง ก่อนติดตั้งให้ตรวจ fingerprint SHA-256 ตรงกับที่จดในข้อ 1 (เทียบตัวอักษร ไม่สนตัวพิมพ์เล็กใหญ่ ช่องว่าง และ `:`) — ถ้าไม่ตรง ห้ามติดตั้ง

**Windows** (PowerShell แบบ Run as Administrator ในโฟลเดอร์ที่มีไฟล์) — Chrome/Edge ใช้ที่เก็บนี้; Firefox บน Windows ใช้ตามค่าตั้งต้น:

```powershell
certutil -dump .\sbc-ca.crt | findstr /i "sha256"
Import-Certificate -FilePath .\sbc-ca.crt -CertStoreLocation Cert:\LocalMachine\Root
```

**macOS:**

```bash
openssl x509 -in sbc-ca.crt -noout -fingerprint -sha256
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain sbc-ca.crt
```

**Ubuntu/Debian** (เช่นเครื่องจอทีวี M34) — ระบบ + Chrome/Chromium (รัน `certutil` ด้วยผู้ใช้ที่เปิดเบราว์เซอร์):

```bash
openssl x509 -in sbc-ca.crt -noout -fingerprint -sha256
sudo cp sbc-ca.crt /usr/local/share/ca-certificates/sbc-ca.crt && sudo update-ca-certificates
sudo apt install -y libnss3-tools && mkdir -p ~/.pki/nssdb && certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "SBC Internal CA" -i sbc-ca.crt
```

**Android:** Settings → Security → More security settings → Encryption & credentials → Install a certificate → CA certificate → เลือกไฟล์

**iOS/iPadOS:** ส่งไฟล์ (AirDrop/อีเมล) → Settings → Profile Downloaded → Install → Settings → General → About → Certificate Trust Settings → เปิด `SBC Internal CA`

ปิดเบราว์เซอร์ทั้งหมดแล้วเปิดใหม่ → เปิด `https://noc.sbc.lan` ควรเห็นรูปกุญแจ ไม่มีคำเตือน

## 5. ตรวจจากเครื่องในวง management

```bash
curl -sS https://noc.sbc.lan/api/health/ready; echo
curl -sS https://noc-dev.sbc.lan/api/health/ready; echo
curl -sS -o /dev/null -w '%{http_code}\n' http://noc.sbc.lan/api/health/ready
```

ผลที่ควรเห็น: 2 บรรทัดแรก `{"status":"ok",…}` (ถ้าได้ `SSL certificate problem` แปลว่าเครื่องนี้ยังไม่ได้ติดตั้ง root CA), บรรทัดสุดท้าย `200` (http ยังใช้ได้จนถึงข้อ 7)

## 6. เราเตอร์ CCR2116: เชื่อ CA แล้วตรวจผ่าน https

Winbox → Files → ลาก `sbc-ca.crt` วาง → Terminal:

```
/certificate import file-name=sbc-ca.crt passphrase=""
/certificate print detail where common-name="SBC Internal CA"
:put ([/tool fetch url="https://noc.sbc.lan/api/health/ready" output=user check-certificate=yes as-value]->"data")
```

ผลที่ควรเห็น: `certificates-imported: 1`, ใบมี `trusted=yes` (ถ้าเป็น `no` ให้ `/certificate set [find where common-name="SBC Internal CA"] trusted=yes`), บรรทัดสุดท้าย `{"status":"ok",…}` — **ถ้าขึ้น error เรื่องใบรับรอง หยุดแล้วส่ง error มา** อย่าทำข้อต่อไป

จากนั้น import `infra/mikrotik/noc-watch.rsc` รุ่นใหม่ (ใช้ `https://` + `check-certificate=yes`) ตามขั้นตอน M35 ข้อ 4–5 (`docs/modules/M35.md`) — ผลที่ควรเห็น: `/system script run noc-watch` ไม่มี error และ log ไม่มี `noc-watch:` ใหม่

## 7. บังคับ https

NPM → Proxy Hosts → `noc.sbc.lan` → Edit → SSL → เปิด **Force SSL** → Save; ทำซ้ำกับ `noc-dev.sbc.lan` (HSTS ยังปิดไว้ — เปิดได้ภายหลังเมื่อทุกเครื่องรวมจอทีวีติดตั้ง root CA แล้ว และ**ห้ามเปิด** HSTS Subdomains)

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://noc.sbc.lan/
curl -sS https://noc.sbc.lan/api/health/ready; echo
```

ผลที่ควรเห็น: `301 https://noc.sbc.lan/` และ `{"status":"ok",…}`; เปิดหน้า `https://noc.sbc.lan` แล้วเหตุ/สถานะสดยังขยับ (WebSocket ผ่าน `wss://`); Zabbix web scenario `NOC health` ยังผ่าน (เรียก `http://sbc-noc-web` ภายใน ไม่ผ่าน NPM)

## 8. ย้อนกลับ (ถ้ามีปัญหา)

NPM → Proxy Host → SSL → ปิด Force SSL (เว็บกลับมาใช้ http ได้ทันที) — ถ้าเราเตอร์ตรวจ https ไม่ผ่าน ให้ import `noc-watch.rsc` รุ่นก่อนหน้า (http) จากประวัติ git

## 9. ต่ออายุใบของ NOC (ทุกปี ก่อนหมดอายุ 30 วัน)

ดูวันหมดอายุจากเครื่องใดก็ได้: `echo | openssl s_client -connect noc.sbc.lan:443 -servername noc.sbc.lan 2>/dev/null | openssl x509 -noout -enddate` (หรือ NPM → SSL Certificates) — ตั้งเตือนในปฏิทินทีมไว้ 30 วันก่อนวันนั้น

1. คัด `ca.key` จากแฟลชไดรฟ์ไปที่ `/root/sbc-ca/` (scp เข้า `/tmp` แล้ว `sudo install -m 600 /tmp/ca.key /root/sbc-ca/ && shred -u /tmp/ca.key`)
2. รันชุดคำสั่งที่ 2 ของข้อ 1 (ตั้งแต่ `openssl req -new …` ถึง fingerprint) — ใบ root ไม่เปลี่ยน เครื่องลูกข่ายไม่ต้องติดตั้งใหม่
3. ทำข้อ 2 (ส่งไฟล์ + ลบ `ca.key`) และข้อ 3 ข้อ 1–2 ด้วยชื่อใหม่ `sbc-noc-<ปี>` สลับทั้งสอง proxy host แล้วลบใบเก่าใน NPM
4. ตรวจตามข้อ 5 และดูวันหมดอายุใหม่

root CA หมดอายุปี 2036 — ก่อนนั้น 1 ปีให้สร้าง CA ใหม่และแจกใบ root ใหม่ทุกเครื่อง
