import type { TerritoriosClient } from '../client';
import { TerritoryRow, TerritoryUpdate } from '../schemas';
import { casUpdate, from, parsePayload, parseRows, run } from './base';

export async function fetchTerritories(sb: TerritoriosClient): Promise<TerritoryRow[]> {
  const data = await run(from(sb, 'territories').select('*').order('id'));
  return parseRows('territories', TerritoryRow, data);
}

export async function updateTerritory(
  sb: TerritoriosClient,
  id: number,
  expectedVersion: number,
  patch: TerritoryUpdate,
): Promise<TerritoryRow> {
  const body = parsePayload('territories', TerritoryUpdate, patch);
  return casUpdate(sb, 'territories', TerritoryRow, { id }, expectedVersion, body);
}
