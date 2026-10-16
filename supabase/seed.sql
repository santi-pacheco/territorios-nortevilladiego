-- Local development seed. FAKE DATA ONLY: no real names, no real territories.
-- Runs as postgres on `supabase db reset` (RLS bypassed). Never pushed to the hosted project.

-- Territories: three fake squares.
insert into public.territories (id, name, geometry, centroid_lng, centroid_lat) values
  (1, 'Territorio 1', '{"type":"Polygon","coordinates":[[[-58.400,-34.600],[-58.395,-34.600],[-58.395,-34.595],[-58.400,-34.595],[-58.400,-34.600]]]}', -58.3975, -34.5975),
  (2, 'Territorio 2', '{"type":"Polygon","coordinates":[[[-58.395,-34.600],[-58.390,-34.600],[-58.390,-34.595],[-58.395,-34.595],[-58.395,-34.600]]]}', -58.3925, -34.5975),
  (3, 'Territorio 3', '{"type":"Polygon","coordinates":[[[-58.400,-34.605],[-58.395,-34.605],[-58.395,-34.600],[-58.400,-34.600],[-58.400,-34.605]]]}', -58.3975, -34.6025);

-- Salidas: one week (Monday 2026-10-12) with a Wednesday salida and a Domingo G1-G4 layout.
insert into public.service_weeks (id, week_start, month_label) values
  ('00000000-0000-4000-8000-000000000101', '2026-10-12', 'Octubre');

insert into public.service_meetings
  (week_id, dow, position, kind, start_time, groups, conductor, place, territory_ids, group_territories) values
  ('00000000-0000-4000-8000-000000000101', 3, 0, 'normal',  '09:30', '1 y 2', 'Conductor Ejemplo A', 'Esquina Ficticia 100', '{1,2}', '{}'),
  ('00000000-0000-4000-8000-000000000101', 6, 0, 'normal',  '10:00', '3',     'Conductor Ejemplo B', 'Plaza Inventada',      '{3}',   '{}'),
  ('00000000-0000-4000-8000-000000000101', 0, 0, 'domingo', '09:45', 'G1-G4', 'Conductor Ejemplo C', 'Salón',                '{}',    '{"G1":[1],"G2":[2],"G3":[3],"G4":[]}');

-- Carrito
insert into public.cart_places (id, name, color) values
  ('00000000-0000-4000-8000-000000000201', 'Lugar Uno', '#2E7D32'),
  ('00000000-0000-4000-8000-000000000202', 'Lugar Dos', '#1565C0');

insert into public.cart_slots (id, place_id, iso_dow, start_time, end_time, group_size, display_label) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 2, '08:30', '10:30', 2, null),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000202', 6, '10:00', '12:00', 3, 'Sábado mañana');

insert into public.people (id, name, gender, target_appearances) values
  ('00000000-0000-4000-8000-000000000401', 'Ana Prueba',      'F', 0),
  ('00000000-0000-4000-8000-000000000402', 'Bruno Prueba',    'M', 2),
  ('00000000-0000-4000-8000-000000000403', 'Carla Ficticia',  'F', 0),
  ('00000000-0000-4000-8000-000000000404', 'Dario Ficticio',  'M', 0),
  ('00000000-0000-4000-8000-000000000405', 'Elena Inventada', 'F', 1);

insert into public.person_availability (person_id, slot_id) values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000301'),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000301'),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000302'),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000302'),
  ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000302');

-- A married couple: must be scheduled together (order normalized by trigger).
insert into public.person_pairs (person_a, person_b) values
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000403');

insert into public.cart_schedules (id, name, start_date, end_date) values
  ('00000000-0000-4000-8000-000000000501', 'Octubre (ejemplo)', '2026-10-12', '2026-10-25');

insert into public.cart_assignments (schedule_id, slot_id, week_date, person_ids, note) values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000301', '2026-10-12',
   '{00000000-0000-4000-8000-000000000401,00000000-0000-4000-8000-000000000402}', null),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000302', '2026-10-12',
   '{00000000-0000-4000-8000-000000000403,00000000-0000-4000-8000-000000000404,00000000-0000-4000-8000-000000000405}', 'Llevar exhibidor');

insert into public.cart_blackouts (slot_id, date) values
  ('00000000-0000-4000-8000-000000000302', '2026-10-24');

-- Programa: Tuesday (midweek) and Saturday (weekend) keys.
insert into public.program_weeks (kind, date, data) values
  ('midweek', '2026-10-13', '{"date":"2026-10-13","asamblea":null,"parts":[{"time":"19:00","title":"Canción y oración","section":"inicio","people":[{"name":"Hermano Ejemplo","role":"Presidente"}]}]}'),
  ('weekend', '2026-10-17', '{"date":"2026-10-17","asamblea":null,"presidente":"Hermano Ejemplo","cancionInicio":"1","conductor":"Hermano Prueba","lector":"Hermano Ficticio","cancionFin":"2","oracionFinal":"Hermano Ejemplo","discurso":null}');

-- Extra fake salidas so the day line has past, next and later stations in dev.
insert into public.service_meetings
  (week_id, dow, position, kind, start_time, groups, conductor, place, territory_ids, group_territories) values
  ('00000000-0000-4000-8000-000000000101', 4, 0, 'normal', '09:00', '1 y 2', 'Conductor Ejemplo D', 'Casa de Familia Ejemplo', '{1}',   '{}'),
  ('00000000-0000-4000-8000-000000000101', 4, 1, 'normal', '17:30', '3',     'Conductor Ejemplo E', 'Esquina Inventada 250',   '{2,3}', '{}'),
  ('00000000-0000-4000-8000-000000000101', 4, 2, 'normal', '19:00', 'Todos', 'Conductor Ejemplo F', 'Salón',                   '{}',    '{}'),
  ('00000000-0000-4000-8000-000000000101', 5, 0, 'normal', '10:00', '2',     'Conductor Ejemplo G', 'Plaza Ficticia',          '{3}',   '{}');
