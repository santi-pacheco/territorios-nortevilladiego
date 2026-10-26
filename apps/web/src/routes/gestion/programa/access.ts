/**
 * Which part of the program a caller may edit (docs/PRIVILEGIOS.md).
 *
 * `my_permissions()` already returns effective flags: editors and admins get both meetings
 * without a stored grant. Pure so the route guard, the tab list and the tests share the rule.
 */
import type { MyPermissions } from '@territorios/data';

export type ProgramaPart = 'midweek' | 'weekend';

export const PROGRAMA_PARTS: readonly ProgramaPart[] = ['midweek', 'weekend'];

export const PART_LABEL: Record<ProgramaPart, string> = {
  midweek: 'Entre semana',
  weekend: 'Fin de semana',
};

export function canEditPart(
  perms: MyPermissions | undefined,
  part: ProgramaPart,
  isEditor = false,
): boolean {
  if (isEditor) return true;
  return part === 'midweek'
    ? perms?.can_edit_programa_midweek === true
    : perms?.can_edit_programa_weekend === true;
}

/** Tabs to show, in order. Empty means the caller has no program grant at all. */
export function allowedParts(
  perms: MyPermissions | undefined,
  isEditor = false,
): ProgramaPart[] {
  return PROGRAMA_PARTS.filter((part) => canEditPart(perms, part, isEditor));
}
