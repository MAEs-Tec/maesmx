# Pruebas

Todas las pruebas usan el corredor integrado de Node (`node:test`); no hay framework adicional.

## Qué hay

| Archivo | Cubre | Necesita emulador |
|---|---|---|
| `functions/tests/advisory-requests.test.cjs` | Servicio de solicitudes de asesoría (Cloud Functions). | No |
| `functions/tests/role-sync.test.cjs` | Sincronización del rol entre Firestore y el claim de Auth. | No |
| `tests/roles.test.mjs` | Edición de roles desde el cliente. | No |
| `tests/advisory-requests-ui.test.mjs` | Vistas y componentes de solicitudes. | No |
| `tests/advisory-profile.test.mjs` | Solicitudes desde el perfil del MAE. | No |
| `tests/perfil-mae.test.mjs` | Perfil del MAE con datos incompletos. | No |
| `tests/maeteca-import.test.mjs` | Lectura y validación de la carga masiva de Maeteca. | No |
| `tests/image-compress.test.mjs` | Cálculo del tamaño destino al comprimir imágenes. | No |
| `tests/firestore-size.test.mjs` | Estimación del tamaño de documentos de Firestore. | No |
| `tests/resize-storage-photos.test.mjs` | Herramienta de redimensionado de fotos en Storage. | No |
| `tests/advisory-requests.integration.test.mjs` | Flujo completo de solicitudes contra Firestore. | Sí |

Varias pruebas del cliente leen el código fuente de `src/` y extraen funciones concretas para ejecutarlas aisladas, sin montar la app.

## Cómo correrlas

```sh
npm test               # unitarias; la de integración se salta sola
npm run test:emulator  # levanta Auth y Firestore, corre el seed y la integración
```

`npm run test:emulator` necesita Java. La prueba de integración se niega a correr si el host de Firestore no es local o si el proyecto no empieza con `demo-`, así que no puede apuntar a producción por error.

Para correr un solo archivo:

```sh
node --test tests/roles.test.mjs
```

## Qué corre el pipeline

En cada PR hacia `dev` o `master` y en cada push a `dev`: lint (informativo), `npm test`, `npm run build` y `npm run test:emulator`. Ver [pipeline-y-deploy.md](pipeline-y-deploy.md).

## Agregar una prueba

- Cliente: `tests/<tema>.test.mjs`. Cloud Functions: `functions/tests/<tema>.test.cjs`. Con ese nombre `npm test` la toma sola.
- Las Cloud Functions nuevas conviene escribirlas como en `functions/advisory-requests.js` y `functions/role-sync.js`: una fábrica que recibe `db` y `auth`, para poder probarla con dobles sin emulador.
- Si la prueba necesita Firestore real, sigue el patrón de la de integración: se salta cuando no existe `FIRESTORE_EMULATOR_HOST` y exige un proyecto `demo-`.

## Huecos conocidos

- Las reglas de Firestore solo se prueban para solicitudes de asesoría (dentro de la prueba de integración). El resto de `firestore.rules` y todo `storage.rules` no tienen pruebas automáticas.
- No hay pruebas de extremo a extremo en navegador. La revisión manual se hace con `npm run dev:local` y las cuentas de prueba.
- El lint todavía reporta errores heredados en `src/`, por eso en el pipeline es informativo.
