import { useState } from 'react';
import { Heart, Menu, LogOut, Building2, User } from 'lucide-react';
import { Badge } from '../../lib/ui.jsx';
import { useT, LangSwitch } from '../../lib/i18n.jsx';
import { api } from '../../services/api.js';

/** Shared portal chrome: sidebar with portal-specific nav, header with language switch, footer disclaimer. */
export default function Shell({ user, portalLabel, nav, view, setView, title, sub, onLogout, children, accent = '#0F4C81', headerExtra = null }) {
  const { t } = useT();
  const [menu, setMenu] = useState(false);
  const NavList = () => (
    <nav className="grid" aria-label="Sections">
      {nav.map(([id, label, Icon]) => (
        <button key={id} type="button" className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => { setView(id); setMenu(false); }}>
          <span className="w-7 h-7 rounded grid place-items-center border border-line shrink-0" style={{ background: view === id ? accent : '#fff', color: view === id ? '#fff' : '#64748B' }}><Icon size={14} /></span>{label}
        </button>
      ))}
    </nav>
  );
  return (
    <div className="min-h-full md:grid md:grid-cols-[250px_1fr]">
      <aside className="hidden md:flex flex-col gap-6 py-5 border-r border-line sticky top-0 h-screen bg-surface">
        <div className="flex items-center gap-3 px-4"><div className="w-9 h-9 rounded-md grid place-items-center text-white" style={{ background: accent }}><Heart size={18} /></div><div><div className="display font-bold leading-tight">NeoOutcome AI</div><div className="eyebrow">{portalLabel}</div></div></div>
        <NavList />
        <div className="mt-auto mx-4 card p-3 text-xs">
          <div className="flex items-center gap-2 mb-1"><span className={`dot ${api.online ? 'dot-live' : ''}`} style={!api.online ? { background: '#D97706' } : undefined} /><span className="font-semibold">{api.online ? t('online') : t('offline')}</span></div>
          <div className="muted">{user.hospital.name_kz || user.hospital.name}</div>
        </div>
      </aside>
      <div className="min-w-0 flex flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line glass rounded-none border-x-0 border-t-0 px-4 py-2.5">
          <button type="button" className="btn md:hidden px-2" aria-label="Menu" onClick={() => setMenu((m) => !m)}><Menu size={16} /></button>
          <div className="min-w-0 flex-1"><div className="display font-semibold truncate text-[17px]">{title}</div>{sub && <div className="muted text-xs truncate">{sub}</div>}</div>
          {headerExtra}
          <div className="hidden sm:flex items-center gap-2"><Badge tone="primary"><Building2 size={12} />{user.hospital.city}</Badge><Badge tone="violet"><User size={12} />{user.full_name}</Badge></div>
          <LangSwitch />
          <button type="button" className="btn px-2" aria-label={t('signout')} onClick={onLogout}><LogOut size={16} /></button>
        </header>
        {menu && <div className="md:hidden border-b border-line bg-surface py-2"><NavList /></div>}
        <main className="flex-1 min-w-0 px-4 md:px-6 py-5">
          <div className="fade-in" key={view}>{children}</div>
          <footer className="eyebrow mt-8 pt-4 border-t border-line">{t('disclaimer')}</footer>
        </main>
      </div>
    </div>
  );
}
