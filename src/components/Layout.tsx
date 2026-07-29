import { useEffect, useState } from 'react';
import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can, isTeknikPersonel } from '@/lib/rbac';
import { countUnreadNotifications } from '@/lib/queries/notifications';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PullToRefresh } from '@/components/PullToRefresh';
import { PendingApprovalPage } from '@/pages/PendingApprovalPage';
import { cn, formatRole } from '@/lib/utils';

export function Layout() {
  const { profile } = useAuth();
  const location = useLocation();

  const [mobileOpen, setMobileOpen] = useState(false);
  /** Unread Bildirimler count for the bell badge. */
  const [unreadNotifs, setUnreadNotifs] = useState(0);

  // Refresh the unread count on login and on every navigation, so opening
  // Bildirimler → marking read → leaving clears the badge. Cheap HEAD count.
  useEffect(() => {
    if (!profile) {
      setUnreadNotifs(0);
      return;
    }
    countUnreadNotifications()
      .then(setUnreadNotifs)
      .catch(() => {});
  }, [profile, location.pathname]);

  // Close the mobile drawer on Esc + lock body scroll while open.
  useEffect(() => {
    if (!mobileOpen) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', handle);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handle);
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // Desktop NavLink — inline horizontal pill.
  const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
    cn(
      'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
      isActive
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
    );

  // Mobile-drawer NavLink — full-width block, bigger tap target so each item
  // lives on its own row instead of wrapping flow-style alongside neighbors.
  const drawerLinkClasses = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex w-full items-center gap-3 rounded-md px-3 py-3 text-base font-medium transition-colors',
      isActive
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
    );

  // Same icon-button look used for Denetim Kaydı / Çöp Kutusu in both layouts.
  const iconLinkClasses = ({ isActive }: { isActive: boolean }) =>
    cn(
      'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
      isActive
        ? 'border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : 'border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800',
    );

  const closeMobile = () => setMobileOpen(false);

  // The audit + trash icon SVGs as inline JSX. Inline both copies; the
  // duplication is small and avoids a new shared file just for two icons.
  const auditIcon = (
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
  );

  const trashIcon = (
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
  );

  const bellIcon = (
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
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );

  // Nav-item icon paths (feather/Lucide 24-grid). Rendered via navIcon() at the
  // size each surface needs — 16px for the compact desktop pills, 20px for the
  // larger drawer rows. Stroked with currentColor so they inherit the link's
  // active/inactive + dark-mode colors, shrink-0 so a long label never squeezes
  // them.
  const navIconPaths = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </>
    ),
    reservations: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),
    housekeeping: (
      <>
        <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" />
        <path d="M20 3v4" />
        <path d="M22 5h-4" />
        <path d="M4 17v2" />
        <path d="M5 18H3" />
      </>
    ),
    guests: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    properties: (
      <>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </>
    ),
    finance: (
      <>
        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
        <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
      </>
    ),
  };
  const navIcon = (name: keyof typeof navIconPaths, size: number) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {navIconPaths[name]}
    </svg>
  );

  // Unread badge overlaid on the bell (99+ cap keeps it a single glyph wide).
  const unreadBadge =
    unreadNotifs > 0 ? (
      <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
        {unreadNotifs > 99 ? '99+' : unreadNotifs}
      </span>
    ) : null;

  // PENDING signups have no role permissions and are in no RLS allow-list —
  // the app shell would just be empty. Show the holding screen instead.
  if (profile?.role === 'PENDING') {
    return <PendingApprovalPage />;
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <PullToRefresh />
      <header className="border-b border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          {/* Logo — always visible */}
          <Link
            to="/dashboard"
            className="text-lg font-semibold text-emerald-600 dark:text-emerald-500"
          >
            HomeGuru
          </Link>

          {/* Desktop nav (left of right-side actions) — hidden on mobile */}
          <nav className="ml-6 hidden flex-1 items-center gap-1 md:flex">
            <NavLink to="/dashboard" className={navLinkClasses}>
              {navIcon('dashboard', 16)}
              Panel
            </NavLink>
            <NavLink to="/reservations" className={navLinkClasses}>
              {navIcon('reservations', 16)}
              Rezervasyonlar
            </NavLink>
            {profile && can(profile.role, 'housekeeping:read') && (
              <NavLink to="/housekeeping" className={navLinkClasses}>
                {navIcon('housekeeping', 16)}
                Temizlik
              </NavLink>
            )}
            {profile && !isTeknikPersonel(profile.role) && (
              <>
                <NavLink to="/guests" className={navLinkClasses}>
                  {navIcon('guests', 16)}
                  Misafirler
                </NavLink>
                <NavLink to="/properties" className={navLinkClasses}>
                  {navIcon('properties', 16)}
                  Mülkler
                </NavLink>
              </>
            )}
            {profile && can(profile.role, 'finance:read') && (
              <NavLink to="/finance/cash" className={navLinkClasses}>
                {navIcon('finance', 16)}
                Finans
              </NavLink>
            )}
          </nav>

          {/* Desktop right-side actions — hidden on mobile */}
          <div className="hidden items-center gap-3 md:flex">
            <Link
              to="/settings/profile"
              title="Profili düzenle"
              className="rounded px-1 text-sm text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              {profile?.full_name}
              <span className="ml-2 rounded bg-stone-100 px-2 py-0.5 text-xs uppercase text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                {profile?.role ? formatRole(profile.role) : ''}
              </span>
            </Link>
            {profile && (
              <NavLink
                to="/notifications"
                aria-label="Bildirimler"
                title="Bildirimler"
                className={(p) => cn(iconLinkClasses(p), 'relative')}
              >
                {bellIcon}
                {unreadBadge}
              </NavLink>
            )}
            {profile?.role === 'SUPER_ADMIN' && (
              <NavLink
                to="/settings/audit"
                aria-label="Denetim Kaydı"
                title="Denetim Kaydı"
                className={iconLinkClasses}
              >
                {auditIcon}
              </NavLink>
            )}
            {profile?.role === 'SUPER_ADMIN' && (
              <NavLink
                to="/settings/trash"
                aria-label="Çöp Kutusu"
                title="Çöp Kutusu"
                className={iconLinkClasses}
              >
                {trashIcon}
              </NavLink>
            )}
            <ThemeToggle />
          </div>

          {/* Mobile hamburger — visible only on mobile.
              Filled emerald to stand out against the white header and match
              the brand logo on the left. */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Menüyü aç"
            aria-expanded={mobileOpen}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm transition-colors hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:bg-emerald-600 dark:hover:bg-emerald-500 dark:focus:ring-offset-stone-900 md:hidden"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      {/* Mobile drawer.
          h-dvh sits ALONGSIDE inset-0, not instead of it: iOS Safari sizes a
          fixed inset-0 box to the SMALL viewport (toolbar showing), so once the
          toolbar retracts the box stops reaching the bottom and the page's light
          background shows through as an empty strip under the drawer. 100dvh
          tracks the resizing viewport. inset-0 stays as the fallback — a browser
          without dvh support drops the height declaration and keeps today's
          top/bottom sizing rather than collapsing the drawer to nothing. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 h-dvh md:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeMobile}
            aria-hidden="true"
          />
          <aside
            className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-xl dark:bg-stone-900"
          >
            {/* Drawer header: user (tap → profile) + close */}
            <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-700">
              <NavLink
                to="/settings/profile"
                onClick={closeMobile}
                className="-mx-2 min-w-0 rounded px-2 py-1 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                  {profile?.full_name}
                </p>
                <span className="mt-1 inline-block rounded bg-stone-100 px-2 py-0.5 text-xs uppercase text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                  {profile?.role ? formatRole(profile.role) : ''}
                </span>
              </NavLink>
              <button
                type="button"
                onClick={closeMobile}
                aria-label="Menüyü kapat"
                className="rounded p-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {/* Drawer nav links — one per row */}
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              <NavLink to="/dashboard" className={drawerLinkClasses} onClick={closeMobile}>
                {navIcon('dashboard', 20)}
                Panel
              </NavLink>
              <NavLink
                to="/reservations"
                className={drawerLinkClasses}
                onClick={closeMobile}
              >
                {navIcon('reservations', 20)}
                Rezervasyonlar
              </NavLink>
              {profile && can(profile.role, 'housekeeping:read') && (
                <NavLink
                  to="/housekeeping"
                  className={drawerLinkClasses}
                  onClick={closeMobile}
                >
                  {navIcon('housekeeping', 20)}
                  Temizlik
                </NavLink>
              )}
              {profile && !isTeknikPersonel(profile.role) && (
                <>
                  <NavLink to="/guests" className={drawerLinkClasses} onClick={closeMobile}>
                    {navIcon('guests', 20)}
                    Misafirler
                  </NavLink>
                  <NavLink to="/properties" className={drawerLinkClasses} onClick={closeMobile}>
                    {navIcon('properties', 20)}
                    Mülkler
                  </NavLink>
                </>
              )}
              {profile && can(profile.role, 'finance:read') && (
                <NavLink
                  to="/finance/cash"
                  className={drawerLinkClasses}
                  onClick={closeMobile}
                >
                  {navIcon('finance', 20)}
                  Finans
                </NavLink>
              )}
            </nav>

            {/* Drawer footer: admin shortcuts + theme */}
            <div className="flex items-center justify-between gap-3 border-t border-stone-200 px-3 py-3 dark:border-stone-700">
              <div className="flex items-center gap-2">
                {profile?.role === 'SUPER_ADMIN' && (
                  <NavLink
                    to="/settings/audit"
                    aria-label="Denetim Kaydı"
                    title="Denetim Kaydı"
                    onClick={closeMobile}
                    className={iconLinkClasses}
                  >
                    {auditIcon}
                  </NavLink>
                )}
                {profile?.role === 'SUPER_ADMIN' && (
                  <NavLink
                    to="/settings/trash"
                    aria-label="Çöp Kutusu"
                    title="Çöp Kutusu"
                    onClick={closeMobile}
                    className={iconLinkClasses}
                  >
                    {trashIcon}
                  </NavLink>
                )}
                {profile && (
                  <NavLink
                    to="/notifications"
                    aria-label="Bildirimler"
                    title="Bildirimler"
                    onClick={closeMobile}
                    className={(p) => cn(iconLinkClasses(p), 'relative')}
                  >
                    {bellIcon}
                    {unreadBadge}
                  </NavLink>
                )}
              </div>
              {/* Outside the shortcuts group on purpose: as the row's second
                  child it gives the wrapper's justify-between something to push
                  against, so the theme toggle sits at the far right edge
                  instead of trailing the icons on the left. */}
              <ThemeToggle />
            </div>
          </aside>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
