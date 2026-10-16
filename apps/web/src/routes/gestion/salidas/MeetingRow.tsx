import { useId, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { parseTerritoryIds } from '@territorios/core';
import type { GroupTerritories, ServiceMeetingRow, ServiceMeetingUpdate } from '@territorios/data';

const GROUP_KEYS = ['G1', 'G2', 'G3', 'G4'] as const;
type GroupKey = (typeof GROUP_KEYS)[number];

type TextField = 'start_time' | 'place' | 'conductor' | 'groups';

interface Props {
  meeting: ServiceMeetingRow;
  onSave: (patch: ServiceMeetingUpdate) => void;
  onDelete: () => void;
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function groupText(groups: GroupTerritories, key: GroupKey): string {
  return (groups[key] ?? []).join(', ');
}

/**
 * One meeting, editable inline with controlled inputs that commit on blur.
 *
 * Each control keeps a local draft while focused; when it is not being edited it shows the
 * value from the query cache, so a refetch (realtime or our own save) is reflected without
 * clobbering in-progress typing.
 */
export function MeetingRow({ meeting, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<Partial<Record<TextField, string>>>({});
  const [territoryDraft, setTerritoryDraft] = useState<string | null>(null);
  const [groupDrafts, setGroupDrafts] = useState<Partial<Record<GroupKey, string>>>({});
  const [confirming, setConfirming] = useState(false);
  const baseId = useId();

  const isDomingo = meeting.kind === 'domingo';

  function commitText(field: TextField) {
    const value = draft[field];
    setDraft((d) => {
      const rest = { ...d };
      delete rest[field];
      return rest;
    });
    if (value !== undefined && value !== meeting[field]) onSave({ [field]: value });
  }

  function commitTerritories() {
    if (territoryDraft === null) return;
    const ids = parseTerritoryIds(territoryDraft);
    setTerritoryDraft(null);
    if (!sameIds(ids, meeting.territory_ids)) onSave({ territory_ids: ids });
  }

  function commitGroup(key: GroupKey) {
    const raw = groupDrafts[key];
    setGroupDrafts((g) => {
      const rest = { ...g };
      delete rest[key];
      return rest;
    });
    if (raw === undefined) return;
    const ids = parseTerritoryIds(raw);
    if (sameIds(ids, meeting.group_territories[key] ?? [])) return;
    const next: GroupTerritories = { ...meeting.group_territories };
    if (ids.length) next[key] = ids;
    else delete next[key];
    onSave({ group_territories: next });
  }

  const textField = (
    field: TextField,
    label: string,
    opts: { type?: string; placeholder?: string; className?: string } = {},
  ) => {
    const id = `${baseId}-${field}`;
    return (
      <div className={`flex flex-col gap-1 ${opts.className ?? ''}`}>
        <label htmlFor={id} className="text-caption text-ink-soft">
          {label}
        </label>
        <input
          id={id}
          type={opts.type ?? 'text'}
          className="field w-full"
          placeholder={opts.placeholder}
          value={draft[field] ?? meeting[field]}
          onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
          onBlur={() => commitText(field)}
        />
      </div>
    );
  };

  return (
    <article className="rounded-md border border-line bg-surface px-4 py-3">
      {confirming ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body font-semibold">¿Borrar esta salida?</p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" onClick={onDelete}>
              Borrar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-start justify-between gap-2">
            <span className="text-caption text-ink-soft">
              {isDomingo ? 'Domingo · grupos G1–G4' : `Salida ${meeting.position + 1}`}
            </span>
            <button
              type="button"
              className="icon-btn -mt-1 -mr-2"
              aria-label="Borrar salida"
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden size={20} />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {textField('start_time', 'Hora', { type: 'time' })}
            {textField('place', 'Lugar', { placeholder: 'Esquina o dirección' })}
            {textField('conductor', 'Conductor', { placeholder: 'Quién conduce' })}
            {textField('groups', 'Grupos', { placeholder: '1 y 2' })}

            {!isDomingo && (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label htmlFor={`${baseId}-territory`} className="text-caption text-ink-soft">
                  Territorios
                </label>
                <input
                  id={`${baseId}-territory`}
                  type="text"
                  inputMode="numeric"
                  className="field w-full font-mono"
                  placeholder="5, 12 o 5-12"
                  value={territoryDraft ?? meeting.territory_ids.join(', ')}
                  onChange={(e) => setTerritoryDraft(e.target.value)}
                  onBlur={commitTerritories}
                />
              </div>
            )}
          </div>

          {isDomingo && (
            <fieldset className="mt-3 border-t border-line pt-3">
              <legend className="text-caption text-ink-soft">Territorios por grupo</legend>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {GROUP_KEYS.map((key) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label htmlFor={`${baseId}-${key}`} className="font-mono text-caption">
                      {key}
                    </label>
                    <input
                      id={`${baseId}-${key}`}
                      type="text"
                      inputMode="numeric"
                      className="field w-full font-mono"
                      placeholder="1, 2"
                      value={groupDrafts[key] ?? groupText(meeting.group_territories, key)}
                      onChange={(e) => setGroupDrafts((g) => ({ ...g, [key]: e.target.value }))}
                      onBlur={() => commitGroup(key)}
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}
    </article>
  );
}
