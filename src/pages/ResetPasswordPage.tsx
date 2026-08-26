import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { translateAuthError } from '@/lib/utils';

/**
 * Landing page for the "Şifremi unuttum?" email link (LoginPage → forgot
 * mode → resetPasswordForEmail). Also reachable by any already-signed-in
 * staff member simply by navigating here — see the note below on why that
 * is intentional, not a gap.
 *
 * How the session gets here: the emailed link points back at this route with
 * `#access_token=...&type=recovery` in the URL hash. supabase-js's client-side
 * `detectSessionInUrl` (enabled in src/lib/supabase.ts specifically for this)
 * parses that hash on load, establishes a real session from it, and clears the
 * hash — all before this component's first render, so by the time we read
 * `useAuth()` below the session (if the link was valid) is already in place.
 *
 * Gating on plain session presence (`user`), not on catching the one-time
 * "PASSWORD_RECOVERY" event: that event fires exactly once, when the hash is
 * first parsed. If the user refreshes this tab afterwards, the session is
 * still valid (it persists to localStorage like any other), but the event is
 * gone — gating on it would show "geçersiz bağlantı" to someone still
 * legitimately mid-flow. Gating on the session itself survives a refresh
 * correctly, and is also why a logged-in user can reach this same form
 * directly: they already hold a valid session, which is the same proof of
 * ownership the recovery link provides — no weaker, so no extra check needed.
 */
export function ResetPasswordPage() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [returning, setReturning] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Şifreler eşleşmiyor.');
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(translateAuthError(updateError.message));
      return;
    }
    setDone(true);
  };

  // After a successful change, never leave the recovery session signed in —
  // send the user back to /login to prove the new password works end to end,
  // same as the change-password confirmation flow this mirrors elsewhere.
  const handleReturnToLogin = async () => {
    setReturning(true);
    await signOut();
    navigate('/login', { replace: true });
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50 text-stone-600 dark:bg-stone-950 dark:text-stone-300">
        Yükleniyor…
      </div>
    );
  }

  const card =
    'w-full max-w-sm rounded-lg border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700 dark:bg-stone-900';

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
        <div className={card}>
          <h1 className="mb-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-500">
            HomeGuru
          </h1>
          <p className="mt-4 text-sm text-stone-700 dark:text-stone-300">
            Bu bağlantı geçersiz veya süresi dolmuş. Şifre sıfırlama bağlantıları
            tek kullanımlıktır ve bir süre sonra geçerliliğini yitirir.
          </p>
          <button
            type="button"
            onClick={() => navigate('/login', { state: { mode: 'forgot' }, replace: true })}
            className="mt-6 w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white transition-colors hover:bg-emerald-700"
          >
            Yeni Bağlantı İste
          </button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
        <div className={card}>
          <h1 className="mb-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-500">
            HomeGuru
          </h1>
          <p className="mt-4 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            Şifreniz başarıyla güncellendi.
          </p>
          <button
            type="button"
            onClick={handleReturnToLogin}
            disabled={returning}
            className="mt-6 w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {returning ? 'Yönlendiriliyor…' : 'Giriş Yap'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
      <form onSubmit={handleSubmit} noValidate className={card}>
        <h1 className="mb-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-500">
          HomeGuru
        </h1>
        <p className="mb-6 text-sm text-stone-600 dark:text-stone-300">Yeni şifre belirleyin</p>

        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
          Yeni Şifre
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-stone-900 placeholder-stone-400 focus:border-emerald-500 focus:outline-none dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder-stone-500"
          />
          <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
            En az 6 karakter.
          </span>
        </label>

        <label className="mt-4 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Şifreyi Doğrula
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-stone-900 placeholder-stone-400 focus:border-emerald-500 focus:outline-none dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder-stone-500"
          />
        </label>

        {error && (
          <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? 'Kaydediliyor…' : 'Şifreyi Kaydet'}
        </button>
      </form>
    </div>
  );
}
