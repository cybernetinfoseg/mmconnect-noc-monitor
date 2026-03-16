import React, { useRef, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { resolvePermissions } from '@/components/auth/usePermissions.jsx';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from './utils';
import { AnimatePresence, motion } from 'framer-motion';
import { 
  LayoutDashboard, 
  Monitor, 
  History, 
  AlertTriangle,
  Tv,
  Menu,
  Building2,
  ChevronLeft,
  Bell,
  Shield,
  Settings,
  ClipboardList,
  LogOut,
  User,
  Wrench,
  FileBarChart2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import PushNotificationManager from './components/notifications/PushNotificationManager';
import PendingApproval from './components/auth/PendingApproval';
import { useRequireAuth } from './components/auth/useRequireAuth';

const ALL_NAV_ITEMS = [
  { name: 'Dashboard', page: 'Dashboard', icon: LayoutDashboard },
  { name: 'Modo TV', page: 'TVMode', icon: Tv },
  { name: 'Terminais', page: 'Terminais', icon: Monitor },
  { name: 'Clientes', page: 'Clientes', icon: Building2 },
  { name: 'Histórico', page: 'History', icon: History },
  { name: 'Incidentes', page: 'Incidents', icon: AlertTriangle },
  { name: 'Alertas', page: 'Alertas', icon: Bell },
  { name: 'Mensagens', page: 'Mensagens', icon: Bell },
  { name: 'Manutenção', page: 'Manutencao', icon: Wrench },
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
];

// Root pages (no back button)
const rootPages = ['Dashboard', 'TVMode'];

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const prevPageRef = useRef(currentPageName);
  const [currentUser, setCurrentUser] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const isPublicPage = currentPageName === 'TVMode';
  const isProfilePage = currentPageName === 'CompletarPerfil';

  // Apply dark mode on mount
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

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

  // Determine slide direction for page transitions
  const pageOrder = ['Dashboard', 'Terminais', 'Clientes', 'History', 'Incidents', 'Configuracoes'];
  const prevIndex = pageOrder.indexOf(prevPageRef.current);
  const currIndex = pageOrder.indexOf(currentPageName);
  const direction = currIndex >= prevIndex ? 1 : -1;
  prevPageRef.current = currentPageName;

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
            ? "bg-accent text-accent-foreground shadow-lg shadow-accent/30"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        )}
      >
        <Icon className={cn(
          "h-5 w-5",
          isActive ? "text-accent-foreground" : "text-muted-foreground"
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
    <div className="flex flex-col h-full bg-card text-card-foreground">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent rounded-xl">
            <Monitor className="h-6 w-6 text-accent-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-foreground">NOC Monitor</h1>
            <p className="text-xs text-muted-foreground">Terminais Biométricos</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto scrollbar-thin scrollbar-thumb-accent/50 scrollbar-track-card">
        {navItems.map((item) => (
          <NavLink key={item.page} item={item} onClick={onClose} />
        ))}
      </nav>
      <div className="p-4 border-t border-border space-y-2">
        <PushNotificationManager />
        {currentUser && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{currentUser.full_name || currentUser.email}</p>
              <p className="text-[10px] text-muted-foreground truncate">{currentUser.email}</p>
            </div>
          </div>
        )}
        <button
          onClick={() => base44.auth.logout()}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
        <p className="text-xs text-muted-foreground text-center">Enterprise NOC v1.0</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:block lg:w-64 lg:bg-card lg:border-r lg:border-border">
        <Sidebar />
      </aside>

      {/* Mobile Header */}
      <header
        className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-card border-b border-border px-4"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            {!isRoot && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => window.history.back()}
                className="select-none"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-accent rounded-lg">
                <Monitor className="h-4 w-4 text-accent-foreground" />
              </div>
              <h1 className="font-bold text-foreground text-sm">NOC Monitor</h1>
            </div>
          </div>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="select-none">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 border-r border-border bg-card">
              <Sidebar />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Main Content */}
      <main className="lg:pl-64 min-h-screen">
        {/* Desktop: no animation */}
        <div className="hidden lg:block pt-0 pb-0">
          {children}
        </div>
        {/* Mobile: slide animation */}
        <div className="lg:hidden pt-14 pb-20">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={currentPageName}
              custom={direction}
              initial={{ x: direction * 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: direction * -40, opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeInOut' }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-stretch">
          {bottomNavItems.map((item) => {
                const isActive = currentPageName === item.page;
                const Icon = item.icon;
                return (
                  <button
                    key={item.page}
                    onClick={() => navigate(createPageUrl(item.page), { replace: isActive })}
                    className={cn(
                      "flex-1 flex flex-col items-center justify-center py-2 gap-1 select-none transition-colors",
                      isActive
                        ? "text-accent"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-[10px] font-medium">{item.name}</span>
                  </button>
                );
              })}
        </div>
      </nav>
    </div>
  );
}