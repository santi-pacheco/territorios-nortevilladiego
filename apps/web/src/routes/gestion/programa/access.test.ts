import { describe, expect, it } from 'vitest';
import type { MyPermissions } from '@territorios/data';
import { allowedParts, canEditPart } from './access';

const perms = (over: Partial<MyPermissions> = {}): MyPermissions => ({
  role: 'viewer',
  can_edit_programa_midweek: false,
  can_edit_programa_weekend: false,
  can_edit_privilegios: false,
  sees_privilegios: false,
  ...over,
});

describe('gestión programa access', () => {
  it('lists only the meetings the caller may edit, in order', () => {
    expect(allowedParts(perms())).toEqual([]);
    expect(allowedParts(perms({ can_edit_programa_midweek: true }))).toEqual(['midweek']);
    expect(allowedParts(perms({ can_edit_programa_weekend: true }))).toEqual(['weekend']);
    expect(
      allowedParts(perms({ can_edit_programa_midweek: true, can_edit_programa_weekend: true })),
    ).toEqual(['midweek', 'weekend']);
  });

  it('editors and admins may edit both even before permissions load', () => {
    expect(allowedParts(undefined, true)).toEqual(['midweek', 'weekend']);
    expect(canEditPart(undefined, 'weekend', true)).toBe(true);
  });
});
