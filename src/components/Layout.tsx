import { useState } from 'react';
import { Outlet, Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn } from '@/lib/utils';

export function Layout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
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
      <header className="border-b border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
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
              <NavLink to="/reservations" className={navLinkClasses}>
                Rezervasyonlar
              </NavLink>
              {profile && can(profile.role, 'housekeeping:read') && (
                <NavLink to="/housekeeping" className={navLinkClasses}>
                  Temizlik
                </NavLink>
              )}
              <NavLink to="/guests" className={navLinkClasses}>
                Misafirler
              </NavLink>
              <NavLink to="/properties" className={navLinkClasses}>
                Mülkler
              </NavLink>
              {profile && can(profile.role, 'finance:read') && (
                <NavLink to="/finance/cash" className={navLinkClasses}>
                  Finans
                </NavLink>
              )}
              {profile &&
                (profile.role === 'SUPER_ADMIN' ||
                  profile.role === 'PROPERTY_MANAGER' ||
                  profile.role === 'RECEPTION') && (
                  <NavLink to="/kbs" className={navLinkClasses}>
                    KBS
                  </NavLink>
                )}
              {profile && can(profile.role, 'finance:read') && (
                <NavLink to="/settings/templates" className={navLinkClasses}>
                  Şablonlar
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-stone-700 dark:text-stone-300 sm:inline">
              {profile?.full_name}
              <span className="ml-2 rounded bg-stone-100 px-2 py-0.5 text-xs uppercase text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                {profile?.role.replace('_', ' ')}
              </span>
            </span>
            {profile?.role === 'SUPER_ADMIN' && (
              <NavLink
                to="/settings/audit"
                aria-label="Denetim Kaydı"
                title="Denetim Kaydı"
                className={({ isActive }) =>
                  cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
                    isActive
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800',
                  )
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="9" y1="13" x2="15" y2="13" />
                  <line x1="9" y1="17" x2="15" y2="17" />
                </svg>
              </NavLink>
            )}
            {profile?.role === 'SUPER_ADMIN' && (
              <NavLink
                to="/settings/trash"
                aria-label="Çöp Kutusu"
                title="Çöp Kutusu"
                className={({ isActive }) =>
                  cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
                    isActive
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800',
                  )
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                </svg>
              </NavLink>
            )}
            <ThemeToggle />
            <button
              onClick={() => setConfirmSignOut(true)}
              className={cn(
                'rounded-md border px-3 py-1 text-sm transition-colors',
                'border-stone-300 text-stone-700 hover:bg-stone-100',
                'dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-800',
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

      <ConfirmDialog
        open={confirmSignOut}
        title="Çıkış yapılsın mı?"
        description="Oturumunuz kapatılacak ve giriş ekranına yönlendirileceksiniz."
        confirmLabel="Çıkış Yap"
        cancelLabel="Vazgeç"
        destructive
        loading={signingOut}
        onConfirm={handleSignOut}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}
