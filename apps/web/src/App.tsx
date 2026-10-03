import { Route, Routes } from 'react-router';
import { AdminHome } from './pages/AdminHome.js';
import { NocShell } from './shell/NocShell.js';

export const SYSTEM_NAME = 'SBC NOC';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<NocShell />} />
      <Route path="/admin/*" element={<AdminHome />} />
      <Route path="*" element={<NocShell />} />
    </Routes>
  );
}
