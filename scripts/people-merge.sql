-- people-merge.sql: unify duplicate people and put every canonical name in "Name Surname" form.
--
-- REVIEW FIRST: docs/v2/people-merge-plan.md explains every group and why. Generated from the
-- hosted data of 2026-11-03 (93 people). NOT applied by anyone yet: run it once you have read the
-- plan, e.g.   npx supabase db query --remote --file scripts/people-merge.sql
--
--   * one transaction: any error rolls everything back; nothing is half-merged
--   * idempotent: ids that no longer exist are skipped, renames only touch names that differ,
--     the program pass only writes rows it actually changes; a second run changes nothing
--   * runs as postgres (no auth.uid()), so updated_by of touched rows is left as it was
--   * ends with a report (NOTICE) of what is still unlinked; it never creates a person
--
-- Order: (1) merge attributes (aliases, duties, carrito flag), (2) repoint every relational reference
-- (availability, pairs, carrito assignments, privilegios cells, salida conductors, accounts),
-- (3) renames, (4) link still-unlinked names that match exactly ONE person (same words in any order:
-- "Diaz, Enrique" = "Enrique Diaz"), (5) rewrite person slots in program_weeks.data, (6) check nothing
-- points at a loser, (7) delete the losers.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- The decisions. Edit here, not below.
-- ---------------------------------------------------------------------------
-- loser -> winner. The loser's references move to the winner; the loser row is deleted.
create temp table _merge (loser uuid primary key, winner uuid not null, note text) on commit drop;
insert into _merge (loser, winner, note)
select v.loser, v.winner, v.note
  from (values
    ('6f53df71-eeae-4a32-a925-44c5bf8e8be8'::uuid, '1a9aea18-d4df-4fc0-979f-9361bd99ba64'::uuid, 'Alfredo -> Alfredo Cañete'),
    ('be8392d2-24d1-4f45-9a29-f6b7caf70efd'::uuid, '16a4c894-94f1-57ef-a358-9e59fd695375'::uuid, 'Ángel -> Angel Cañete'),
    ('d4650e59-af1c-4c79-933e-ea0609a7a949'::uuid, '403d4431-df1a-44f4-ba68-90cd1469c4fd'::uuid, 'Ariel -> Ariel Giai Gischia'),
    ('bb14fa8f-5f48-45a0-a181-9d669b2e2e1e'::uuid, '15d9d718-37cc-5486-b24d-138a5cd3c657'::uuid, 'Braulio -> Braulio Saucedo'),
    ('d39b686e-fb06-4595-b27c-b873d359cd16'::uuid, '7878921b-4f3c-4da2-930e-977d5c7e6cf5'::uuid, 'Cristian -> Cristian Ledesma'),
    ('d1311b03-7781-4ceb-88e8-a704c2627c65'::uuid, 'c8345734-dc90-5282-ad0d-3f490a401c25'::uuid, 'Daniel -> Daniel Gomez'),
    ('147bfb32-06c5-4d3c-b8b2-e95bf44f407c'::uuid, '5f51ba0f-6e2d-42f7-b638-d81135726b0e'::uuid, 'Enrique -> Enrique Diaz'),
    ('0f525551-4192-43b2-bc20-2506e29af334'::uuid, '6b7fc636-44a6-4374-b086-02bd95acb403'::uuid, 'Felipe -> Felipe Pacheco'),
    ('3383451f-32c8-4fa0-a624-cccfb43b866f'::uuid, 'fd108655-f83d-5f19-8847-290b7b161adc'::uuid, 'Gustavo -> Gustavo Molina'),
    ('a49f27dd-e118-4311-9d7a-8122c02dce95'::uuid, '8ed4de76-9898-4880-aa58-6e7408c564f9'::uuid, 'Hugo -> Hugo Vargas'),
    ('11da7265-79f6-4e65-8da8-24bdff1debf1'::uuid, 'f718874c-ecdf-500f-8e3e-ddac656c0c00'::uuid, 'Juan luis -> Juan Luis Cardozo'),
    ('4dbd2be0-86ad-4419-ba0b-bd1db29f9f11'::uuid, 'f718874c-ecdf-500f-8e3e-ddac656c0c00'::uuid, 'Juan Luis Cardozo - Congregación SUR Villa Constitución -> Juan Luis Cardozo'),
    ('cfa85ca1-c5ed-4bdb-aa3a-81725e230b8b'::uuid, '521e9970-213d-48d2-9b3f-8f352aff282a'::uuid, 'Juan pablo -> Juan Pablo Cejas'),
    ('63c0e937-bc6d-41ca-bd66-f16aab557cbc'::uuid, '521e9970-213d-48d2-9b3f-8f352aff282a'::uuid, 'Juan Pablo Cejas - Congregación Saenz Peña -> Juan Pablo Cejas'),
    ('aa0f0a1d-dfe9-4f45-976a-6714d84f3734'::uuid, 'f4cbb18b-87fb-4d3d-bcf2-cf87dfb3641e'::uuid, 'Julián -> Julián Valenciano'),
    ('f4e4f2d8-1756-478a-84a9-e50c1283e332'::uuid, '3e746708-996a-4f37-9eb4-50b24309947f'::uuid, 'Lázaro -> Lázaro Pacheco'),
    ('656c97d9-f934-4a7a-8a0c-fce91a5f36f6'::uuid, '3e746708-996a-4f37-9eb4-50b24309947f'::uuid, 'Lázaro Pacheco - Congregación Carcarañá Oeste -> Lázaro Pacheco'),
    ('e94c9e84-30b7-4e72-9f84-0fae43f768cb'::uuid, '3e746708-996a-4f37-9eb4-50b24309947f'::uuid, 'Lázaro Pacheco - Congregación Saenz Peña -> Lázaro Pacheco'),
    ('56a85a73-67be-4d50-82ee-daf08b9c98af'::uuid, 'fc44f8a6-0712-5a0f-8f2a-793f83e6673f'::uuid, 'Nahuel -> Nahuel Cardozo'),
    ('d93d0161-578a-4fe2-baa7-e9472ab387f8'::uuid, 'd972ab24-05af-4806-8e6c-d820b9e5a0f3'::uuid, 'Roberto -> Roberto Ramírez'),
    ('333a31b4-ed64-4426-919b-35c295766e56'::uuid, 'd960bef7-c817-48a9-8cf1-a1bc489235af'::uuid, 'Santiago -> Santiago Pacheco'),
    ('fffac785-ebf5-47fe-bf8b-00797ccaa4c9'::uuid, 'd960bef7-c817-48a9-8cf1-a1bc489235af'::uuid, 'Santiago Pacheco - Congregación La Florida -> Santiago Pacheco'),
    ('4a350823-0f89-41dd-bbc7-b7b0d5ffac9d'::uuid, 'c8ce16a6-488c-52fc-abb1-6d65e55cb51a'::uuid, 'David Mallqui - Congregación La Florida -> David Mallqui'),
    ('41e9ad10-c3c2-43e0-9d86-1ad02f73c7eb'::uuid, '0993e8a6-3c28-4168-b9e7-21c5b5d88f9b'::uuid, 'Emmanuel Cardozo - Congregación Saenz Peña -> Emmanuel Cardozo'),
    ('b84cd6fb-ae5a-496a-83b7-86a8bfd6421d'::uuid, '0993e8a6-3c28-4168-b9e7-21c5b5d88f9b'::uuid, 'Emmanuel Cardozo - Congregación SUR Villa Constitución -> Emmanuel Cardozo'),
    ('ac106da9-75f1-4190-9527-1199d9401aa6'::uuid, 'c8ce16a6-488c-52fc-abb1-6d65e55cb51a'::uuid, 'David -> David Mallqui'),
    ('1abf621a-03a3-4c19-a589-5a6645a49b86'::uuid, '0993e8a6-3c28-4168-b9e7-21c5b5d88f9b'::uuid, 'Emanuel -> Emmanuel Cardozo')
  ) as v (loser, winner, note)
  join public.people l on l.id = v.loser
  join public.people w on w.id = v.winner
 where v.loser <> v.winner;

-- id -> canonical "Name Surname". Only names that differ are written.
create temp table _rename (id uuid primary key, new_name text not null) on commit drop;
insert into _rename (id, new_name) values
    ('c8345734-dc90-5282-ad0d-3f490a401c25'::uuid, 'Daniel Gómez'),  -- Daniel Gomez
    ('31ebc89b-25dd-5fcc-acdb-2d2cc2578ee8'::uuid, 'Liliana Giménez'),  -- Liliana Gimenez
    ('ebfd4927-a522-5cad-a645-a27876f61e16'::uuid, 'María García'),  -- Maria Garcia
    ('0ed1626c-61ec-5d3a-b35c-be86e741eb2a'::uuid, 'Marina Ramírez'),  -- Marina Ramirez
    ('46a65b89-b0a9-5ab4-9aeb-9a6af6df5f6c'::uuid, 'Nazarena Ramírez'),  -- Nazarena Ramirez
    ('773b9df4-5d1b-5a8f-832e-4812c8fa7280'::uuid, 'Laura Ramírez'),  -- Laura Ramirez
    ('16a4c894-94f1-57ef-a358-9e59fd695375'::uuid, 'Ángel Cañete')  -- Angel Cañete
    -- More accents the data does not prove (see the plan); add rows here to apply them.
  ;

-- ---------------------------------------------------------------------------
-- Helpers (session-local)
-- ---------------------------------------------------------------------------
-- Order-insensitive key of a name: folded, punctuation dropped, words sorted.
-- "Pérez, Ana" and "ANA PEREZ" give the same key.
create or replace function pg_temp.name_key(t text) returns text
language sql stable as $f$
  select coalesce(string_agg(w, ' ' order by w), '')
    from unnest(regexp_split_to_array(
           btrim(regexp_replace(private.norm_name(coalesce(t, '')), '[.,;:()"]', ' ', 'g')), '\s+')) as w
   where w <> ''
$f$;

-- The one person a name refers to (name or alias, any word order); null when none or several.
create or replace function pg_temp.person_by_name(t text) returns uuid
language sql stable as $f$
  select case when count(*) = 1 then min(s.id::text)::uuid end
    from (
      select distinct p.id
        from public.people p
       where pg_temp.name_key(t) <> ''
         and exists (
           select 1 from unnest(array_prepend(p.name, p.aliases)) as l (x)
            where pg_temp.name_key(x) = pg_temp.name_key(t))
    ) s
$f$;

-- ... and where that person ends up after the merge.
create or replace function pg_temp.resolve(t text) returns uuid
language sql stable as $f$
  select coalesce((select m.winner from _merge m where m.loser = pg_temp.person_by_name(t)),
                  pg_temp.person_by_name(t))
$f$;

-- One person slot of a program payload. ctx: 'person' (parts / weekend roles), 'saliente'
-- (our member going to another congregation: name + person_id + congregacion) or 'orador'
-- (visiting speaker: free text, never linked; a link to a loser is dropped, the text stays).
create or replace function pg_temp.fix_person(v jsonb, ctx text) returns jsonb
language plpgsql stable as $f$
declare
  v_name text;
  v_pid uuid;
  v_base text;
  v_cong text;
  v_canon text;
  v_obj jsonb;
  v_parts text[];
  v_win uuid;
begin
  if v is null or jsonb_typeof(v) not in ('string', 'object') then return v; end if;
  v_name := btrim(case when jsonb_typeof(v) = 'string' then v #>> '{}' else coalesce(v ->> 'name', '') end);
  if v_name = '' then return v; end if;
  begin
    v_pid := nullif(v ->> 'person_id', '')::uuid;
  exception when others then
    v_pid := null;
  end;

  if ctx = 'orador' then
    if v_pid is not null and exists (select 1 from _merge m where m.loser = v_pid) then
      return to_jsonb(v_name);
    end if;
    return v;
  end if;

  v_base := v_name;
  if ctx = 'saliente' then
    -- "Persona - Congregación X" (the shape older rows were typed in), like parseSalienteText.
    v_parts := regexp_split_to_array(v_name, '\s+[–-]\s+');
    v_base := btrim(v_parts[1]);
    if cardinality(v_parts) > 1 then
      v_cong := nullif(btrim(regexp_replace(array_to_string(v_parts[2:], ' - '), '^Congre(gación)?\.?\s+', '', 'i')), '');
    end if;
  end if;

  if v_pid is not null then
    select m.winner into v_win from _merge m where m.loser = v_pid;
    if found then
      -- a loser typed as "Persona - Congregación X": the congregation lives on in the saliente
      if ctx = 'saliente' and v_cong is null then
        select nullif(btrim(regexp_replace(array_to_string((regexp_split_to_array(l.name, '\s+[–-]\s+'))[2:], ' - '),
                                           '^Congre(gación)?\.?\s+', '', 'i')), '')
          into v_cong
          from public.people l where l.id = v_pid;
      end if;
      v_pid := v_win;
    end if;
  else
    v_pid := pg_temp.resolve(v_base);
  end if;
  if v_pid is null then return v; end if;
  select p.name into v_canon from public.people p where p.id = v_pid;
  if v_canon is null then return v; end if; -- dangling link: leave it for the editor

  v_obj := case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end;
  v_obj := v_obj || jsonb_build_object('name', v_canon, 'person_id', v_pid);
  if ctx = 'saliente' and v_cong is not null and coalesce(v_obj ->> 'congregacion', '') = '' then
    v_obj := v_obj || jsonb_build_object('congregacion', v_cong);
  end if;
  return v_obj;
end;
$f$;

create or replace function pg_temp.fix_people_array(a jsonb, ctx text) returns jsonb
language sql stable as $f$
  select coalesce(jsonb_agg(pg_temp.fix_person(e.x, ctx) order by e.o), '[]'::jsonb)
    from jsonb_array_elements(a) with ordinality as e (x, o)
$f$;

create or replace function pg_temp.fix_program(d jsonb) returns jsonb
language plpgsql stable as $f$
declare
  v_out jsonb := d;
  k text;
begin
  if jsonb_typeof(v_out -> 'parts') = 'array' then
    v_out := jsonb_set(v_out, '{parts}', (
      select coalesce(jsonb_agg(
               case when jsonb_typeof(e.pt) = 'object' and jsonb_typeof(e.pt -> 'people') = 'array'
                    then jsonb_set(e.pt, '{people}', pg_temp.fix_people_array(e.pt -> 'people', 'person'))
                    else e.pt end
               order by e.o), '[]'::jsonb)
        from jsonb_array_elements(v_out -> 'parts') with ordinality as e (pt, o)));
  end if;
  foreach k in array array['presidente', 'conductor', 'lector', 'oracionFinal'] loop
    if v_out ? k then
      v_out := jsonb_set(v_out, array[k], pg_temp.fix_person(v_out -> k, 'person'));
    end if;
  end loop;
  if jsonb_typeof(v_out -> 'discursantesSalientes') = 'array' then
    v_out := jsonb_set(v_out, '{discursantesSalientes}',
                       pg_temp.fix_people_array(v_out -> 'discursantesSalientes', 'saliente'));
  end if;
  if jsonb_typeof(v_out -> 'discurso') = 'object' and (v_out -> 'discurso') ? 'orador' then
    v_out := jsonb_set(v_out, '{discurso,orador}', pg_temp.fix_person(v_out #> '{discurso,orador}', 'orador'));
  end if;
  return v_out;
end;
$f$;

-- ---------------------------------------------------------------------------
-- 0. Guards
-- ---------------------------------------------------------------------------
do $f$
begin
  -- profiles.person_id is unique: two linked accounts cannot share a person. Decide by hand.
  if exists (
    select 1
      from public.profiles a
      join _merge m on a.person_id = m.loser
      join public.profiles b on b.person_id = m.winner
  ) then
    raise exception 'people-merge: a loser and its winner both have a linked account; unlink one first';
  end if;
  if (select count(*) from (select winner from _merge m join public.profiles p on p.person_id = m.loser group by winner having count(*) > 1) x) > 0 then
    raise exception 'people-merge: two losers of one winner both have a linked account; unlink one first';
  end if;
  if exists (select 1 from _merge a join _merge b on a.winner = b.loser) then
    raise exception 'people-merge: a winner is also a loser (chain); point the loser straight at the final winner';
  end if;
end;
$f$;

-- ---------------------------------------------------------------------------
-- 1. Attributes: aliases, duties, carrito flag move to the winner
-- ---------------------------------------------------------------------------
do $f$
declare
  r record;
  v_aliases text[];
begin
  for r in select m.loser, m.winner from _merge m loop
    select array_cat(w.aliases,
             array_cat(
               -- the loser's own name is a useful alias only when it says more than a first name
               case when array_length(regexp_split_to_array(btrim(l.name), '\s+'), 1) >= 2
                         and l.name !~ '\s[–-]\s'
                    then array[l.name] else '{}'::text[] end,
               l.aliases))
      into v_aliases
      from public.people w, public.people l
     where w.id = r.winner and l.id = r.loser;

    update public.people w
       set duties = array(select distinct d from unnest(w.duties || l.duties) as d order by d),
           in_carrito = w.in_carrito or l.in_carrito,
           aliases = array(
             select s.x
               from (select distinct on (private.norm_name(t.x)) t.x, t.o
                       from unnest(v_aliases) with ordinality as t (x, o)
                      where btrim(t.x) <> ''
                        and private.norm_name(t.x) <> private.norm_name(w.name)
                      order by private.norm_name(t.x), t.o) s
              order by s.o
              limit 20)
      from public.people l
     where w.id = r.winner and l.id = r.loser;
  end loop;
end;
$f$;

-- ---------------------------------------------------------------------------
-- 2. Relational references of the losers -> winners
-- ---------------------------------------------------------------------------
insert into public.person_availability (person_id, slot_id)
select m.winner, a.slot_id
  from public.person_availability a
  join _merge m on m.loser = a.person_id
on conflict do nothing;

insert into public.person_pairs (person_a, person_b)
select least(t.wa, t.wb), greatest(t.wa, t.wb)
  from (
    select coalesce(ma.winner, p.person_a) as wa, coalesce(mb.winner, p.person_b) as wb
      from public.person_pairs p
      left join _merge ma on ma.loser = p.person_a
      left join _merge mb on mb.loser = p.person_b
     where ma.loser is not null or mb.loser is not null
  ) t
 where t.wa <> t.wb
on conflict do nothing;

update public.cart_assignments a
   set person_ids = (
     select array_agg(s.x order by s.o)
       from (select distinct on (t.x) t.x, t.o
               from (select coalesce(m.winner, e.pid) as x, e.o
                       from unnest(a.person_ids) with ordinality as e (pid, o)
                       left join _merge m on m.loser = e.pid) t
              order by t.x, t.o) s)
 where exists (select 1 from unnest(a.person_ids) as pid join _merge m on m.loser = pid);

update public.duty_roster r
   set person_id = m.winner
  from _merge m
 where r.person_id = m.loser;

update public.service_meetings s
   set conductor_person_id = m.winner
  from _merge m
 where s.conductor_person_id = m.loser;

update public.profiles p
   set person_id = m.winner
  from _merge m
 where p.person_id = m.loser;

-- ---------------------------------------------------------------------------
-- 3. Canonical spelling. Triggers re-derive the names stored on carrito assignments,
--    privilegios cells and salidas.
-- ---------------------------------------------------------------------------
update public.people p
   set name = r.new_name
  from _rename r
 where p.id = r.id and p.name is distinct from r.new_name;

-- An alias equal to the canonical name says nothing.
update public.people p
   set aliases = array(select a from unnest(p.aliases) as a where private.norm_name(a) <> private.norm_name(p.name))
 where exists (select 1 from unnest(p.aliases) as a where private.norm_name(a) = private.norm_name(p.name));

-- ---------------------------------------------------------------------------
-- 4. Free-text names that match exactly one person get linked (never created)
-- ---------------------------------------------------------------------------
update public.duty_roster r
   set person_id = pg_temp.resolve(r.person_name)
 where r.person_id is null and r.person_name is not null
   and pg_temp.resolve(r.person_name) is not null;

update public.service_meetings s
   set conductor_person_id = pg_temp.resolve(s.conductor)
 where s.conductor_person_id is null and s.conductor is not null
   and pg_temp.resolve(s.conductor) is not null;

-- ---------------------------------------------------------------------------
-- 5. Program payloads: person slots follow the merge, carry the canonical spelling and
--    link when the name is unambiguous
-- ---------------------------------------------------------------------------
update public.program_weeks w
   set data = pg_temp.fix_program(w.data)
 where pg_temp.fix_program(w.data) is distinct from w.data;

-- ---------------------------------------------------------------------------
-- 6. Nothing may still point at a loser
-- ---------------------------------------------------------------------------
do $f$
declare
  v_left text;
begin
  select string_agg(distinct x.what, ', ') into v_left from (
    select 'cart_assignments' as what from public.cart_assignments a join _merge m on a.person_ids @> array[m.loser]
    union all select 'duty_roster' from public.duty_roster r join _merge m on r.person_id = m.loser
    union all select 'service_meetings' from public.service_meetings s join _merge m on s.conductor_person_id = m.loser
    union all select 'profiles' from public.profiles p join _merge m on p.person_id = m.loser
    union all select 'program_weeks' from public.program_weeks w join _merge m on w.data::text like '%' || m.loser::text || '%'
  ) x;
  if v_left is not null then
    raise exception 'people-merge: references to a merged person remain in: %', v_left;
  end if;
end;
$f$;

-- ---------------------------------------------------------------------------
-- 7. Delete the losers (availability / pairs cascade; their rows were copied above)
-- ---------------------------------------------------------------------------
delete from public.people p using _merge m where p.id = m.loser;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
do $f$
begin
  raise notice 'people-merge: % people now. Names in program/salidas/privilegios that match nobody show up in Gestión > Personas > Nombres sin vincular.',
    (select count(*) from public.people);
end;
$f$;

commit;
