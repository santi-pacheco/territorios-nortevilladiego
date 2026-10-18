# Territorios — app Android (TWA)

App Android mínima que abre https://nortevilladiego.vercel.app/salidas a pantalla completa
(Trusted Web Activity con Chrome). No contiene la web: **cada deploy del sitio actualiza la app
sola**, sin reinstalar. Los recordatorios Web Push llegan como notificaciones de la app
(delegación de notificaciones de la TWA, sin Firebase).

- Paquete: `ar.org.nortevilladiego.territorios` (el mismo que el placeholder de Capacitor en
  `apps/mobile`; solo una de las dos apps puede publicarse con ese id).
- Android 7.0+ (minSdk 24, lo exige androidbrowserhelper 2.7), targetSdk 36.
- Íconos: `node apps/twa/scripts/gen-icons.mjs` (desde la raíz) los regenera a partir de
  `apps/web/public`.

## Compartir e instalar el APK

1. Mandar `Territorios.apk` por WhatsApp, Drive, etc.
2. En el teléfono, abrirlo. Android pide **permitir instalar apps de origen desconocido** para la
   app desde la que se abre (WhatsApp, Archivos, Chrome…): Ajustes → Permitir de esta fuente.
3. Instalar y abrir. La primera vez el sitio pide permiso de notificaciones (Android 13+).

Requiere Chrome (u otro navegador con TWA) actualizado. Sin él, abre en una pestaña normal.

## Volver a compilar

Requisitos: Android SDK y el JDK de Android Studio.

```sh
cd apps/twa
# local.properties (no se commitea): sdk.dir=C:/Users/<usuario>/AppData/Local/Android/Sdk
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
./gradlew assembleRelease bundleRelease
```

- APK: `app/build/outputs/apk/release/app-release.apk`
- AAB (para Play Store): `app/build/outputs/bundle/release/app-release.aab`

La firma sale de `apps/twa/keystore.properties` (no se commitea):

```properties
storeFile=C:/Users/<usuario>/.territorios-keys/territorios-release.jks
storePassword=...
keyAlias=territorios
keyPassword=...
```

o de las variables `TWA_KEYSTORE_FILE`, `TWA_KEYSTORE_PASSWORD`, `TWA_KEY_ALIAS`,
`TWA_KEY_PASSWORD`. Las contraseñas están en `%USERPROFILE%\.territorios-keys\README.txt`.

## Nueva versión

Solo hace falta si cambia algo de la app nativa (ícono, nombre, URL, colores, permisos). En
`app/build.gradle` subir `versionCode` (entero, siempre mayor: 1 → 2) y `versionName`
(`1.0.0` → `1.0.1`), recompilar y repartir el APK. Se instala encima sin perder datos.

## Llave de firma: hacer copia

`%USERPROFILE%\.territorios-keys\` (keystore + README con contraseñas) **debe tener copia de
seguridad** (gestor de contraseñas y copia offline). Si se pierde, no se puede actualizar la app:
habría que desinstalarla en todos los teléfonos e instalar una nueva. Nunca commitearla.

## Digital Asset Links

`apps/web/public/.well-known/assetlinks.json` declara el paquete y la huella SHA-256 de la llave.
Si no coincide (otra llave, o Play App Signing, que firma con su propia llave: agregar también
esa huella), la app muestra la barra de URL de Chrome. Comprobar después de cada deploy:

```sh
curl -i https://nortevilladiego.vercel.app/.well-known/assetlinks.json   # 200, application/json
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```
