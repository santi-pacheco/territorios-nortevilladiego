import { useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ListChecks, Mic, UserRound, X } from 'lucide-react';
import { useMyPermissions, useRole, useSession, withDb } from '@territorios/data';
import { readTheme, saveTheme, type ThemeChoice } from '../lib/theme';
import { readMe, saveMe } from '../lib/me';
import { deleteWebPushSubscription, useMyLink } from '../lib/accounts';
import { currentSubscription } from '../lib/push';
import { useBoot } from './bootContext';
import { GoogleButton } from './GoogleButton';
import './account.css';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'sol', label: 'Sol' },
];

export function AccountButton() {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label="Tu cuenta y ajustes"
        onClick={() => ref.current?.showModal()}
      >
        <UserRound aria-hidden size={24} />
      </button>
      <dialog ref={ref} className="sheet" aria-labelledby="account-title">
        <AccountSheetBody onClose={() => ref.current?.close()} />
      </dialog>
    </>
  );
}

function AccountSheetBody({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [me, setMe] = useState(readMe);
  const meId = useId();
  const session = useSession();
  const { isEditor } = useRole();
  const signedIn = Boolean(session.data);
  const link = useMyLink();
  const linkedName = link.data?.person_name ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 id="account-title" className="text-heading font-bold">
          Ajustes
        </h2>
        <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
          <X aria-hidden size={24} />
        </button>
      </div>

      {signedIn ? (
        <SignedIn
          email={session.data?.user.email ?? ''}
          linkedName={linkedName}
          isEditor={isEditor}
          onClose={onClose}
        />
      ) : (
        <section className="flex flex-col gap-2">
          <h3 className="text-body-strong font-semibold">Tus asignaciones</h3>
          <p className="text-secondary text-ink-soft">
            Entrá para ver tus turnos, partes y salidas, y recibir recordatorios.
          </p>
          <GoogleButton className="mt-1" />
        </section>
      )}

      {linkedName ? null : (
        <section className="flex flex-col gap-2">
          <label htmlFor={meId} className="text-body-strong font-semibold">
            Soy…
          </label>
          <input
            id={meId}
            className="field"
            value={me}
            autoComplete="name"
            placeholder="Tu nombre como figura en los programas"
            onChange={(e) => {
              setMe(e.target.value);
              saveMe(e.target.value);
            }}
          />
          <p className="text-secondary text-ink-soft">
            Resaltamos tus turnos y partes. Tu nombre queda solo en este teléfono.
          </p>
        </section>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-body-strong font-semibold">Apariencia</legend>
        <div className="segmented" role="radiogroup">
          {THEMES.map((t) => (
            <label key={t.value} className="segmented-item">
              <input
                type="radio"
                name="theme"
                value={t.value}
                checked={theme === t.value}
                onChange={() => {
                  setTheme(t.value);
                  saveTheme(t.value);
                }}
              />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
        <p className="text-secondary text-ink-soft">“Sol” sube el contraste para leer al aire libre.</p>
      </fieldset>

      {!signedIn && (
        <details className="encargado border-t border-line pt-3">
          <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 text-body-strong font-semibold">
            Soy encargado
            <ChevronDown aria-hidden size={20} className="encargado-chevron" />
          </summary>
          <SignInForm />
        </details>
      )}
    </div>
  );
}

function SignedIn({
  email,
  linkedName,
  isEditor,
  onClose,
}: {
  email: string;
  linkedName: string | null;
  isEditor: boolean;
  onClose: () => void;
}) {
  const { clearPersisted } = useBoot();
  const qc = useQueryClient();
  // Members granted "Puede editar programa/privilegios" also get Gestión (only those sections).
  const perms = useMyPermissions().data;
  const opensGestion = isEditor || perms?.can_edit_programa === true || perms?.can_edit_privilegios === true;
  return (
    <section className="flex flex-col gap-3">
      <div>
        {linkedName && <p className="text-body-strong font-semibold">{linkedName}</p>}
        <p className="text-secondary break-words text-ink-soft">
          {linkedName ? email : `Sesión iniciada como ${email}`}
        </p>
        {linkedName && (
          <p className="mt-1 text-secondary text-ink-soft">
            Resaltamos tus turnos y partes con este nombre.
          </p>
        )}
      </div>
      <Link
        to="/mis-asignaciones"
        className={`${isEditor ? 'btn-secondary' : 'btn-primary'} inline-flex items-center justify-center gap-2`}
        onClick={onClose}
      >
        <ListChecks aria-hidden size={20} />
        Mis asignaciones
      </Link>
      {perms?.sees_privilegios && (
        <Link
          to="/privilegios"
          className="btn-secondary inline-flex items-center justify-center gap-2"
          onClick={onClose}
        >
          <Mic aria-hidden size={20} />
          Privilegios
        </Link>
      )}
      {opensGestion && (
        <Link to="/gestion" className="btn-primary text-center" onClick={onClose}>
          Abrir gestión
        </Link>
      )}
      <button
        type="button"
        className="btn-secondary"
        onClick={async () => {
          // Reminders belong to the account: stop them on this device before leaving it.
          const sub = await currentSubscription().catch(() => null);
          if (sub) {
            await withDb((sb) => deleteWebPushSubscription(sb, JSON.stringify(sub))).catch(() => {});
            await sub.unsubscribe().catch(() => false);
          }
          await withDb((sb) => sb.auth.signOut());
          await clearPersisted();
          qc.clear();
        }}
      >
        Cerrar sesión
      </button>
    </section>
  );
}

function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailId = useId();
  const passId = useId();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const { error: err } = await withDb((sb) => sb.auth.signInWithPassword({
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    })).catch(() => ({ error: { status: 0 } }));
    setBusy(false);
    if (err) {
      setError(
        err.status === 400
          ? 'El correo o la contraseña no coinciden. Revisalos y volvé a intentar.'
          : 'No pudimos conectar. Revisá la conexión y volvé a intentar.',
      );
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 pt-2 pb-1">
      <p className="text-secondary text-ink-soft">Con el correo y la contraseña de encargado.</p>
      <label htmlFor={emailId} className="text-secondary">
        Correo
      </label>
      <input id={emailId} name="email" type="email" required autoComplete="email" className="field" />
      <label htmlFor={passId} className="text-secondary">
        Contraseña
      </label>
      <input
        id={passId}
        name="password"
        type="password"
        required
        autoComplete="current-password"
        className="field"
      />
      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
