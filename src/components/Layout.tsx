import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export function Layout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/dashboard" className="text-lg font-semibold text-brand-600">
            HomeGuru
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">
              {profile?.full_name}
              <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs uppercase">
                {profile?.role.replace('_', ' ')}
              </span>
            </span>
            <button
              onClick={handleSignOut}
              className={cn(
                'rounded-md border border-slate-300 px-3 py-1 text-sm',
                'hover:bg-slate-100',
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
