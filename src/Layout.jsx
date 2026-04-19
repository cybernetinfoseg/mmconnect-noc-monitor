import React, { useRef, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from './utils';
import {
  LayoutDashboard,
  Monitor,
  History,
  AlertTriangle,
  Tv,
  Menu,
  ChevronLeft,
  Home,
  Bell,
  Shield,
  Settings,
  ClipboardList,
  LogOut,
  User,
  Wrench,
  FileBarChart2,
  CalendarClock,
  MapPin
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

import PendingApproval from './components/auth/PendingApproval';
import { useRequireAuth } from './components/auth/useRequireAuth';
import MobileClock from './components/dashboard/MobileClock';

const ALL_NAV_ITEMS = [
  { name: 'Dashboard', page: 'Dashboard', icon: LayoutDashboard },
  { name: 'Modo TV', page: 'TVMode', icon: Tv },
  { name: 'Terminais', page: 'Terminais', icon: Monitor },
  { name: 'Histórico', page: 'History', icon: History },
  { name: 'Incidentes', page: 'Incidents', icon: AlertTriangle },
  { name: 'Alertas', page: 'Alertas', icon: Bell },
  { name: 'Mapa', page: 'MapaTerminais', icon: MapPin },
  { name: 'Manutenção', page: 'Manutencao', icon: Wrench },
  { name: 'Agendamentos', page: 'Agendamentos', icon: CalendarClock },
  { name: 'Relatórios', page: 'Relatorios', icon: FileBarChart2 },
  { name: 'Auditoria', page: 'Auditoria', icon: ClipboardList },
  { name: 'Configurações', page: 'Configuracoes', icon: Settings },
  { name: 'Administração', page: 'Administracao', icon: Shield },
];

// Pages shown in the bottom bar on mobile
const bottomNavItems = [
  { name: 'Dashboard', page: 'Dashboard', icon: LayoutDashboard },
  { name: 'Terminais', page: 'Terminais', icon: Monitor },
  { name: 'Incidentes', page: 'Incidents', icon: AlertTriangle },
  { name: 'Alertas', page: 'Alertas', icon: Bell },
  { name: 'Menu', page: null, icon: Menu },
];

// Bottom tab pages — these are preserved (not unmounted) when switching tabs
const bottomTabPages = bottomNavItems.filter(i => i.page).map(i => i.page);

// Root pages (no back button)
const rootPages = ['Dashboard', 'TVMode'];

export default function Layout({ children, currentPageName }) {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const isPublicPage = currentPageName === 'TVMode';
  const isProfilePage = currentPageName === 'CompletarPerfil';

  // Enforce login for all pages except TVMode and CompletarPerfil
  const { user: authUser, loading: authLoading } = useRequireAuth({ skip: isPublicPage || isProfilePage });

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const perms = resolvePermissions(currentUser);

  if (currentPageName === 'TVMode') {
    return children;
  }

  // Redirect to profile completion if first access
  if (currentUser && currentUser.primeiroAcesso && currentPageName !== 'CompletarPerfil') {
    return navigate('/CompletarPerfil');
  }

  // Show spinner while checking authentication
  if (authLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  // Not logged in → redirectToLogin already called, show nothing
  if (!authUser) return null;

  // If on profile completion page, just show it without layout
  if (isProfilePage) {
    return children;
  }

  // Admins are always approved; non-admins must have aprovado === true
  const isPending = currentUser && currentUser.role !== 'admin' && !currentUser.aprovado;
  if (isPending) {
    return <PendingApproval user={currentUser} />;
  }

  const isRoot = rootPages.includes(currentPageName);
  // Is current page one of the bottom-tab pages?
  const isBottomTab = bottomTabPages.includes(currentPageName);

  // Page name label for the top bar
  const pageLabel = ALL_NAV_ITEMS.find(i => i.page === currentPageName)?.name ?? currentPageName;

  const NavLink = ({ item, onClick }) => {
    const isActive = currentPageName === item.page;
    const Icon = item.icon;
    return (
      <Link
        to={createPageUrl(item.page)}
        onClick={onClick}
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 select-none",
          "text-sm font-medium",
          isActive
            ? "bg-slate-900 text-white shadow-lg shadow-slate-900/20 dark:bg-emerald-600"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
        )}
      >
        <Icon className={cn(
          "h-5 w-5",
          isActive ? "text-emerald-400 dark:text-white" : "text-slate-400"
        )} />
        {item.name}
      </Link>
    );
  };

  // Filter nav items based on user permissions
  const navItems = ALL_NAV_ITEMS.filter(item => {
    if (!currentUser) return false;
    return perms.paginas_permitidas.includes(item.page);
  });

  const Sidebar = ({ onClose }) => (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      <div className="p-6 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-900 dark:bg-emerald-600 rounded-xl">
            <Monitor className="h-6 w-6 text-emerald-400 dark:text-white" />
          </div>
          <div>
            <h1 className="font-bold text-slate-900 dark:text-white">NOC Monitor</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Terminais Biométricos</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink key={item.page} item={item} onClick={onClose} />
        ))}
      </nav>
      <div className="p-4 border-t border-slate-200 dark:border-slate-700 space-y-2">
        {currentUser && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800">
            <User className="h-4 w-4 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{currentUser.full_name || currentUser.email}</p>
              <p className="text-[10px] text-slate-400 truncate">{currentUser.email}</p>
            </div>
          </div>
        )}
        <button
          onClick={() => base44.auth.logout()}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors select-none"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
        <p className="text-xs text-slate-400 text-center">Enterprise NOC v1.0</p>
      </div>
    </div>
  );

  // Mobile top bar height (used for content offset)
  // Only shown on non-root non-tab pages (pages that are "stacked" views)
  const showMobileTopBar = !isRoot && !isBottomTab;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:block lg:w-64 lg:bg-white lg:border-r lg:border-slate-200 dark:lg:bg-slate-900 dark:lg:border-slate-700">
        <Sidebar />
      </aside>

      {/* Mobile Top Bar — only for non-root, non-bottom-tab pages (stacked pages) */}
      {showMobileTopBar && (
        <header
          className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 select-none"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
          }}
        >
          <div className="flex items-center h-14 px-2 gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              className="select-none h-10 w-10 shrink-0"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="font-semibold text-slate-900 dark:text-white text-sm truncate flex-1">{pageLabel}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              className="select-none h-10 w-10 shrink-0"
              title="Dashboard"
            >
              <Home className="h-5 w-5" />
            </Button>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className="lg:pl-64 min-h-screen">
        {/* Desktop: no animation */}
        <div className="hidden lg:block pt-0 pb-0">
          {children}
        </div>

        {/*
          Mobile content:
          - Bottom-tab pages: rendered all at once (display:none when inactive) to preserve scroll/state
          - Non-tab pages: rendered normally below the top bar
        */}
        <div className="lg:hidden">
          {isBottomTab ? (
            /* Stack preservation: keep all tab pages mounted, show only active */
            <div
              className="pb-20"
              style={{ paddingTop: 'env(safe-area-inset-top)' }}
            >
              {children}
            </div>
          ) : (
            /* Stacked page (non-tab): shown below the top bar */
            <div
              className="pb-20"
              style={{
                paddingTop: showMobileTopBar
                  ? 'calc(3.5rem + env(safe-area-inset-top))'
                  : 'env(safe-area-inset-top)',
              }}
            >
              {children}
            </div>
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <Sheet>
        <nav
          className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 select-none"
          style={{
            paddingBottom: 'env(safe-area-inset-bottom)',
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
          }}
        >
          <div className="flex items-stretch">
            {bottomNavItems.map((item) => {
              const isActive = item.page && currentPageName === item.page;
              const Icon = item.icon;

              // "Menu" tab — relógio ao lado
              if (!item.page) {
                return (
                  <div key="menu" className="flex-1 flex items-center justify-center">
                    {/* Clock beside menu button */}
                    <MobileClock className="mr-1" />
                    <SheetTrigger asChild>
                      <button
                        className={cn(
                          "flex flex-col items-center justify-center py-2 px-2 gap-0 select-none transition-colors",
                          "text-slate-400 dark:text-slate-500 active:text-slate-600"
                        )}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="text-[10px] font-medium">Menu</span>
                      </button>
                    </SheetTrigger>
                  </div>
                );
              }

              return (
                <button
                  key={item.page}
                  onClick={() => {
                    if (isActive) {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    } else {
                      navigate(createPageUrl(item.page));
                    }
                  }}
                  className={cn(
                    "flex-1 flex flex-col items-center justify-center py-2 gap-0 select-none transition-colors",
                    isActive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-slate-400 dark:text-slate-500 active:text-slate-600"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] font-medium">{item.name}</span>
                </button>
              );
            })}
          </div>
        </nav>
        <SheetContent side="left" className="w-64 p-0 border-r border-slate-200 dark:border-slate-700">
          <Sidebar />
        </SheetContent>
      </Sheet>
    </div>
  );
}