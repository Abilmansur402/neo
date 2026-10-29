import { useEffect, useState } from 'react';
import Landing from './components/Landing.jsx';
import AuthModal from './components/AuthModal.jsx';
import DoctorPortal from './components/portals/DoctorPortal.jsx';
import AnalystPortal from './components/portals/AnalystPortal.jsx';
import MotherPortal from './components/portals/MotherPortal.jsx';
import { I18nProvider } from './lib/i18n.jsx';
import { api } from './services/api.js';

/** Role → portal. Each portal has its own navigation and only calls endpoints its role is allowed to use. */
const PORTAL = { neonatologist: DoctorPortal, analyst: AnalystPortal, researcher: AnalystPortal, admin: AnalystPortal, mother: MotherPortal };

export default function App() {
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [preset, setPreset] = useState(null);

  useEffect(() => { if (api.token) api.me().then(setUser).catch(() => api.setToken(null)); }, []);
  const logout = () => { api.logout(); setUser(null); };

  return (
    <I18nProvider>
      {user ? (() => { const Portal = PORTAL[user.role] || DoctorPortal; return <Portal user={user} onLogout={logout} />; })() : (
        <>
          <Landing onLaunch={(role) => { setPreset(role || null); setAuthOpen(true); }} />
          {authOpen && <AuthModal preset={preset} onEnter={(u) => { setUser(u); setAuthOpen(false); }} onClose={() => setAuthOpen(false)} />}
        </>
      )}
    </I18nProvider>
  );
}
