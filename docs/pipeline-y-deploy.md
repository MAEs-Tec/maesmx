# Pipeline y deploy

```
rama de trabajo ──PR──▶ dev ──PR──▶ master ──▶ aprobación ──▶ producción
                 ci           ci        ci
```

Dos workflows en `.github/workflows/`:

| Workflow | Cuándo corre | Qué hace |
|---|---|---|
| `ci.yml` | PR hacia `dev` o `master`; push a `dev` | Lint, pruebas, build, seed e integración con emuladores. |
| `deploy.yml` | Push a `master` (al fusionar un PR) o manual | Repite el CI y despliega a producción tras una aprobación. |

## CI (`ci.yml`)

Un solo job, `ci`, en Ubuntu con Node 22 y Java 21:

1. `npm ci` y `npm ci --prefix functions`.
2. `npm run lint`. Un error de lint hace fallar el check.
3. `npm test`.
4. `npm run build`.
5. `npm run test:emulator`: levanta Auth y Firestore, corre el seed y la prueba de integración.

No usa secretos, así que también funciona en PR desde forks.

## Deploy (`deploy.yml`)

1. Job `verify`: ejecuta `ci.yml` sobre el commit de `master`.
2. Job `deploy`: usa el environment `production`. GitHub lo deja en pausa hasta que un revisor lo aprueba.
3. Ya aprobado, construye el front con la configuración web del environment y despliega en este orden:
   1. Cloud Functions.
   2. Reglas e índices de Firestore y reglas de Storage.
   3. Hosting.

El backend va primero para que el front nuevo nunca llegue antes que las funciones o reglas que necesita. Si un paso falla, los siguientes no corren.

Solo un deploy a la vez: si se fusionan dos PR seguidos, el segundo espera al primero.

### Aprobar un deploy

En GitHub: pestaña **Actions**, la corrida de "Deploy a producción", **Review deployments**, marcar `production` y **Approve and deploy**. Antes de aprobar conviene revisar qué commits entran.

### Lanzarlo a mano

**Actions**, "Deploy a producción", **Run workflow**, rama `master`. Sirve para repetir un deploy que falló por algo externo. Desde cualquier otra rama solo corre la verificación.

## Configuración requerida

### Environment `production`

En **Settings > Environments > production**:

- **Required reviewers:** quienes pueden aprobar un deploy.
- **Deployment branches:** solo `master`.
- **Secreto `FIREBASE_SERVICE_ACCOUNT`:** el JSON completo de la llave de una cuenta de servicio de deploy.
- **Variables** (no secretos; son la configuración web pública del proyecto): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`.

Con GitHub CLI, desde una máquina que tenga el `.env` de producción. El clon tiene dos remotos (`origin` y `upstream`, la plantilla original), así que `--repo` evita que `gh` elija el equivocado y responda 403:

```sh
gh variable set --env production --env-file .env --repo MAEs-Tec/maesmx
gh secret set FIREBASE_SERVICE_ACCOUNT --env production --repo MAEs-Tec/maesmx < ruta/a/la-llave.json
```

En PowerShell, `<` no funciona; se usa `Get-Content ruta\a\la-llave.json -Raw | gh secret set ...`. Para no repetir `--repo`, corre una vez `gh repo set-default MAEs-Tec/maesmx`.

El workflow revisa al inicio que nada falte y que `VITE_FIREBASE_PROJECT_ID` sea el proyecto de deploy.

### Cuenta de servicio de deploy

Créala en Google Cloud (**IAM y administración > Cuentas de servicio**) dentro del proyecto `peer-teaching`, solo para el pipeline. Roles de partida, siguiendo mínimo privilegio:

| Rol | Para |
|---|---|
| Cloud Functions Admin | Desplegar funciones y sus permisos de invocación. |
| Service Account User | Actuar como la cuenta con la que corren las funciones. |
| Cloud Scheduler Admin y Pub/Sub Editor | Las funciones programadas. |
| Firebase Rules Admin | Reglas de Firestore y Storage. |
| Cloud Datastore Index Admin | Índices de Firestore. |
| Firebase Hosting Admin | Hosting. |
| Firebase Viewer | Lectura de la configuración del proyecto que hace el CLI. |
| Secret Manager Admin | Conectar el secreto `GITHUB_FEEDBACK_TOKEN` con la función `submitFeedback` (agregado el 25 de noviembre de 2026). |

Con estos roles corrió bien el primer deploy por pipeline (17 de noviembre de 2026, `firebase-tools` 14.25.0). Firebase no publica un conjunto mínimo único y cambia con la versión del CLI: si un deploy futuro falla por permisos, el error dice cuál falta; agrégalo y repite. La alternativa simple es el rol **Firebase Admin**, que funciona pero también da acceso de lectura y escritura a los datos.

La llave es una credencial de producción: no la guardes en el repo ni la compartas por chat. Si se filtra, bórrala en Google Cloud y genera otra.

### Secreto `GITHUB_FEEDBACK_TOKEN` (sugerencias y fallos)

La función `submitFeedback` abre un issue en `MAEs-Tec/maesmx` por cada sugerencia o fallo que mandan los usuarios (sin su nombre ni correo; esos datos se quedan en la colección `feedback` de Firestore). Usa un token de GitHub guardado como secreto de Firebase. **Si el secreto no existe, el deploy de functions falla**, así que hay que crearlo antes del primer deploy que incluya esta función.

1. En GitHub, crea un *fine-grained personal access token* (**Settings > Developer settings > Personal access tokens > Fine-grained tokens**) con acceso solo al repositorio `MAEs-Tec/maesmx` y el permiso **Issues: Read and write**. Ponle fecha de vencimiento y anótala para renovarlo.
2. Guárdalo en Firebase desde una terminal con sesión en el proyecto (te lo pide sin mostrarlo en pantalla):

   ```powershell
   npx --yes firebase-tools@14.25.0 functions:secrets:set GITHUB_FEEDBACK_TOKEN --project peer-teaching
   ```

3. La cuenta de servicio de deploy necesita además el rol **Secret Manager Admin** (el CLI le da acceso al secreto a la función al desplegar).

Para renovar el token, repite el paso 2 y vuelve a desplegar las funciones. Si el token vence o falta, las sugerencias se siguen guardando en Firestore con `issueError` y se ven en **Administrador > Sugerencias**; solo deja de abrirse el issue.

El mismo token lo usa `syncFeedbackIssueState`: cuando un admin o tec cambia el estado en **Administrador > Sugerencias**, el issue se cierra (Hecho → *completed*, Descartado → *not planned*) o se reabre (Nuevo, En revisión). Si GitHub falla, el estado se queda en la app y el motivo se guarda en `issueSyncError`, que la página muestra junto al número del issue. Cerrar un issue desde GitHub no cambia el estado en la app.

En el emulador no hace falta: sin token, la función guarda la sugerencia y anota que GitHub no está configurado. Para probar el issue en local, crea `functions/.secret.local` (ignorado por git) con `GITHUB_FEEDBACK_TOKEN=...` usando un token de prueba.

### Reglas de ramas

En **Settings > Rules > Rulesets**:

- `master`: cambios solo por PR, check `ci` obligatorio, sin force-push y sin borrado.
- `dev`: lo mismo.

Y en **Settings > General**: "Automatically delete head branches".

## Rollback

- **Solo el front (Hosting):** consola de Firebase, **Hosting**, historial de versiones, **Revertir** en la versión anterior. Es inmediato y no requiere deploy.
- **Código en general:** revierte el PR en GitHub (botón **Revert**), fusiona el revert a `master` y aprueba el deploy.
- **Reglas:** la consola de Firebase guarda el historial de reglas de Firestore y Storage y permite volver a una versión previa mientras llega el revert.
- **Datos:** el pipeline no migra ni respalda datos. Si un cambio necesita migración, se planea aparte y se describe en el PR.

## Deploy local de emergencia

El camino normal es el pipeline. Si GitHub Actions no está disponible:

```sh
git switch master
git pull
npm run deploy
```

`scripts/check-deploy-branch.js` cancela el deploy si no estás en `master` o si hay cambios sin commit. Saltarlo (`ALLOW_DEPLOY_ANY_BRANCH=1`) deja producción con código que no está en `master`; si lo haces, avisa al equipo y regulariza con un PR.

## Notas de operación

- **Funciones que ya no están en el código.** En modo no interactivo el CLI no borra funciones desplegadas que desaparecieron del repo y marca error. Se borran a mano con `firebase functions:delete <nombre>`.
- **Índices.** El deploy crea los índices de `firestore.indexes.json` pero no borra los que sobren en el proyecto. Un índice nuevo puede tardar minutos en construirse; si el front depende de él, espera a que termine antes de aprobar el deploy que lo usa o sepáralo en dos salidas.
- **Versión del CLI.** `firebase-tools` está fijo en la misma versión en `package.json`, `scripts/lib/emulator-config.js` y los workflows. Al actualizarla, cámbiala en los tres lugares.
