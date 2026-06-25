import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { baseRole } from '@/lib/rbac';
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
      <div className="flex h-screen items-center justify-center bg-stone-50 text-stone-600 dark:bg-stone-950 dark:text-stone-300">
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
      <div className="flex h-screen items-center justify-center bg-stone-50 px-4 text-center text-red-600 dark:bg-stone-950 dark:text-red-400">
        Hesabınıza henüz bir rol atanmadı. Lütfen yöneticinizle iletişime geçin.
      </div>
    );
  }

  // Region-scoped roles (e.g. YONETICI_BORNOVA, PERSONEL_BORNOVA) gate routes as
  // their base role; the region restriction is enforced server-side by RLS.
  if (allowedRoles && !allowedRoles.includes(baseRole(profile.role) as Role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
