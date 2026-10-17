/**
 * People directory (carrito roster, privilegios tags, aliases). Editor/admin only (RLS);
 * viewers get empty arrays, never an error.
 */
import type { TerritoriosClient } from '../client';
import {
  DutyPerson,
  NameSource,
  PersonAvailabilityInsert,
  PersonAvailabilityRow,
  PersonInsert,
  PersonPairInsert,
  PersonPairRow,
  PersonRow,
  PersonUpdate,
  type Gender,
} from '../schemas';
import {
  callRpc,
  casDelete,
  casUpdate,
  from,
  insertRow,
  parsePayload,
  parseRows,
  parseRpcRows,
  run,
} from './base';

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

/**
 * The carrito part of the roster: people with `in_carrito`, their availability, and only the
 * pairs where both partners are in the carrito. Feed this (not the whole roster) to the
 * scheduler (Generar) and the carrito person pickers.
 */
export function carritoPeople(roster: PeopleRoster): PeopleRoster {
  const people = roster.people.filter((p) => p.in_carrito);
  const ids = new Set(people.map((p) => p.id));
  return {
    people,
    availability: roster.availability.filter((a) => ids.has(a.person_id)),
    pairs: roster.pairs.filter((p) => ids.has(p.person_a) && ids.has(p.person_b)),
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

// ---------------------------------------------------------------------------
// Directory RPCs (docs/PRIVILEGIOS.md)
// ---------------------------------------------------------------------------
/**
 * Every distinct name used in the program, salidas and free-text roster cells, with the
 * person it already matches (by name or alias). Unmatched names come first. Editor only.
 */
export async function fetchNameSources(sb: TerritoriosClient): Promise<NameSource[]> {
  return parseRpcRows('name_sources', NameSource, await callRpc(sb, 'name_sources'));
}

/**
 * "Crear persona" from an unmatched name; returns the new id. `inCarrito` defaults to false.
 * 23505 when the name already matches someone (name or alias). Editor only.
 */
export async function createPersonFromName(
  sb: TerritoriosClient,
  name: string,
  gender: Gender,
  inCarrito = false,
): Promise<string> {
  const id = await callRpc(sb, 'create_person_from_name', {
    p_name: name,
    p_gender: gender,
    p_in_carrito: inCarrito,
  });
  if (typeof id !== 'string') throw new TypeError('create_person_from_name: expected an id');
  return id;
}

/**
 * "Es otro nombre de…": append `alias` to the person's aliases (no-op when it already
 * matches them; 23505 when it matches someone else). Editor only.
 */
export async function addPersonAlias(
  sb: TerritoriosClient,
  personId: string,
  alias: string,
): Promise<void> {
  await callRpc(sb, 'add_person_alias', { p_person: personId, p_alias: alias });
}

/**
 * People with any duty, for the Privilegios pickers and the Excel paste resolver. Works for
 * editors and can_edit_privilegios users (who cannot read `people`); 42501 otherwise.
 */
export async function fetchDutyPeople(sb: TerritoriosClient): Promise<DutyPerson[]> {
  return parseRpcRows('duty_people', DutyPerson, await callRpc(sb, 'duty_people'));
}
