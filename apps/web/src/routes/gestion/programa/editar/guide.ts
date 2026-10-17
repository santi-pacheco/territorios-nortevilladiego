/**
 * "Traer de la Guía de actividades": merge a week converted from the workbook
 * (`workbookWeekToMidweek`) into the week being edited, and describe what changes.
 *
 * Structure, titles and times come from the Guía. Names are kept where an existing part matches
 * a Guía part and already has people. Parts match by normalized title plus occurrence
 * ("Empiece conversaciones" can appear three times); the opening and closing "Canción N & Oración"
 * match by position, since the song number changes every week. Pure: nothing is saved here.
 */
import type { MidweekPart, MidweekWeek, WorkbookWeek } from '@territorios/core';

export interface GuideProposal {
  week: MidweekWeek;
  /** Human-readable changes, in program order. Empty when the week already matches. */
  changes: string[];
  /** Parts whose names were carried over. */
  keptNames: number;
}

function normalize(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const SONG_PRAYER = /^canci[oó]n\b.*\boraci[oó]n$/i;
const MIDDLE_SONG = /^canci[oó]n(\s+\d+)?$/i;

/** One key per part: songs by role in the meeting, everything else by title + occurrence. */
function partKeys(parts: readonly MidweekPart[]): string[] {
  const seen = new Map<string, number>();
  const prayers = parts.filter((p) => SONG_PRAYER.test(p.title.trim())).length;
  let prayer = 0;
  return parts.map((p) => {
    const title = p.title.trim();
    let base: string;
    if (SONG_PRAYER.test(title)) {
      base = prayer === 0 ? 'cancion-apertura' : prayer === prayers - 1 ? 'cancion-cierre' : 'cancion-oracion';
      prayer += 1;
    } else if (MIDDLE_SONG.test(title)) {
      base = 'cancion-medio';
    } else {
      base = normalize(title);
    }
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}#${n}`;
  });
}

const hasNames = (p: MidweekPart) => p.people.some((q) => q.name.trim() !== '');

function describe(p: MidweekPart): string {
  return p.time ? `${p.time} ${p.title}` : p.title;
}

export function mergeGuide(current: MidweekWeek, guide: MidweekWeek): GuideProposal {
  const curKeys = partKeys(current.parts);
  const byKey = new Map(curKeys.map((k, i) => [k, current.parts[i]!]));
  const used = new Set<string>();
  const changes: string[] = [];
  let keptNames = 0;
  const guideKeys = partKeys(guide.parts);

  const parts = guide.parts.map((g, i) => {
    const key = guideKeys[i]!;
    const old = byKey.get(key);
    if (!old) {
      changes.push(`Se agrega: ${describe(g)}`);
      return { ...g, people: g.people.map((q) => ({ ...q })) };
    }
    used.add(key);
    if (old.title.trim() !== g.title) changes.push(`Cambia el título: ${old.title} → ${g.title}`);
    if (old.time.trim() !== g.time) changes.push(`Cambia la hora de ${g.title}: ${old.time || 'sin hora'} → ${g.time}`);
    if (old.section !== g.section) changes.push(`${g.title} pasa a otra sección`);
    if (hasNames(old)) {
      keptNames += 1;
      return { ...g, people: old.people.map((q) => ({ ...q })) };
    }
    return { ...g, people: g.people.map((q) => ({ ...q })) };
  });

  current.parts.forEach((p, i) => {
    if (used.has(curKeys[i]!)) return;
    const names = p.people.map((q) => q.name.trim()).filter(Boolean);
    changes.push(
      names.length
        ? `Se quita: ${describe(p)} (tenía a ${names.join(', ')})`
        : `Se quita: ${describe(p)}`,
    );
  });

  // A blank week: one line instead of a list of every part.
  if (current.parts.length === 0) {
    return { week: { ...current, parts }, changes: [`Se cargan ${parts.length} partes de la Guía.`], keptNames };
  }
  return { week: { ...current, parts }, changes, keptNames };
}

/** Midweek meetings start at this time; the Guía gives only durations. */
export const MEETING_START = '19:00';

/** A workbook week handed down from "Traer el mes"; `week: null` = not in the Guía. */
export interface GuideDelivery {
  week: WorkbookWeek | null;
  nonce: number;
}
