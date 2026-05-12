import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center dark:bg-slate-950">
      <h1 className="text-4xl font-bold text-slate-800 dark:text-slate-100">404</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400">Sayfa bulunamadı.</p>
      <Link
        to="/dashboard"
        className="mt-6 rounded-md bg-brand-500 px-4 py-2 text-white transition-colors hover:bg-brand-600"
      >
        Ana sayfaya dön
      </Link>
    </div>
  );
}
