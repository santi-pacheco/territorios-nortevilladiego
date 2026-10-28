/**
 * Pure helpers for blocking turns: which (slot, date) pairs a week or a single turn covers, and
 * the reason text. No React; covered by `blackouts.test.ts`.
 */
import type { CartBlackoutRow, CartSlotRow } from '@territorios/data';
import { addDaysIso, mondayOfIso } from './model';

export const DEFAULT_REASON = 'Asamblea';
export const REASON_SUGGESTIONS = [
  'Asamblea',
  'Sin carrito',
  'Visita del superintendente',
] as const;
/** Matches the `cart_blackouts_reason_len` check. */
export const REASON_MAX = 60;

/** A whole week (no `slotId`) or a single turn of it. */
export interface BlockScope {
  weekDate: string;
  slotId?: string;
}

/** Trimmed reason, or null when empty (the banner then reads "Sin carrito"). */
export function normalizeReason(reason: string): string | null {
  const text = reason.trim().slice(0, REASON_MAX).trim();
  return text === '' ? null : text;
}

export interface BlockTarget {
  slot_id: string;
  date: string;
}

/** The turns a scope covers that fall inside the period, with their calendar date. */
export function scopeTargets(
  scope: BlockScope,
  slots: readonly Pick<CartSlotRow, 'id' | 'iso_dow'>[],
  startDate: string,
  endDate: string,
): BlockTarget[] {
  const monday = mondayOfIso(scope.weekDate);
  return slots
    .filter((s) => scope.slotId === undefined || s.id === scope.slotId)
    .map((s) => ({ slot_id: s.id, date: addDaysIso(monday, s.iso_dow - 1) }))
    .filter((t) => t.date >= startDate && t.date <= endDate);
}

/** Targets not blocked yet: blocking a week skips the turns that already have a blackout. */
export function toBlock(
  targets: readonly BlockTarget[],
  existing: readonly Pick<CartBlackoutRow, 'slot_id' | 'date'>[],
): BlockTarget[] {
  const taken = new Set(existing.map((b) => `${b.date}|${b.slot_id}`));
  return targets.filter((t) => !taken.has(`${t.date}|${t.slot_id}`));
}

/** The existing blackouts a scope covers (what "Desbloquear" removes). */
export function toUnblock<T extends Pick<CartBlackoutRow, 'slot_id' | 'date'>>(
  targets: readonly BlockTarget[],
  existing: readonly T[],
): T[] {
  const wanted = new Set(targets.map((t) => `${t.date}|${t.slot_id}`));
  return existing.filter((b) => wanted.has(`${b.date}|${b.slot_id}`));
}
