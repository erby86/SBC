// M23 login form for /admin (ADR-0023). Accounts are created on the server (user-cli); there is
// no sign-up or reset page — ask the administrator.
import { useState, type FormEvent } from 'react';
import { useLogin } from '../../data/auth.js';
import { Field } from './Field.js';

export function LoginForm() {
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password }, { onError: () => setPassword('') });
  };
  return (
    <section className="panel admin-card login-card">
      <h2>เข้าสู่ระบบเพื่อจัดการ</h2>
      <p className="login-note">
        การดูผังไม่ต้องเข้าสู่ระบบ — หน้าจัดการและการรับเรื่องต้องใช้บัญชีที่ผู้ดูแลระบบสร้างให้
      </p>
      <form onSubmit={submit} className="login-form">
        <Field label="อีเมล">
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="รหัสผ่าน">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {login.error && (
          <p className="ferr" role="alert">
            {login.error.message}
          </p>
        )}
        <button type="submit" className="primary" disabled={login.isPending}>
          {login.isPending ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
      <p className="login-note">ลืมรหัสผ่าน: ให้ผู้ดูแลระบบตั้งรหัสใหม่ (user-cli)</p>
    </section>
  );
}
