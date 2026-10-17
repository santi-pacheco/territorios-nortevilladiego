import { useId, useMemo, useState } from 'react';
import { Link2, Search } from 'lucide-react';
import {
  useRole,
  useSession,
  usePeople,
  useSetAccountPermissions,
  type PersonRow,
} from '@territorios/data';
import {
  useAccounts,
  useLinkAccount,
  useSetAccountRole,
  type AccountRole,
  type AccountRow,
} from '../../../lib/accounts';
import { EmptyState, Sheet, TabSkeleton } from '../carrito/ui';
import { filterPeople, sortAccounts } from './model';
import './usuarios.css';

const ROLE_LABEL: Record<AccountRole, string> = {
  viewer: 'Miembro',
  editor: 'Encargado',
  admin: 'Administrador',
};

/**
 * Gestión ▸ Usuarios: link each member's Google account to their name in the roster so
 * "Mis asignaciones" and the reminders find them. Admins also set roles.
 */
export function GestionUsuarios() {
  const accounts = useAccounts();
  const roster = usePeople();
  const { role } = useRole();
  const me = useSession().data?.user.id ?? null;
  const isAdmin = role === 'admin';
  const [picking, setPicking] = useState<AccountRow | null>(null);

  const list = useMemo(() => sortAccounts(accounts.data ?? []), [accounts.data]);
  const unlinked = list.filter((a) => !a.person_id).length;
  const linkedTo = useMemo(() => {
    const map = new Map<string, AccountRow>();
    for (const a of list) if (a.person_id) map.set(a.person_id, a);
    return map;
  }, [list]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-title font-bold">Usuarios</h2>
        {accounts.data && (
          <p className="text-secondary text-ink-soft">
            {list.length === 1 ? '1 cuenta' : `${list.length} cuentas`}
            {unlinked > 0 && ` · ${unlinked} sin vincular`}
          </p>
        )}
      </div>

      {accounts.isPending ? (
        <TabSkeleton />
      ) : accounts.isError && !accounts.data ? (
        <EmptyState
          title="No pudimos cargar las cuentas"
          body="Revisá la conexión y reintentá. Solo los encargados ven esta lista."
        >
          <button type="button" className="btn-secondary" onClick={() => void accounts.refetch()}>
            Reintentar
          </button>
        </EmptyState>
      ) : list.length === 0 ? (
        <EmptyState
          title="Todavía no entró nadie"
          body="Cuando un miembro entre con Google, su cuenta aparece acá para vincularla con su nombre."
        />
      ) : (
        <ul className="flex flex-col border-t border-line">
          {list.map((account) => (
            <AccountItem
              key={account.user_id}
              account={account}
              isAdmin={isAdmin}
              isSelf={account.user_id === me}
              onPick={() => setPicking(account)}
            />
          ))}
        </ul>
      )}

      {picking && (
        <PersonPicker
          account={picking}
          people={roster.data?.people ?? null}
          peopleError={roster.isError && !roster.data}
          linkedTo={linkedTo}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

function AccountItem({
  account,
  isAdmin,
  isSelf,
  onPick,
}: {
  account: AccountRow;
  isAdmin: boolean;
  isSelf: boolean;
  onPick: () => void;
}) {
  const setRole = useSetAccountRole();
  const roleId = useId();
  const name = account.display_name ?? account.email ?? 'Sin nombre';
  const provider = account.provider === 'google' ? 'Google' : account.provider === 'email' ? 'Correo' : null;

  return (
    <li className="usr-row">
      <div className="min-w-0">
        <p className="text-body-strong font-semibold break-words">
          {name}
          {isSelf && <span className="font-normal text-ink-soft"> (vos)</span>}
        </p>
        <p className="text-secondary break-words text-ink-soft">
          {[account.display_name ? account.email : null, provider].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="usr-controls">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-secondary text-ink-soft">Persona</span>
          {account.person_id ? (
            <button
              type="button"
              className="btn-secondary usr-person"
              onClick={onPick}
              aria-label={`Persona: ${account.person_name ?? 'vinculada'}. Cambiar`}
            >
              <span className="truncate">{account.person_name ?? 'Vinculada'}</span>
              <span className="usr-person-action">Cambiar</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary inline-flex items-center justify-center gap-2"
              onClick={onPick}
            >
              <Link2 aria-hidden size={18} />
              Vincular
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={roleId} className="text-secondary text-ink-soft">
            Rol
          </label>
          {isAdmin ? (
            <select
              id={roleId}
              className="field"
              value={setRole.isPending ? setRole.variables.role : account.role}
              disabled={setRole.isPending}
              onChange={(e) =>
                setRole.mutate({ userId: account.user_id, role: e.target.value as AccountRole })
              }
            >
              {(Object.keys(ROLE_LABEL) as AccountRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          ) : (
            <p id={roleId} className="flex min-h-touch items-center text-body">
              {ROLE_LABEL[account.role]}
            </p>
          )}
        </div>
      </div>

      {isAdmin && <PermissionSwitches account={account} />}

      {setRole.isError && (
        <p role="alert" className="usr-error text-secondary text-danger">
          {roleError(setRole.error)}
        </p>
      )}
    </li>
  );
}

/**
 * Admin grants for members: the stored flags from list_accounts (an editor or admin can edit
 * both anyway, which the note says). Each switch sends only its own flag (null = unchanged).
 */
function PermissionSwitches({ account }: { account: AccountRow }) {
  const setPermissions = useSetAccountPermissions();
  const pending = setPermissions.isPending ? setPermissions.variables : null;
  const programa = pending?.programa ?? account.can_edit_programa;
  const privilegios = pending?.privilegios ?? account.can_edit_privilegios;
  const isStaff = account.role !== 'viewer';

  function toggle(flag: 'programa' | 'privilegios', value: boolean) {
    if (setPermissions.isPending) return;
    setPermissions.mutate({
      userId: account.user_id,
      programa: flag === 'programa' ? value : null,
      privilegios: flag === 'privilegios' ? value : null,
    });
  }

  return (
    <div className="usr-perms">
      <div className="usr-switches" role="group" aria-label={`Permisos de ${account.display_name ?? account.email ?? 'esta cuenta'}`}>
        <PermissionSwitch
          label="Puede editar programa"
          checked={programa}
          busy={setPermissions.isPending}
          onChange={(v) => toggle('programa', v)}
        />
        <PermissionSwitch
          label="Puede editar privilegios"
          checked={privilegios}
          busy={setPermissions.isPending}
          onChange={(v) => toggle('privilegios', v)}
        />
      </div>
      {isStaff && (
        <p className="text-secondary text-ink-soft">
          Como {ROLE_LABEL[account.role].toLowerCase()} ya puede editar los dos.
        </p>
      )}
      {setPermissions.isError && (
        <p role="alert" className="text-secondary text-danger">
          {errorCode(setPermissions.error) === '42501'
            ? 'Solo un administrador puede cambiar permisos.'
            : 'No se pudo guardar el permiso. Revisá la conexión y volvé a intentar.'}
        </p>
      )}
    </div>
  );
}

function PermissionSwitch({
  label,
  checked,
  busy,
  onChange,
}: {
  label: string;
  checked: boolean;
  busy: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="usr-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-disabled={busy || undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function roleError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('último administrador')) return 'Tiene que quedar al menos un administrador.';
  if (errorCode(error) === '42501') return 'Solo un administrador puede cambiar roles.';
  return 'No se pudo cambiar el rol. Revisá la conexión y volvé a intentar.';
}

const errorCode = (error: unknown) => (error as { code?: unknown } | null)?.code;

function linkError(error: unknown): string {
  if (errorCode(error) === '23505') return 'Esa persona ya está vinculada a otra cuenta.';
  return 'No se pudo guardar. Revisá la conexión y volvé a intentar.';
}

/** Searchable single choice over the roster, with "Sin vincular" to unlink. */
function PersonPicker({
  account,
  people,
  peopleError,
  linkedTo,
  onClose,
}: {
  account: AccountRow;
  people: PersonRow[] | null;
  peopleError: boolean;
  linkedTo: Map<string, AccountRow>;
  onClose: () => void;
}) {
  const link = useLinkAccount();
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<string | null>(account.person_id);
  const searchId = useId();
  const shown = useMemo(() => filterPeople(people ?? [], query), [people, query]);
  const title = `Vincular a ${account.display_name ?? account.email ?? 'esta cuenta'}`;

  function save() {
    if (choice === account.person_id) return onClose();
    link.mutate({ userId: account.user_id, personId: choice }, { onSuccess: onClose });
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label htmlFor={searchId} className="text-secondary text-ink-soft">
          Buscar en las personas
        </label>
        <div className="usr-search">
          <Search aria-hidden size={20} />
          <input
            id={searchId}
            type="search"
            className="field w-full"
            value={query}
            autoComplete="off"
            placeholder="Nombre o apellido"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {people === null ? (
          peopleError ? (
            <p className="text-body text-danger">No pudimos cargar las personas. Cerrá y reintentá.</p>
          ) : (
            <TabSkeleton />
          )
        ) : (
          <fieldset className="usr-options">
            <legend className="sr-only">Persona</legend>
            <Option
              checked={choice === null}
              onSelect={() => setChoice(null)}
              label="Sin vincular"
              note="La cuenta no ve asignaciones"
            />
            {shown.map((p) => {
              const other = linkedTo.get(p.id);
              const taken = other !== undefined && other.user_id !== account.user_id;
              return (
                <Option
                  key={p.id}
                  checked={choice === p.id}
                  disabled={taken}
                  onSelect={() => setChoice(p.id)}
                  label={p.name}
                  note={taken ? `Ya vinculada a ${other.display_name ?? other.email ?? 'otra cuenta'}` : null}
                />
              );
            })}
            {shown.length === 0 && (
              <p className="px-3 py-3 text-secondary text-ink-soft">
                Nadie coincide con “{query.trim()}”. Agregá a la persona en Gestión ▸ Personas.
              </p>
            )}
          </fieldset>
        )}

        {link.isError && (
          <p role="alert" className="text-secondary text-danger">
            {linkError(link.error)}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" disabled={link.isPending || people === null} onClick={save}>
            {link.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function Option({
  checked,
  disabled = false,
  onSelect,
  label,
  note,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  label: string;
  note: string | null;
}) {
  return (
    <label className="usr-option" data-disabled={disabled || undefined}>
      <input type="radio" name="persona" checked={checked} disabled={disabled} onChange={onSelect} />
      <span className="min-w-0">
        <span className="block break-words">{label}</span>
        {note && <span className="block text-secondary text-ink-soft">{note}</span>}
      </span>
    </label>
  );
}

export default GestionUsuarios;
