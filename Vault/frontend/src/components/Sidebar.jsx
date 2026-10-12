import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  FileCode2,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Receipt,
  Settings,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { useSidebar } from '../context/SidebarContext';
import waFinanceLogo from '../assets/wa-finance-logo.png';

const navGroups = [
  {
    group: 'APLIKASI',
    items: [
      { name: 'Dashboard', icon: LayoutGrid, path: '/' },
      { name: 'Transaksi', icon: Receipt, path: '/expenses' },
      { name: 'Dompet', icon: Wallet, path: '/dompet' },
    ],
  },
  {
    group: 'OPERASIONAL',
    items: [
      { name: 'Gateway WA', icon: Smartphone, path: '/whatsapp' },
      { name: 'Format Balasan', icon: MessageSquare, path: '/conversations' },
      { name: 'Analytic', icon: BarChart3, path: '/analytics' },
      { name: 'Pengaturan', icon: Settings, path: '/settings' },
    ],
  },
];

export default function Sidebar() {
  const { user, signOut } = useAuth();
  const { isCollapsed } = useSidebar();

  return (
    <aside
      className={`app-sidebar hidden h-screen shrink-0 flex-col border-r transition-all duration-300 ease-in-out md:flex ${
        isCollapsed
          ? 'w-[76px] border-[#d6e4be] bg-[#f5faeb] dark:border-[#263e1d] dark:bg-[#0c180e]'
          : 'w-[250px] border-[#d6e4be] bg-[#f5faeb] dark:border-[#263e1d] dark:bg-[#0c180e]'
      }`}
    >
      {/* ── Top Header / Brand ── */}
      <div
        className={`flex items-center ${
          isCollapsed
            ? 'justify-center py-5'
            : 'px-5 pt-6 pb-3'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <img
            src={waFinanceLogo}
            alt="WA Finance"
            className="h-8 w-8 shrink-0 object-contain drop-shadow-[0_0_8px_rgba(52,211,93,0.5)]"
          />
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="truncate text-[15px] font-black tracking-tight text-[#0e2a07] dark:text-[#f3ffe9]">
                WA Finance
              </span>
              <span className="truncate text-[8.5px] font-bold uppercase tracking-wider text-[#358219] dark:text-[#76d446]">
                Gateway Platform
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Navigation Menu ── */}
      <nav className={`flex-1 overflow-y-auto px-3 ${isCollapsed ? 'space-y-2 mt-1' : 'space-y-4 mt-3'}`}>
        {navGroups.map((grp) => (
          <div key={grp.group} className={isCollapsed ? 'space-y-2' : 'space-y-1'}>
            {!isCollapsed && (
              <div className="px-3 pb-1 text-[9.5px] font-black uppercase tracking-wider text-[#436d32] dark:text-[#76d446]/80">
                {grp.group}
              </div>
            )}

            {grp.items.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                title={isCollapsed ? item.name : undefined}
                className={({ isActive }) =>
                  `flex items-center rounded-xl font-bold transition-all ${
                    isCollapsed
                      ? 'h-11 w-11 justify-center mx-auto text-sm'
                      : 'gap-3 px-3.5 py-2 text-[13px]'
                  } ${
                    isActive
                      ? 'bg-[#c3ef92] text-[#0e2a07] shadow-sm dark:bg-[#1a3816] dark:text-[#76d446]'
                      : 'text-slate-700 hover:bg-[#eaf2da] hover:text-[#0e2a07] dark:text-slate-300 dark:hover:bg-[#142616] dark:hover:text-white'
                  }`
                }
              >
                <item.icon className={isCollapsed ? 'h-[20px] w-[20px]' : 'h-[17px] w-[17px] shrink-0'} />
                {!isCollapsed && <span className="truncate">{item.name}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* ── Bottom Profile Card ── */}
      <div className={`mt-auto p-3 ${isCollapsed ? '' : 'border-t border-[#e5eedc] dark:border-[#1d3517]'}`}>
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-2 pb-2">
            <div
              title={user?.displayName || user?.email || 'User'}
              className="user-avatar-pill flex h-9 w-9 items-center justify-center rounded-full bg-white border border-[#d6e4be] text-xs font-black text-[#1a5611] shadow-sm dark:bg-[#1c3520] dark:border-[#263e1d] dark:text-[#76d446]"
            >
              {(user?.displayName || user?.email || 'CH').slice(0, 2).toUpperCase()}
            </div>
            <button
              onClick={signOut}
              title="Keluar"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
            >
              <LogOut width="15" height="15" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-[#d6e4be] bg-[#eaf2da] p-2.5 dark:border-[#263e1d] dark:bg-[#132212]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="user-avatar-pill flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white border border-[#d6e4be] text-xs font-black text-[#1a5611] shadow-sm dark:bg-[#1c3520] dark:border-[#263e1d] dark:text-[#76d446]">
                {(user?.displayName || user?.email || 'CH').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="truncate text-xs font-black text-[#0e2a07] dark:text-[#f3ffe9]">
                  {user?.displayName || user?.email?.split('@')[0] || 'Chris'}
                </span>
                <span className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                  {user?.email || 'User'}
                </span>
              </div>
            </div>
            <button
              onClick={signOut}
              title="Keluar"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
            >
              <LogOut width="15" height="15" />
            </button>
          </div>
        )}

        {!isCollapsed && (
          <div className="mt-2.5 px-1 text-center text-[9.5px] font-semibold leading-tight text-[#436d32]/75 dark:text-[#8bb37a]/60">
            © 2026 WA Finance App created by i729
          </div>
        )}
      </div>
    </aside>
  );
}
