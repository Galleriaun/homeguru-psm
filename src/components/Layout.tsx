import { Outlet, Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn } from '@/lib/utils';

export function Layout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
      isActive
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
    );

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link
              to="/dashboard"
              className="text-lg font-semibold text-emerald-600 dark:text-emerald-500"
            >
              HomeGuru
            </Link>
            <nav className="flex items-center gap-1">
              <NavLink to="/dashboard" className={navLinkClasses}>
                Panel
              </NavLink>
              <NavLink to="/properties" className={navLinkClasses}>
                Mülkler
              </NavLink>
              <NavLink to="/guests" className={navLinkClasses}>
                Misafirler
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-stone-700 dark:text-stone-300 sm:inline">
              {profile?.full_name}
              <span className="ml-2 rounded bg-stone-100 px-2 py-0.5 text-xs uppercase text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                {profile?.role.replace('_', ' ')}
              </span>
            </span>
            <ThemeToggle />
            <button
              onClick={handleSignOut}
              className={cn(
                'rounded-md border px-3 py-1 text-sm transition-colors',
                'border-stone-300 text-stone-700 hover:bg-stone-100',
                'dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800',
              )}
            >
              Çıkış
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
