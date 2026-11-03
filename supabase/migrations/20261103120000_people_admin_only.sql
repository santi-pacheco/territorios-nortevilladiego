-- Only the administrator creates and deletes people.
--
--   people INSERT policy              editor -> admin (people_insert_editor replaced by people_insert_admin)
--   people DELETE                     no client policy and no DELETE grant: public.delete_person() is the only path
--   public.create_person_from_name    admin only (editors / programa / privilegios editors pick from the directory)
--   public.delete_person              admin only; refuses while the person is still referenced
--
-- Deleting a person NEVER silently rewrites a schedule. The RPC blocks (23503, with the counts)
-- while the person is linked to a program, a privilegios cell, a salida conductor, a carrito
-- assignment or an account; the admin first replaces them there. Availability and "must be
-- with" pairs are roster settings of the person and go with them (FK cascade).
-- Editors keep UPDATE on people (rename, aliases, duties, "en carrito").

-- ---------------------------------------------------------------------------
-- RLS / grants
-- ---------------------------------------------------------------------------
drop policy people_insert_editor on public.people;
create policy people_insert_admin on public.people
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy people_delete_editor on public.people;
revoke delete on public.people from authenticated;

-- ---------------------------------------------------------------------------
-- create_person_from_name: admin only. Same signature, so callers and grants are unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.create_person_from_name(
  p_name text,
  p_gender text,
  p_in_carrito boolean default false,
  p_duties text[] default '{}'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'create_person_from_name: admin role required' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'create_person_from_name: invalid name' using errcode = '22023';
  end if;
  if p_gender is null or p_gender not in ('M', 'F') then
    raise exception 'create_person_from_name: invalid gender %', p_gender using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.people p
      cross join lateral unnest(array_prepend(p.name, p.aliases)) as a (raw)
     where private.norm_name(a.raw) = private.norm_name(v_name)
  ) then
    raise exception 'Ya existe una persona con ese nombre' using errcode = '23505';
  end if;

  insert into public.people (name, gender, in_carrito, duties)
  values (v_name, p_gender, coalesce(p_in_carrito, false), coalesce(p_duties, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.create_person_from_name(text, text, boolean, text[]) is
  'Create a person from a typed name (returns the id). Admin only. 23505 if the name or an alias already matches someone.';

-- ---------------------------------------------------------------------------
-- delete_person: admin only, blocked while referenced.
-- ---------------------------------------------------------------------------
create or replace function public.delete_person(p_person uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_id text := p_person::text;
  v_programa int;
  v_privilegios int;
  v_salidas int;
  v_carrito int;
  v_cuenta int;
  v_refs text[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'delete_person: admin role required' using errcode = '42501';
  end if;
  select p.name into v_name from public.people p where p.id = p_person for update;
  if not found then
    raise exception 'delete_person: unknown person' using errcode = 'P0002';
  end if;

  -- The uuid only ever appears as a person_id value inside program data.
  select count(*) into v_programa from public.program_weeks w where w.data::text like '%' || v_id || '%';
  select count(*) into v_privilegios from public.duty_roster r where r.person_id = p_person;
  select count(*) into v_salidas from public.service_meetings m where m.conductor_person_id = p_person;
  select count(*) into v_carrito from public.cart_assignments a where a.person_ids @> array[p_person];
  select count(*) into v_cuenta from public.profiles pr where pr.person_id = p_person;

  if v_programa > 0 then v_refs := v_refs || (v_programa || ' en el programa'); end if;
  if v_privilegios > 0 then v_refs := v_refs || (v_privilegios || ' en privilegios'); end if;
  if v_salidas > 0 then v_refs := v_refs || (v_salidas || ' en salidas'); end if;
  if v_carrito > 0 then v_refs := v_refs || (v_carrito || ' en el carrito'); end if;
  if v_cuenta > 0 then v_refs := v_refs || 'una cuenta vinculada'::text; end if;

  if cardinality(v_refs) > 0 then
    raise exception 'delete_person: % is still referenced', v_name
      using errcode = '23503', detail = array_to_string(v_refs, ', '),
            hint = 'Reemplazala en esas asignaciones y desvinculá su cuenta antes de borrarla.';
  end if;

  delete from public.people where id = p_person;
end;
$$;
comment on function public.delete_person(uuid) is
  'Delete a person. Admin only. 23503 (detail = counts) while the person is linked to a program, privilegios cell, salida, carrito assignment or account; availability and pairs cascade.';

revoke all on function public.delete_person(uuid) from public, anon;
grant execute on function public.delete_person(uuid) to authenticated;
