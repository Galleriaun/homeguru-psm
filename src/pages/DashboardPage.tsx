import { useAuth } from '@/hooks/useAuth';

export function DashboardPage() {
  const { profile } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
          Hoş geldiniz, {profile?.full_name}
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Rolünüz: <strong className="text-stone-700 dark:text-stone-200">{profile?.role}</strong>
        </p>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          Sprint 0 tamamlandı
        </h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Bu Sprint 1'in başlangıç noktasıdır. Rezervasyon takvimi, müsaitlik arama ve hızlı
          rezervasyon formu buradan eklenecek.
        </p>
      </section>
    </div>
  );
}
