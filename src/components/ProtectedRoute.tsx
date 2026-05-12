import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import type { ReactNode } from 'react';
import type { Role } from '@/types/database';

interface Props {
  children: ReactNode;
  /** Optional: restrict to specific roles. Defaults to any authenticated user. */
  allowedRoles?: Role[];
}

export function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        Yükleniyor…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Profile exists but no role assigned yet — needs admin attention.
  if (!profile) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 px-4 text-center text-red-600 dark:bg-slate-950 dark:text-red-400">
        Hesabınıza henüz bir rol atanmadı. Lütfen yöneticinizle iletişime geçin.
      </div>
    );
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
