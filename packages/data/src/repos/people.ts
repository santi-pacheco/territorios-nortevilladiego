/** Carrito roster. Editor/admin only (RLS); viewers get empty arrays, never an error. */
import type { TerritoriosClient } from '../client';
import {
  PersonAvailabilityInsert,
  PersonAvailabilityRow,
  PersonInsert,
  PersonPairInsert,
  PersonPairRow,
  PersonRow,
  PersonUpdate,
} from '../schemas';
import { casDelete, casUpdate, from, insertRow, parsePayload, parseRows, run } from './base';

export interface PeopleRoster {
  people: PersonRow[];
  availability: PersonAvailabilityRow[];
  /** Symmetric must-be-with pairs, stored once with person_a < person_b. */
  pairs: PersonPairRow[];
}

export async function fetchPeople(sb: TerritoriosClient): Promise<PeopleRoster> {
  const [people, availability, pairs] = await Promise.all([
    run(from(sb, 'people').select('*').order('name')),
    run(from(sb, 'person_availability').select('*')),
    run(from(sb, 'person_pairs').select('*')),
  ]);
  return {
    people: parseRows('people', PersonRow, people),
    availability: parseRows('person_availability', PersonAvailabilityRow, availability),
    pairs: parseRows('person_pairs', PersonPairRow, pairs),
  };
}

export async function createPerson(sb: TerritoriosClient, input: PersonInsert): Promise<PersonRow> {
  return insertRow(sb, 'people', PersonRow, parsePayload('people', PersonInsert, input));
}

/** A rename re-derives person_names on every cart_assignments row that references the person. */
export async function updatePerson(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
  patch: PersonUpdate,
) {
  return casUpdate(
    sb,
    'people',
    PersonRow,
    { id },
    expectedVersion,
    parsePayload('people', PersonUpdate, patch),
  );
}

/** Cascades availability/pairs and removes the id from cart_assignments. */
export async function deletePerson(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'people', PersonRow, { id }, expectedVersion);
}

export async function addAvailability(
  sb: TerritoriosClient,
  input: PersonAvailabilityInsert,
): Promise<PersonAvailabilityRow> {
  const body = parsePayload('person_availability', PersonAvailabilityInsert, input);
  return insertRow(sb, 'person_availability', PersonAvailabilityRow, body);
}

export async function removeAvailability(
  sb: TerritoriosClient,
  key: { person_id: string; slot_id: string },
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'person_availability', PersonAvailabilityRow, key, expectedVersion);
}

/** Either order may be sent; the server stores (min, max). */
export async function addPair(
  sb: TerritoriosClient,
  input: PersonPairInsert,
): Promise<PersonPairRow> {
  return insertRow(
    sb,
    'person_pairs',
    PersonPairRow,
    parsePayload('person_pairs', PersonPairInsert, input),
  );
}

/** Normalises the key order before matching, so callers may pass either order. */
export async function removePair(
  sb: TerritoriosClient,
  pair: { person_a: string; person_b: string },
  expectedVersion: number,
): Promise<void> {
  const [a, b] =
    pair.person_a < pair.person_b ? [pair.person_a, pair.person_b] : [pair.person_b, pair.person_a];
  return casDelete(
    sb,
    'person_pairs',
    PersonPairRow,
    { person_a: a, person_b: b },
    expectedVersion,
  );
}
