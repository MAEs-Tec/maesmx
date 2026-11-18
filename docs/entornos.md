# Entornos

| Entorno | Datos | Cómo se usa | Quién |
|---|---|---|---|
| Local con emuladores | Base de prueba sembrada, en memoria | `npm run dev:local` | Cualquiera, sin credenciales |
| Local con datos de producción | Proyecto real `peer-teaching` | `npm run dev` con un `.env` | Quien tenga la configuración web |
| CI | Emuladores en GitHub Actions | Automático en cada PR | — |
| Producción | Proyecto real `peer-teaching` | Deploy por pipeline desde `master` | Revisores del environment `production` |

No hay un proyecto de Firebase de desarrollo o staging: todo lo que no es producción corre en emuladores.

## Local con emuladores

Requisitos: Node 22 y Java 21.

```sh
npm install
npm run dev:local
```

El comando hace todo:

1. Revisa requisitos y que los puertos estén libres.
2. Levanta los emuladores de Auth, Firestore, Functions y Storage con el proyecto `demo-maesmx`.
3. Corre `scripts/seed-emulator.js`, que crea las cuentas y los datos de prueba.
4. Abre el front en <http://localhost:5173> conectado a los emuladores.

Con `Ctrl+C` se apaga todo. Los datos viven en memoria: cada arranque parte de la misma base sembrada, así que se puede romper lo que sea sin consecuencias.

| Servicio | Dirección |
|---|---|
| App | <http://localhost:5173> |
| Interfaz de emuladores | <http://127.0.0.1:4000> |
| Firestore | `127.0.0.1:8080` |
| Auth | `127.0.0.1:9099` |
| Functions | `127.0.0.1:5001` |
| Storage | `127.0.0.1:9199` |

### Cuentas de prueba

Todas usan la contraseña `password123` y solo existen en el emulador. El seed imprime la lista completa al terminar.

| Correo | Rol |
|---|---|
| `a00000001@tec.mx` | `admin` |
| `a00000002@tec.mx` | `tec` |
| `a00000003@tec.mx` | `coordi` |
| `a00000004@tec.mx` | `mae` (con turno abierto) |
| `a00000005@tec.mx` | `publi` |
| `a00000006@tec.mx` | `user` (estudiante con una solicitud abierta) |
| `a00000007@tec.mx` a `a00000011@tec.mx` | MAEs extra y una `subjectCoordi` |
| `a00000012@tec.mx` | `user` (segundo estudiante) |

Además de las cuentas, el seed crea catálogos (campus, carreras, materias), asesorías con y sin evaluación, anuncios y asesorías grupales, recursos de Maeteca, asistencia de los últimos 15 días y dos solicitudes de asesoría abiertas.

### Por qué no puede tocar producción

- El proyecto empieza con `demo-`: los SDK de Firebase tratan esos proyectos como locales y nunca llaman a servicios reales.
- `scripts/dev-local.js` pasa la configuración del emulador (`.env.emulator`) por variables de entorno del proceso, que en Vite tienen prioridad sobre cualquier `.env` o `.env.local` de tu máquina.
- El seed se niega a correr si el host no es local o el proyecto no empieza con `demo-`.

### Por partes

Si prefieres dejar los emuladores corriendo y reiniciar solo el front:

```sh
npm run emulators            # terminal 1
npm run seed                 # terminal 2, una vez
npx vite --mode emulator     # terminal 2
```

### Cambiar los datos de prueba

Los datos están en `scripts/seed-emulator.js`. Todo es ficticio; no copies ahí datos de producción (el repositorio es público). El pipeline corre el seed en cada PR, así que si deja de funcionar el check `ci` falla.

### Problemas comunes

- **"No se encontró Java".** Instala un JDK 21 y abre una terminal nueva.
- **"Estos puertos ya están en uso".** Hay otros emuladores u otro servidor de desarrollo abiertos. Ciérralos.
- **La primera vez tarda.** `npx` descarga `firebase-tools` y los emuladores; después quedan en caché.
- **Veo datos viejos después de reiniciar.** El front guarda una caché en el navegador (IndexedDB, base `maesmx-cache`). Bórrala desde las herramientas de desarrollo o abre una ventana privada.
- **Errores 404 de fotos en la consola.** Las cuentas de prueba no tienen foto de perfil; la app muestra la imagen por defecto.

## Local con datos de producción

Sirve para ver cómo se comporta un cambio con el volumen y la variedad de los datos reales.

1. Copia `.env.example` como `.env` y llena los valores con la configuración web del proyecto (consola de Firebase, Configuración del proyecto, Tus apps). `.env` no se sube al repo.
2. Corre `npm run dev`.

Ten presente:

- **Es producción.** Entras con tu cuenta real y todo lo que guardes, borres o edites afecta a usuarios reales. Úsalo para mirar, no para probar flujos que escriben.
- Las reglas, índices y Cloud Functions que se usan son los desplegados, no los de tu rama.
- Si tienes un `.env.local` con `VITE_USE_EMULATOR=true`, `npm run dev` apuntará a los emuladores. Para alternar entre base de prueba y producción usa los dos comandos (`npm run dev:local` y `npm run dev`) en vez de editar archivos.

## CI

GitHub Actions levanta los emuladores de Auth y Firestore, corre el seed y la prueba de integración (`npm run test:emulator`). No usa secretos ni toca ningún proyecto real. Ver [pipeline-y-deploy.md](pipeline-y-deploy.md).

## Producción

Proyecto `peer-teaching`, hosting en <https://peer-teaching.web.app>. Solo se despliega desde `master`, por el workflow de deploy y con aprobación. Ver [pipeline-y-deploy.md](pipeline-y-deploy.md).
