import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { signInWithGoogle } from '../lib/accounts';

/** Primary sign-in for members. The page leaves for Google and comes back to /mis-asignaciones. */
export function GoogleButton({ className = '' }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch {
      setBusy(false);
      setError('No pudimos abrir Google. Revisá la conexión y volvé a intentar.');
    }
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <button
        type="button"
        className="btn-primary inline-flex items-center justify-center gap-2"
        disabled={busy}
        onClick={go}
      >
        <LogIn aria-hidden size={20} />
        {busy ? 'Abriendo Google…' : 'Entrar con Google'}
      </button>
      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
