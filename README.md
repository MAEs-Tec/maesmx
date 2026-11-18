# MAEs MX

Plataforma de asesorías entre pares (MAEs) del Tecnológico de Monterrey. Los estudiantes encuentran a un MAE por materia y horario, piden asesoría y la evalúan; los MAEs registran sus horas y ganan puntos; coordinación lleva asistencia, anuncios y administración.

Producción: <https://peer-teaching.web.app>

## Stack

- **Front:** Vue 3, Vue Router, Vite, PrimeVue.
- **Backend:** Firebase (Auth, Firestore, Cloud Functions en Node 22, Storage y Hosting).
- **Pruebas:** `node:test`, con el Firebase Emulator para integración.
- **Pipeline:** GitHub Actions.

## Requisitos

- Node 22 y npm.
- Java 21 (solo para los emuladores de Firebase).

## Arranque rápido

```sh
git clone https://github.com/MAEs-Tec/maesmx.git
cd maesmx
npm install
npm run dev:local
```

`npm run dev:local` levanta los emuladores de Firebase, siembra una base de prueba y abre la app en <http://localhost:5173>. No necesita credenciales ni toca producción. Al terminar de sembrar imprime las cuentas de prueba (una por rol).

Para ver el front con los datos de **producción** hace falta un `.env` (plantilla en `.env.example`) y se usa `npm run dev`. Ese modo lee y escribe datos reales: ver [docs/entornos.md](docs/entornos.md).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev:local` | Emuladores + datos de prueba + front, en un solo comando. |
| `npm run dev` | Front local contra lo que diga `.env` (producción). |
| `npm run emulators` | Solo los emuladores (Auth, Firestore, Functions, Storage). |
| `npm run seed` | Siembra los datos de prueba en emuladores ya levantados. |
| `npm test` | Pruebas unitarias. |
| `npm run test:emulator` | Seed y pruebas de integración contra el emulador. |
| `npm run lint` | ESLint sin modificar archivos. `npm run lint:fix` corrige lo automático. |
| `npm run build` | Build de producción en `dist/`. |

## Ramas y deploy

- `master` es producción. Solo recibe cambios por PR desde `dev`; al fusionar, el pipeline despliega tras una aprobación.
- `dev` es la rama de integración. El trabajo se hace en ramas cortas (`feature/…`, `fix/…`, `chore/…`) que salen de `dev` y vuelven por PR.

Detalle en [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentación

| Documento | Contenido |
|---|---|
| [docs/arquitectura.md](docs/arquitectura.md) | Estructura del código, roles, rutas, modelo de datos, Cloud Functions y reglas. |
| [docs/entornos.md](docs/entornos.md) | Entorno local con emuladores, local con datos de producción, CI y producción. |
| [docs/pipeline-y-deploy.md](docs/pipeline-y-deploy.md) | Qué corre el pipeline, cómo se aprueba un deploy, configuración y rollback. |
| [docs/pruebas.md](docs/pruebas.md) | Qué pruebas hay, cómo correrlas y cómo agregar más. |
| [docs/solicitudes-asesoria.md](docs/solicitudes-asesoria.md) | Diseño de los avisos y solicitudes de asesoría. |
| [docs/sistema-de-puntos.md](docs/sistema-de-puntos.md) | Reglas de puntos y logros. |
| [CHANGELOG.md](CHANGELOG.md) | Cambios por versión. |
| [docs/historico/](docs/historico/) | Notas de trabajos ya cerrados. Pueden estar desactualizadas. |
