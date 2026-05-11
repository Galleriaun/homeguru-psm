import { useAuth } from '@/hooks/useAuth';

export function DashboardPage() {
  const { profile } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hoş geldiniz, {profile?.full_name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Rolünüz: <strong>{profile?.role}</strong>
        </p>
      </div>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="text-lg font-semibold">Sprint 0 tamamlandı</h2>
        <p className="mt-2 text-sm text-slate-600">
          Bu Sprint 1'in başlangıç noktasıdır. Rezervasyon takvimi, müsaitlik arama ve hızlı
          rezervasyon formu buradan eklenecek.
        </p>
      </section>
    </div>
  );
}
