# Plan de unificación de personas (REVISAR antes de aplicar)

Generado el 2026-11-03 con consultas **de solo lectura** al proyecto hosted (`TerritoriosV2`, 93 personas). Nada se escribió allá.
El script `scripts/people-merge.sql` hace todo en **una transacción** y es **idempotente** (correrlo dos veces no cambia nada la segunda). No lo apliqué: aplicalo vos con
`npx supabase db query --remote --file scripts/people-merge.sql` cuando termines de revisar.

Forma canónica: **«Nombre Apellido(s)»** (la que usa `matchPerson`/`normalizePersonName` de `packages/core/src/people/names.ts`).

## Qué referencia a una persona (todo lo que el script repunta)

| Dónde | Cómo se guarda | Qué hace el script |
|---|---|---|
| `person_availability` | FK `person_id` (PK con `slot_id`) | copia las filas al ganador (`on conflict do nothing`); las del perdedor se van con el borrado (cascade) |
| `person_pairs` | FK `person_a/person_b` (`a < b`) | reescribe el par con el ganador (ordenado, sin pares consigo mismo ni repetidos) |
| `cart_assignments.person_ids` | `uuid[]` sin FK (+ `person_names` por trigger) | reemplaza el id, sin duplicados y respetando el orden; el trigger rehace los nombres |
| `duty_roster` | `person_id` FK + `person_name` (trigger) | repunta el id; además enlaza las celdas de **solo texto** que coinciden con una única persona |
| `service_meetings` | `conductor_person_id` FK + `conductor` (trigger) | idem (salidas) |
| `profiles.person_id` | FK única | mueve la cuenta al ganador; **aborta** si ganador y perdedor tienen cuenta |
| `program_weeks.data` (jsonb) | `parts[].people[]`, `presidente/conductor/lector/oracionFinal`, `discursantesSalientes[]`, `discurso.orador` | cambia `person_id` al ganador, pone el nombre canónico, y enlaza los nombres de texto que coinciden con una única persona (cualquier orden: «Diaz, Enrique» = «Enrique Diaz»). En `discursantesSalientes` la variante «Persona - Congregación X» pasa a `{name, person_id, congregacion: "X"}`. El **orador** es texto libre: si estaba enlazado a un perdedor se le quita el enlace y queda el texto |
| `people.aliases/duties/in_carrito` | columnas | el ganador hereda alias (+ el nombre del perdedor si tiene ≥2 palabras), privilegios y «en carrito» |

Antes de borrar, el script verifica que ningún lugar siga apuntando a un perdedor; si queda algo, **falla y revierte todo**.

## Grupos propuestos (activos en el SQL)

Cada línea: referencias actuales (programa, privilegios, salidas, carrito, cuenta, disponibilidad, pares).

### Alfredo Cañete  (confianza alta)

Único Alfredo del directorio; tiene el privilegio de micrófono.

| Persona | Rol | Referencias |
|---|---|---|
| **Alfredo Cañete** → queda como **Alfredo Cañete** | ganador | programa 6, salidas 1 |
| Alfredo | se fusiona y se borra | privilegios 1 · privilegios: microfonista |

### Ángel Cañete  (confianza alta)

Único Ángel/Angel. Se renombra a «Ángel Cañete» (ver renombres).

| Persona | Rol | Referencias |
|---|---|---|
| **Angel Cañete** → queda como **Ángel Cañete** | ganador | programa 1, privilegios 1, salidas 2, carrito 2, disponibilidad 1 |
| Ángel | se fusiona y se borra | privilegios 2 · privilegios: microfonista |

### Ariel Giai Gischia  (confianza alta)

Único Ariel.

| Persona | Rol | Referencias |
|---|---|---|
| **Ariel Giai Gischia** → queda como **Ariel Giai Gischia** | ganador | programa 1, salidas 2 |
| Ariel | se fusiona y se borra | privilegios 2 · privilegios: microfonista |

### Braulio Saucedo  (confianza alta)

Único Braulio.

| Persona | Rol | Referencias |
|---|---|---|
| **Braulio Saucedo** → queda como **Braulio Saucedo** | ganador | carrito 3, disponibilidad 1 |
| Braulio | se fusiona y se borra | privilegios 2 · privilegios: microfonista |

### Cristian Ledesma  (confianza alta)

Único Cristian.

| Persona | Rol | Referencias |
|---|---|---|
| **Cristian Ledesma** → queda como **Cristian Ledesma** | ganador | programa 3, salidas 2 |
| Cristian | se fusiona y se borra | privilegios 2 · privilegios: microfonista |

### Daniel Gómez  (confianza alta)

Único Daniel. Se renombra a «Daniel Gómez».

| Persona | Rol | Referencias |
|---|---|---|
| **Daniel Gomez** → queda como **Daniel Gómez** | ganador | programa 9, salidas 6, carrito 3, disponibilidad 1, pares 1 |
| Daniel | se fusiona y se borra | privilegios 1 · privilegios: microfonista |

### Enrique Diaz  (confianza alta)

Único Enrique.

| Persona | Rol | Referencias |
|---|---|---|
| **Enrique Diaz** → queda como **Enrique Diaz** | ganador | programa 2, privilegios 2, salidas 1 |
| Enrique | se fusiona y se borra | privilegios 2 · privilegios: microfonista |

### Felipe Pacheco  (confianza alta)

Único Felipe.

| Persona | Rol | Referencias |
|---|---|---|
| **Felipe Pacheco** → queda como **Felipe Pacheco** | ganador | programa 1 |
| Felipe | se fusiona y se borra | privilegios 2 · privilegios: sonido |

### Gustavo Molina  (confianza alta)

Único Gustavo.

| Persona | Rol | Referencias |
|---|---|---|
| **Gustavo Molina** → queda como **Gustavo Molina** | ganador | programa 1, salidas 2, carrito 4, disponibilidad 2 |
| Gustavo | se fusiona y se borra | privilegios 1 · privilegios: microfonista |

### Hugo Vargas  (confianza alta)

Único Hugo.

| Persona | Rol | Referencias |
|---|---|---|
| **Hugo Vargas** → queda como **Hugo Vargas** | ganador | programa 6, salidas 2 |
| Hugo | se fusiona y se borra | privilegios 2 · privilegios: microfonista |

### Juan Luis Cardozo  (confianza alta)

«Juan luis» (minúscula) es el mismo; la variante con congregación es un saliente.

| Persona | Rol | Referencias |
|---|---|---|
| **Juan Luis Cardozo** → queda como **Juan Luis Cardozo** | ganador | programa 7, salidas 3, carrito 2, disponibilidad 1 |
| Juan luis | se fusiona y se borra | privilegios 1 · privilegios: acomodador |
| Juan Luis Cardozo - Congregación SUR Villa Constitución | se fusiona y se borra | programa 1 |

### Juan Pablo Cejas  (confianza alta)

Ídem.

| Persona | Rol | Referencias |
|---|---|---|
| **Juan Pablo Cejas** → queda como **Juan Pablo Cejas** | ganador | programa 7, salidas 3 |
| Juan pablo | se fusiona y se borra | privilegios 1 · privilegios: microfonista |
| Juan Pablo Cejas - Congregación Saenz Peña | se fusiona y se borra | programa 1 |

### Julián Valenciano  (confianza alta)

Único Julián. El ganador ya tiene los dos privilegios.

| Persona | Rol | Referencias |
|---|---|---|
| **Julián Valenciano** → queda como **Julián Valenciano** | ganador | programa 3, salidas 1, cuenta |
| Julián | se fusiona y se borra | privilegios 2 · privilegios: microfonista |

### Lázaro Pacheco  (confianza alta)

Único Lázaro; dos variantes con congregación (salientes).

| Persona | Rol | Referencias |
|---|---|---|
| **Lázaro Pacheco** → queda como **Lázaro Pacheco** | ganador | programa 13, salidas 2, cuenta |
| Lázaro | se fusiona y se borra | privilegios 1 · privilegios: acomodador |
| Lázaro Pacheco - Congregación Carcarañá Oeste | se fusiona y se borra | programa 1 |
| Lázaro Pacheco - Congregación Saenz Peña | se fusiona y se borra | programa 1 |

### Nahuel Cardozo  (confianza alta)

Único Nahuel.

| Persona | Rol | Referencias |
|---|---|---|
| **Nahuel Cardozo** → queda como **Nahuel Cardozo** | ganador | programa 5, salidas 1, carrito 2, disponibilidad 1 |
| Nahuel | se fusiona y se borra | privilegios 6 · privilegios: sonido, acomodador |

### Roberto Ramírez  (confianza alta)

Único Roberto.

| Persona | Rol | Referencias |
|---|---|---|
| **Roberto Ramírez** → queda como **Roberto Ramírez** | ganador | programa 3, privilegios 1, salidas 1, cuenta |
| Roberto | se fusiona y se borra | privilegios 4 · privilegios: computadora |

### Santiago Pacheco  (confianza alta)

Único Santiago (el ganador tiene la cuenta vinculada).

| Persona | Rol | Referencias |
|---|---|---|
| **Santiago Pacheco** → queda como **Santiago Pacheco** | ganador | programa 5, privilegios 1, salidas 1, cuenta |
| Santiago | se fusiona y se borra | privilegios 4 · privilegios: computadora |
| Santiago Pacheco - Congregación La Florida | se fusiona y se borra | programa 1 |

### David Mallqui  (confianza alta)

Variante con congregación (saliente).

| Persona | Rol | Referencias |
|---|---|---|
| **David Mallqui** → queda como **David Mallqui** | ganador | programa 4, privilegios 3, salidas 2, carrito 2, disponibilidad 1 |
| David Mallqui - Congregación La Florida | se fusiona y se borra | programa 1 |

### Emmanuel Cardozo  (confianza alta)

Dos variantes con congregación (salientes).

| Persona | Rol | Referencias |
|---|---|---|
| **Emmanuel Cardozo** → queda como **Emmanuel Cardozo** | ganador | programa 7, salidas 2 |
| Emmanuel Cardozo - Congregación Saenz Peña | se fusiona y se borra | programa 1 |
| Emmanuel Cardozo - Congregación SUR Villa Constitución | se fusiona y se borra | programa 1 |

## Grupos que necesitan tu decisión (comentados en el SQL)

- **David → David Mallqui** (confianza media). Hay 3 Davids (Diaz, Gómez, Mallqui). «David» tiene sonido y el roster usa el texto «David Mallqui» 3 veces, pero ningún dato lo prueba. Si es David Mallqui, descomentá la línea. Referencias de «David»: privilegios 2.
- **Emanuel → Emmanuel Cardozo** (confianza media). Emanuel/Emmanuel se escriben distinto; solo hay un Cardozo con ese nombre, pero puede ser otra persona. Referencias de «Emanuel»: privilegios 2.
- **Manuel, Máximo**: personas de un solo nombre sin ningún candidato con ese nombre en el directorio (en el texto del programa aparece «Vallejos, Manuel» y «Gómez, Máximo», que no existen como personas). No se tocan; completá el apellido en Gestión ▸ Personas.

## Renombres (acentos) — activos en el SQL

Solo donde el propio dato prueba la tilde (un alias «Apellido, Nombre» o la variante de un solo nombre ya la traen):

| Antes | Después | Evidencia |
|---|---|---|
| Daniel Gomez | Daniel Gómez | alias «Gómez, Daniel» |
| Liliana Gimenez | Liliana Giménez | alias «Giménez, Liliana» |
| Maria Garcia | María García | alias «García, María» |
| Marina Ramirez | Marina Ramírez | alias «Ramírez, Marina» |
| Nazarena Ramirez | Nazarena Ramírez | alias «Ramírez, Nazarena» |
| Laura Ramirez | Laura Ramírez | alias «Ramírez, Laura» |
| Angel Cañete | Ángel Cañete | la variante «Ángel» ya traía la tilde (confianza media) |

Sin evidencia en los datos (NO aplicados; agregá filas en `_rename` si querés): Abigail Diaz → Abigail Díaz; David Diaz → David Díaz; Enrique Diaz → Enrique Díaz; Andres Valenciano → Andrés Valenciano; Angela Cejas → Ángela Cejas; Lorena Gomez → Lorena Gómez; Maria Guidi → María Guidi; Maria Vargas → María Vargas; Maria Laura Ponce → María Laura Ponce; Monica Cañete → Mónica Cañete; Rocio Cardozo → Rocío Cardozo; Damaris Mallqui → Dámaris Mallqui (Dámaris Crespo ya lleva tilde).

Además se quita el alias redundante «Emmanuel Cardozo» (igual al nombre).

## Nombres de texto que quedan por enlazar

En el programa/privilegios/salidas hay nombres escritos solo como texto. El script enlaza los que coinciden con **una sola** persona (mismas palabras en cualquier orden, sin acentos/mayúsculas). Estos no coinciden con nadie y seguirán en «Nombres sin vincular» (el editor los resuelve; nunca se crean solos):

Sin coma (nombres que no existen en el directorio): Osvaldo Camaño (1), Walter Pereyra (1), Juan L Cardozo (1), Esteban Picca (1), Alejandro Ocampo (1), Lucas Andreossi (1), Franco Álvarez (1), Ricardo Prieto (1), Carlos Desiati (1), Gómez David (1).

En formato «Apellido, Nombre» (27): el script enlaza los que tienen una única coincidencia; los que no existen como persona (p. ej. «Gómez, Máximo», «Valenciano, Daniela», «Gómez, Lorena», «Chavez, Loida», «Vallejos, Manuel», «Diaz, Ana», «Quiroz, Graciela», «Giai Gischia, Josué») siguen sin vincular.

## Totales

- Grupos activos: 19
- Personas que se fusionan y se borran: 25 (de 93 → 68)
- Renombres: 7

## Cómo verificarlo después de aplicar

```sql
select count(*) from public.people;                       -- 68
select name, aliases, duties from public.people order by name;
```

Y en la app: Gestión ▸ Personas ▸ «Nombres sin vincular» debería listar solo los nombres de la sección anterior.
