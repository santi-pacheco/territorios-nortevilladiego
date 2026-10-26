# Gestión (área de encargados)

Solo para encargados: arma las **salidas** de la semana. Entra por `/gestion` (el ícono de
Gestión en el menú lateral de la app). Si no iniciaste sesión con un perfil de encargado, la
pantalla te lo dice y te manda a la hoja de cuenta.

## Qué hace

- **Salidas** — semanario con navegación de lunes a lunes (`?semana=YYYY-MM-DD`). Cada día lista
  sus salidas y se editan en línea: cada campo se guarda **al salir del campo** (blur) con
  actualización optimista. Se puede **agregar** una salida por día y **borrar** con confirmación
  dentro de la fila más un aviso **Deshacer** de 6 segundos. El domingo muestra los territorios
  por grupo (G1–G4).
- **Carrito** — se carga de forma diferida. Mientras no exista, muestra "Próximamente". Es de
  otra tarea; este módulo no lo define.
- **Programa** — dos pestañas, **Entre semana** y **Fin de semana**, y solo aparece la que el
  perfil puede editar (`my_permissions().can_edit_programa_midweek` / `..._weekend`). Entre semana
  tiene **Cargar PDF** (la importación del programa y de la Guía de actividades) y **Editar a
  mano**; fin de semana se edita a mano. Cada semana muestra y guarda únicamente la reunión de la
  pestaña activa.

### Conflictos de escritura

Cada salida tiene `version`. Al guardar mandamos la versión que creemos vigente; si otra persona
guardó antes, el servidor responde 0 filas y el cliente muestra la hoja **"Alguien cambió esta
salida"** con tus valores y los de la otra persona. Elegís **Usar lo de ellos** (queda lo del
servidor) o **Guardar lo mío** (se reaplica tu cambio sobre la versión nueva).

## Crear un encargado de prueba (solo local)

El rol vive en `public.profiles.role` (`viewer` | `editor` | `admin`). La fila se crea con el
**service role** porque los clientes no pueden insertar perfiles. Nunca pongas la service key en
el repo ni en el bundle.

1. Levantá la base local: `npx supabase start`.
2. Sacá la URL y la service key: `npx supabase status` (`API_URL` y `SECRET_KEY`).
3. Creá el usuario y el perfil con un script **de un solo uso** (dejalo fuera del repo, por
   ejemplo en tu carpeta temporal). El script no contiene la clave: la recibe por variables de
   entorno. Hace dos llamados:

   ```
   # 1) alta del usuario (admin)
   POST {API_URL}/auth/v1/admin/users
     Authorization: Bearer {SECRET_KEY}
     { "email": "encargado@example.com", "password": "...", "email_confirm": true }

   # 2) perfil con rol editor (upsert por id)
   POST {API_URL}/rest/v1/profiles  Prefer: resolution=merge-duplicates
     Authorization: Bearer {SECRET_KEY}
     [{ "id": "{user.id}", "role": "editor", "display_name": "Encargado de prueba" }]
   ```

4. Entrá en la app: botón de cuenta → iniciar sesión con ese correo y contraseña.
   Después de entrar, `/gestion` deja de mostrar el aviso de sesión.

Un `viewer` (o nadie) ve el aviso "Necesitás iniciar sesión como encargado"; sirve para probar el
guardia.

## Comprobaciones

```bash
pnpm --filter @territorios/web typecheck
npx eslint apps/web/src/routes/gestion
pnpm --filter @territorios/web exec vitest run src/routes/gestion/salidas/conflict.test.tsx
```

La prueba de extremo a extremo (Playwright) vive en la carpeta temporal del agente: inicia sesión
como el encargado local, edita el lugar de una salida, recarga y verifica que la vista de
miembros (`/salidas/<día>`) muestre el valor nuevo.
