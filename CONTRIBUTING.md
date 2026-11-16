# Cómo contribuir

## Ramas

| Rama | Para qué | Cómo entra código |
|---|---|---|
| `master` | Lo que está en producción. | Solo por PR desde `dev` (o desde `hotfix/…` en una urgencia). |
| `dev` | Integración: lo siguiente que saldrá a producción. | Solo por PR desde ramas de trabajo. |
| `feature/…`, `fix/…`, `chore/…`, `docs/…` | Un cambio concreto. | Salen de `dev` y se borran al fusionar. |

No hay más ramas permanentes. Una rama de trabajo debería vivir días, no meses.

Nombres: tipo, diagonal y una descripción corta en minúsculas con guiones, por ejemplo `feature/maeteca-recursos` o `fix/perfil-sin-horario`. Nada de nombres de persona ni de "pruebas".

## Flujo de un cambio

1. Actualiza `dev` y crea tu rama:
   ```sh
   git switch dev
   git pull
   git switch -c feature/mi-cambio
   ```
2. Trabaja con datos de prueba (`npm run dev:local`). Ver [docs/entornos.md](docs/entornos.md).
3. Antes de subir, corre lo mismo que el pipeline:
   ```sh
   npm run lint
   npm test
   npm run build
   ```
   Si tocaste `functions/`, `firestore.rules` o el seed, corre también `npm run test:emulator`.
4. Sube la rama y abre un PR hacia `dev`. El check `ci` debe quedar en verde.
5. Al fusionar, GitHub borra la rama.

## Sacar a producción

1. Abre un PR de `dev` hacia `master`. En la descripción resume qué sale y si hay pasos manuales (migraciones de datos, índices nuevos).
2. Fusiónalo con **merge commit** (no squash), para que `master` conserve la historia de `dev`.
3. El workflow de deploy corre las pruebas y se detiene a esperar aprobación. Un revisor del environment `production` lo aprueba en la pestaña Actions.
4. Revisa producción.

Detalle, configuración y rollback: [docs/pipeline-y-deploy.md](docs/pipeline-y-deploy.md).

### Urgencias (hotfix)

Si producción está rota y `dev` trae cambios que no deben salir: crea `hotfix/…` desde `master`, abre el PR hacia `master` y, una vez desplegado, lleva el arreglo a `dev` con otro PR (de `master` hacia `dev`).

## Pull requests

- Un PR, un tema. Si el título necesita una "y", probablemente son dos.
- Describe qué cambia para el usuario y cómo lo probaste.
- Cambios en `firestore.rules`, `storage.rules`, `functions/` o en permisos por rol piden una segunda revisión con calma: un error ahí afecta datos reales.
- No subas `.env`, llaves de cuentas de servicio ni respaldos de datos. El repositorio es público.

## Commits

Mensajes cortos en español que digan qué hace el cambio, con el área al inicio cuando ayuda: `Maeteca: carga en masa desde Excel`.

## Ramas viejas

Las ramas con trabajo que no llegó a `dev` se archivaron como tags `archive/<nombre-de-la-rama>` antes de borrarse. Para recuperar una:

```sh
git fetch --tags
git switch -c rescate/mi-rama archive/mi-rama
```
