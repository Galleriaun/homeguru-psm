import { Outlet, Link, useNavigate } from 'react-router-dom';
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link
            to="/dashboard"
            className="text-lg font-semibold text-brand-600 dark:text-brand-500"
          >
            HomeGuru
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 dark:text-slate-300 sm:inline">
              {profile?.full_name}
              <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {profile?.role.replace('_', ' ')}
              </span>
            </span>
            <ThemeToggle />
            <button
              onClick={handleSignOut}
              className={cn(
                'rounded-md border px-3 py-1 text-sm transition-colors',
                'border-slate-300 text-slate-700 hover:bg-slate-100',
                'dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800',
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
