import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from './utils';
import { 
  LayoutDashboard, 
  Monitor, 
  History, 
  AlertTriangle,
  Tv,
  Menu,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

const navItems = [
  { name: 'Dashboard', page: 'Dashboard', icon: LayoutDashboard },
  { name: 'Modo TV', page: 'TVMode', icon: Tv },
  { name: 'Histórico', page: 'History', icon: History },
  { name: 'Incidentes', page: 'Incidents', icon: AlertTriangle },
];

export default function Layout({ children, currentPageName }) {
  // TV Mode has its own full-screen layout
  if (currentPageName === 'TVMode') {
    return children;
  }

  const NavLink = ({ item }) => {
    const isActive = currentPageName === item.page;
    const Icon = item.icon;
    
    return (
      <Link
        to={createPageUrl(item.page)}
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
          "text-sm font-medium",
          isActive 
            ? "bg-slate-900 text-white shadow-lg shadow-slate-900/20" 
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        )}
      >
        <Icon className={cn(
          "h-5 w-5",
          isActive ? "text-emerald-400" : "text-slate-400"
        )} />
        {item.name}
      </Link>
    );
  };

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-900 rounded-xl">
            <Monitor className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="font-bold text-slate-900">NOC Monitor</h1>
            <p className="text-xs text-slate-500">Terminais Biométricos</p>
          </div>
        </div>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <NavLink key={item.page} item={item} />
        ))}
      </nav>
      
      {/* Footer */}
      <div className="p-4 border-t border-slate-200">
        <p className="text-xs text-slate-400 text-center">
          Enterprise NOC v1.0
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:block lg:w-64 lg:bg-white lg:border-r lg:border-slate-200">
        <Sidebar />
      </aside>
      
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-900 rounded-xl">
              <Monitor className="h-5 w-5 text-emerald-400" />
            </div>
            <h1 className="font-bold text-slate-900">NOC Monitor</h1>
          </div>
          
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <Sidebar />
            </SheetContent>
          </Sheet>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="lg:pl-64">
        <div className="pt-16 lg:pt-0">
          {children}
        </div>
      </main>
    </div>
  );
}