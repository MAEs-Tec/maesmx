# Arquitectura

## 1. Qué es y para quién

MAEs MX es la plataforma de asesorías entre pares del Tecnológico de Monterrey. Los estudiantes consultan MAEs activos, horarios, asesorías grupales y la Maeteca (videos y PDF de apoyo), y publican solicitudes de asesoría. Los MAEs registran turnos y acumulan puntos. Coordinación y administración gestionan asistencia, anuncios, materias y usuarios.

Es una SPA de Vue 3 que habla directamente con Firebase. Producción es el proyecto `peer-teaching` (ver `.firebaserc`). Entornos, pruebas y deploy se describen en `docs/entornos.md`, `docs/pruebas.md` y `docs/pipeline-y-deploy.md`.

## 2. Stack

| Capa | Tecnología | Versión (según `package.json`) |
|---|---|---|
| Paquete | `sakai-vue` | 3.8.0 |
| UI | Vue 3, Vue Router 4 | `vue ^3.2.41`, `vue-router ^4.1.5` |
| Componentes | PrimeVue, PrimeFlex, PrimeIcons | `^3.30.2`, `^3.3.1`, `^7.0.0` |
| Build | Vite, `@vitejs/plugin-vue`, Sass | `^4.2.1`, `^4.1.0`, `^1.55.0` |
| Firebase (cliente) | SDK modular de Firebase | `firebase ^10.14.1` |
| Gráficas y hojas de cálculo | `chart.js`, `xlsx`, `exceljs`, `file-saver` | `3.3.2`, `^0.18.5`, `^4.4.0`, `^2.0.5` |
| Cloud Functions | Node, `firebase-functions`, `firebase-admin` | Node `22`, `^4.0.0`, `^11.0.0` |
| Historial de rutas | `createWebHashHistory` (rutas con `#`) | n/a |

Las funciones usan la API de primera generación (`functions.https.onCall`, `functions.auth.user()`, `functions.pubsub.schedule`, `functions.firestore.document`). El proyecto Firebase incluye Hosting, Auth, Firestore, Storage y Functions (`firebase.json`).

## 3. Mapa del repositorio

```
.
├── firebase.json            Hosting (dist, rewrite SPA, cachés), functions, firestore, storage y puertos de emuladores
├── firestore.rules          Reglas de Firestore
├── firestore.indexes.json   Índices compuestos
├── storage.rules            Reglas de Storage
├── vite.config.js           Alias '@' -> src
├── index.html
├── public/                  Estáticos (favicon, temas, assets de insignias y fondos)
├── src/
│   ├── main.js              Arranque: PrimeVue, init de Firebase, conexión a emuladores si VITE_USE_EMULATOR=true
│   ├── App.vue
│   ├── auth/roles.js        Roles, grupos, lectura del claim, sincronización, menú por rol
│   ├── router/index.js      Rutas, meta.roles y guard global
│   ├── layout/              AppLayout, AppTopbar, AppMenu (menú por rol), AppSidebar, AppFooter, AppConfig
│   ├── firebase/
│   │   ├── adminApi.js      Wrappers httpsCallable de funciones de administración
│   │   ├── db/              Acceso a Firestore y a callables de solicitudes (ver sección 9)
│   │   ├── img/users.js     Fotos de perfil y portadas de anuncios en Storage
│   │   └── cache/           Caché en memoria/persistente con TTL y etiquetas de invalidación
│   ├── utils/               Utilidades puras (puntos, horarios, importación de Maeteca, compresión de imágenes, errores)
│   ├── components/          MaeCard, InformacionMae, Annoucement, RequestNotifications, componentes de Maeteca
│   └── views/               Una vista por ruta; views/pages/auth/ (login, registro, acceso denegado), views/pages/ (landing, 404)
├── functions/
│   ├── index.js             Exporta todas las Cloud Functions y define las de administración y anuncios
│   ├── advisory-requests.js Servicio de solicitudes de asesoría (callables, trigger de eventos, tarea programada)
│   ├── role-sync.js         Lógica de claims de rol (alta, auto-sincronización, trigger de Firestore)
│   └── tests/               Pruebas de las dos piezas anteriores
├── scripts/                 Herramientas de línea de comandos, no forman parte del bundle
│   ├── check-deploy-branch.js    Guarda de deploy (predeploy de firebase.json)
│   ├── seed-emulator.js          Usuarios de prueba en emuladores
│   ├── security-audit.js, exploit-authz.js   Auditoría de reglas contra emuladores
│   ├── migrate-role-claims.js    Migración puntual de claims desde Firestore
│   ├── measure-firestore-storage.js, lib/    Medición de almacenamiento de Firestore (solo lectura)
│   ├── storage-tools/            Utilidad independiente para redimensionar fotos en Storage
│   └── video-maeteca.ps1         Script auxiliar de video promocional
├── tests/                   Pruebas con `node --test` (roles, solicitudes, Maeteca, compresión de imágenes, tamaño de Firestore)
└── docs/                    Documentación (este archivo, solicitudes de asesoría, plan de Maeteca, diagnóstico de costos)
```

En la raíz hay además documentos históricos (`ESTADO_PROYECTO.md`, `EMULATOR_GUIA.md`, `GO_PROD_GUIA.md`, `PENTEST_REPORTE.md`, `CHANGELOG.md`) que no se usan como fuente de esta página.

## 4. Roles y permisos

### Roles

Definidos en `ROLES` (`src/auth/roles.js`). El mismo conjunto valida el trigger de sincronización (`VALID_ROLES` en `functions/role-sync.js`).

| Rol | Uso |
|---|---|
| `admin` | Administración completa |
| `tec` | Equipo técnico: usuarios y materias; en reglas equivale a admin salvo borrados y colecciones internas |
| `coordi` | Coordinación de un campus: asistencia, anuncios, solicitudes de su campus |
| `subjectCoordi` | Coordinación de materia; entra en el grupo `mae` y en el bloque Coordi del menú |
| `mae` | MAE activo |
| `publi` | Publicidad; gestiona anuncios |
| `exmae` | MAE dado de baja; sin acceso a vistas con `meta.roles` |
| `user` | Estudiante; rol por defecto |

### Grupos (`ROLE_GROUPS`)

| Grupo | Roles |
|---|---|
| `admin` | `admin` |
| `techAdmin` | `admin`, `tec` |
| `coordi` | `admin`, `tec`, `coordi` |
| `mae` | `admin`, `tec`, `coordi`, `subjectCoordi`, `mae`, `publi` |

Los grupos se usan para construir el menú (`buildMenuForRole`). El control de acceso a rutas usa las listas `meta.roles` de cada ruta, no los grupos.

### Cómo llega el rol al cliente

1. **Fuente de verdad: el campo `role` de `users/{matrícula}`.** Solo `admin` y `tec` pueden cambiarlo desde el navegador (`firestore.rules`). El id del documento es la parte local del correo institucional.
2. **El claim `role` de Firebase Auth** es la copia que leen el cliente y las reglas. Se mantiene así:
   - `initializeUserRoleClaim` (trigger de Auth `onCreate`) fija el claim al crear la cuenta. Toma el rol del perfil solo si el correo está verificado y es `@tec.mx`; en cualquier otro caso asigna `user`.
   - `syncOwnRoleClaim` (callable) permite que el propio usuario pida la sincronización de su claim con su perfil. No recibe el rol como parámetro. El cliente la llama desde `ensureRoleClaim` al iniciar sesión (`Login.vue`) solo cuando la cuenta está verificada y el claim difiere del rol del perfil.
   - `syncUserRoleClaimOnWrite` (trigger de Firestore sobre `users/{userId}`) reescribe el claim cada vez que cambia el campo `role` o se crea o borra el documento. Es el camino que cubre la edición de roles desde las vistas de administración, que escriben el documento directamente (`updateUserToMae`, `checkAndUpdateUserRole` en `src/firebase/db/users.js`).
   - `syncRoleClaim` y `setUserMaeRole` (callables solo `admin`) sincronizan el claim de un usuario por correo o matrícula; `setUserMaeRole` además actualiza `role` y `status` del documento. Existen wrappers en `src/firebase/adminApi.js`, pero ninguna vista los importa hoy.
3. **Lectura en el cliente.** `getClaimsRole()` fuerza una renovación del token (`getIdTokenResult(true)`), lee `claims.role` y lo guarda en caché por sesión; sin claim usa `user`. El listener `onAuthStateChanged` renueva el rol una vez por inicio de sesión.
4. **Reglas de Firestore.** `role()` usa el claim y, si la cuenta no tiene claim, cae al campo `role` del documento `users/{matrícula}`. Las reglas de Storage solo usan el claim y, sin él, tratan al usuario como `user`.
5. **Funciones de solicitudes de asesoría** no usan el claim: leen el rol del perfil en Firestore (`actor()` en `functions/advisory-requests.js`).

## 5. Rutas

Todas usan hash (`#/ruta`). Las rutas hijas de `AppLayout` heredan `meta.requiresAuth`. La columna de roles es `meta.roles`; "autenticados" significa que la ruta solo exige sesión.

| Ruta | Vista | Roles permitidos |
|---|---|---|
| `/` | `views/pages/Landing.vue` | Pública |
| `/auth/login`, `/auth/register`, `/auth/password-reset`, `/auth/access`, `/auth/error` | `views/pages/auth/*` | Públicas |
| `/pages/notfound` | `views/pages/NotFound.vue` | Pública |
| `/inicio` | `Inicio.vue` | Autenticados |
| `/solicitudes/:id?` | `SolicitudesAsesoria.vue` | Autenticados |
| `/maesactivos` | `MaesActivos.vue` | Autenticados |
| `/horarios` | `Horarios.vue` | Autenticados |
| `/asesoriasGrupales` | `AsesoriasGrupales.vue` | Autenticados |
| `/mae/:id` | `PerfilMAE.vue` | Autenticados |
| `/biblioteca` | `Biblioteca.vue` | Autenticados |
| `/halloffame` | `HallofFame.vue` | Autenticados |
| `/maeteca` | `Maeteca.vue` | Autenticados |
| `/documentation` | `views/utilities/Documentation.vue` | Autenticados (plantilla Sakai) |
| `/profile` | `ConfiguracionMAE.vue` | `admin`, `coordi`, `mae`, `tec` |
| `/leaderboard` | `Leaderboard.vue` | `admin`, `coordi`, `mae`, `tec` |
| `/misasesorias` | `Asesorias.vue` | `admin`, `coordi`, `mae`, `tec`, `publi` |
| `/misevaluaciones` | `Evaluaciones.vue` | `admin`, `coordi`, `mae`, `tec`, `publi` |
| `/asistenciaGrupales` | `AsistenciaGrupales.vue` | `admin`, `coordi`, `mae`, `tec`, `publi` |
| `/coordi` | `Coordi.vue` | `admin`, `coordi`, `tec` |
| `/gestionAnuncios` | `GestionAnuncios.vue` | `admin`, `coordi`, `tec`, `publi` |
| `/admin/asesorias` | `AdminAsesorias.vue` | `admin`, `tec` |
| `/admin/usuarios` | `AdminUsers.vue` | `admin`, `tec` |
| `/admin/materias` | `AdminSubjects.vue` | `admin`, `tec` |
| `/admin/funciones` | `AdminFunciones.vue` | `admin`, `tec` |
| `/admin/dashboard` | `Dashboard.vue` | `admin`, `tec` |
| `/admin/historialAsistencia` | `AdminHistorialAsistencias.vue` | `admin` |

### Guard (`router.beforeEach`)

1. Si ninguna ruta coincidente tiene `requiresAuth`, deja pasar.
2. Si no hay usuario, redirige a `/auth/login`. Conserva el destino en el query para tres enlaces: `/solicitudes/:id` y `/mae/:id?requestId=...` (como `requestId`) y `/asesoriasGrupales?asesoriaId=...` (como `redirect` y `asesoriaId`).
3. Con usuario, obtiene el rol con `getClaimsRole()` y llama a `canAccessRoute`, que toma el `meta.roles` del último registro coincidente. Una ruta sin `meta.roles` admite a cualquier autenticado, incluido `exmae`.
4. Si el rol no está permitido, redirige a `/auth/access`.
5. Solo en desarrollo (`import.meta.env.DEV`) y con `VITE_DEV_ALL_ROLES=true` se omite la comprobación de rol.

El guard protege la navegación del cliente; la seguridad real está en las reglas y en las funciones.

### Menú

`AppMenu.vue` construye el menú con `buildMenuForRole`. Un par de diferencias con el router: el bloque Coordi se muestra también a `subjectCoordi` aunque `/coordi` y `/gestionAnuncios` no lo admiten, y el bloque MAE (que incluye Leaderboard) se muestra a `subjectCoordi` y `publi`, a quienes `/leaderboard` rechaza. Las rutas `/admin/asesorias`, `/admin/funciones` y `/admin/dashboard` aparecen en el menú solo para `admin`, aunque el router también admite `tec`.

## 6. Modelo de datos (Firestore)

Los nombres de campo salen de lo que escribe el código y de lo que validan las reglas; no hay un esquema formal. "Cliente" significa escritura desde el navegador, sujeta a las reglas de la sección 8.

### `users/{matrícula}`

El id es la parte local del correo institucional en minúsculas.

| Campo | Notas |
|---|---|
| `id`, `uid`, `email`, `name`, `firstname`, `lastname` | Los crea `createUser` al registrarse (`uid` es la matrícula, no el UID de Auth) |
| `career`, `area`, `campus` | Carrera, escuela y sede |
| `role`, `status` | `status` toma `estudiante`, `becario` o `voluntario` |
| `weekSchedule`, `subjects` | Horario semanal y materias que asesora |
| `activeSession` | `{ peerInfo, location, status, startTime }`; `startTime` debe ser la hora del servidor |
| `totalTime` | Minutos acumulados |
| `points`, `ratingBonusPoints`, `badges`, `useCoins`, `background`, `myBackground` | Gamificación y personalización |
| `photoURL` | URL de la foto en Storage |
| `advisoryHistoryVersion` | Contador que usa `registerRequestedAdvisory` para detectar registros simultáneos |

Escribe: cliente (dueño, coordinación de su campus, `admin`/`tec`, y cualquier autenticado sobre `points`, `ratingBonusPoints` y `badges`); la función `registerRequestedAdvisory` (puntos, bono y versión de historial).

### `schools/tec.mx/subjects`, `schools/tec.mx/campus`, `schools/tec.mx/majors`

Catálogos. Las materias tienen al menos `id`, `name` y `area` (campos que consume `createAdvisoryRequest`). El código del cliente solo escribe materias (`addSubject`, `upsertSubjects`, `deleteSubject` en `db/subjects.js`, solo `admin`/`tec`); no encontré en el repositorio quién crea o edita `campus` y `majors`.

### `announcements/{id}`

Anuncios y asesorías grupales: `type`, `dateTime`, `visible`, `imageUrl`, `createdAt`, `maesAsignados`, `preregister` (mapa por matrícula), `asistence` (mapa por matrícula), `pointsAwarded`, `pointsAwardedAt`, `pointsAwardedTo`, además de los campos de contenido que envía la vista. Escribe: cliente (`admin`/`tec`/`coordi`/`publi`; un `mae` solo los campos de asistencia y puntos; un estudiante solo su propio preregistro y su propia asistencia). La función `cleanupExpiredAnnouncements` borra anuncios.

### `attendance/{aaaa-mm-dd}` y `attendance/{fecha}/report/{matrícula}`

El documento de fecha solo guarda `initialized: true`. Cada reporte guarda `id`, `report` (valor de asistencia, por ejemplo `RR` para reposición) y, si existen, `email`, `name` y `totalTime`. Escribe: cliente (`admin`/`tec`/`coordi`).

### `asesorias/{id}`

Registro de una asesoría y su evaluación: `peerInfo` y `userInfo` (`uid`, `name`, `career`, `area`, `campus`, foto; `userInfo.role`), `subject`, `rating`, `comment`, `date`, `duplicate`, `pointsAwarded`, `pointsReason`, `pointsSubjectId`, `pointsAwardedAt`. Hay dos orígenes:

- Flujo antiguo: el estudiante crea el documento desde el navegador (`addAsesoria`).
- Flujo vinculado: `registerRequestedAdvisory` crea `request_{requestId}` con `requestId` y `assignmentVersion`; las reglas impiden que el cliente cree o altere esos campos.

La misma colección guarda documentos de configuración con `_type` (`reveal_config`, `evaluations_cleared_config`) que escribe el cliente (`db/settings.js`); los registros de prueba llevan `_test: true`.

### `videos/{id}`

Recursos de la Maeteca (la colección se llama `videos` pero también guarda PDF): `Tipo` (`video` o `pdf`), `Titulo`, `Informacion`, `Materia`, `Carrera`, `Relacionado`, `Video` (enlace de YouTube) o `Archivo`/`ArchivoPath`/`ArchivoNombre` (PDF en Storage), `createdBy`, `createdAt`. Escribe: cliente (`admin`/`tec`/`coordi`). Más detalle en `docs/maeteca-recursos-plan.md`.

### Solicitudes de asesoría

Descritas en [`docs/solicitudes-asesoria.md`](solicitudes-asesoria.md). Resumen de datos:

| Ruta | Contenido | Escribe |
|---|---|---|
| `advisoryRequests/{id}` | Solicitud: `creatorKey`, `studentKey`, `campus`, `subject`, `topic`, `status`, `closeReason`, `assignedMaeKey`, `assignmentVersion`, `activeOfferCount`, `broadcastMode`, `broadenAt`, `advisoryId` | Solo funciones |
| `advisoryRequests/{id}/offers/{maeKey}` | Oferta del MAE: ubicación, estado, versión de asignación | Solo funciones |
| `advisoryRequests/{id}/events/{eventId}` | Evento que dispara las notificaciones | Solo funciones; ningún cliente lo lee |
| `advisoryRequests/{id}/recipients/{userKey}` | Quién puede leer la solicitud por haber sido avisado | Solo funciones |
| `advisoryRequestLocks/{matrícula}_{materia}` | Candado para una sola solicitud activa por estudiante y materia | Solo funciones (sin regla para clientes: denegado) |
| `advisoryNotifications/{matrícula}/items/{id}` | Notificación privada con `readAt` | Funciones crean; el dueño solo actualiza `readAt` |

### Colecciones con reglas pero sin uso en el cliente

`firestore.rules` define reglas para `group_sessions`, `requests`, `schedule`, `bot_flags` y `discord`, y `firestore.indexes.json` incluye índices de `requests`. No encontré referencias a esas colecciones en `src/` ni en `functions/`; no puedo confirmar quién las escribe (por ejemplo, un bot externo).

## 7. Cloud Functions

Quince exports en total. Los exports de `functions/index.js` incluyen los del servicio de solicitudes, que viven en `functions/advisory-requests.js`.

| Nombre | Tipo | Quién puede llamarla | Qué hace | Archivo |
|---|---|---|---|---|
| `initializeUserRoleClaim` | Trigger de Auth (`onCreate`) | Automático | Fija el claim `role` al crear la cuenta (`user` si el correo no está verificado o no hay perfil) | `functions/index.js`, lógica en `functions/role-sync.js` |
| `syncOwnRoleClaim` | Callable | Cualquier autenticado | Reescribe su propio claim con el rol de su perfil; devuelve `{ role, changed }` | `functions/index.js`, lógica en `functions/role-sync.js` |
| `syncRoleClaim` | Callable | `admin` | Sincroniza el claim de un usuario (por correo) con su perfil | `functions/index.js` |
| `setUserMaeRole` | Callable | `admin` | Actualiza `role` y `status` del perfil (por matrícula) y su claim | `functions/index.js` |
| `syncUserRoleClaimOnWrite` | Trigger de Firestore (`users/{userId}` `onWrite`) | Automático | Mantiene el claim alineado cuando cambia `role`; reintenta si el rol cambia durante la sincronización | `functions/index.js`, lógica en `functions/role-sync.js` |
| `cleanupExpiredAnnouncements` | Programada (`0 0 1 * *`, `America/Mexico_City`) | Automático | Borra anuncios con `visible: true` y `dateTime` vencido | `functions/index.js` |
| `createAdvisoryRequest` | Callable | Estudiante con correo `@tec.mx` verificado y perfil; publicar por otro correo exige `coordi`/`admin`/`tec` | Crea la solicitud, su candado y los eventos de aviso | `functions/advisory-requests.js` |
| `offerAdvisoryHelp` | Callable | MAE con turno vigente en el campus de la solicitud (y con la materia, si el aviso es por materia) | Registra o renueva su oferta | `functions/advisory-requests.js` |
| `withdrawAdvisoryOffer` | Callable | El MAE que ofreció | Retira su oferta | `functions/advisory-requests.js` |
| `assignAdvisoryRequest` | Callable | Estudiante o creador de la solicitud, `admin`, `tec` o `coordi` del mismo campus | Asigna una oferta activa | `functions/advisory-requests.js` |
| `unassignAdvisoryRequest` | Callable | Los mismos que asignan | Retira la asignación y reabre la solicitud | `functions/advisory-requests.js` |
| `closeAdvisoryRequest` | Callable | Los mismos que asignan | Cierra con `not_held` o `missing_registration` | `functions/advisory-requests.js` |
| `registerRequestedAdvisory` | Callable | Solo el estudiante de la solicitud | En una transacción crea la asesoría vinculada, suma puntos y bono al MAE y marca la solicitud como registrada | `functions/advisory-requests.js` |
| `deliverAdvisoryNotification` | Trigger de Firestore (`advisoryRequests/{requestId}/events/{eventId}` `onCreate`) | Automático | Crea las notificaciones de cada destinatario sin duplicarlas | `functions/advisory-requests.js` |
| `broadenAdvisoryRequests` | Programada (cada minuto, `America/Mexico_City`) | Automático | Caduca solicitudes a las 3 h, amplía avisos, expira ofertas obsoletas y avisa a MAEs que inician turno | `functions/advisory-requests.js` |

Las funciones de rol de `functions/index.js` usan los helpers `assertRole` y `requiredString`; `assertRole` lee `context.auth.token.role`. Las funciones de solicitudes validan el rol contra el perfil de Firestore.

## 8. Reglas de seguridad

La regla final de ambos archivos niega todo lo que no coincida con una ruta explícita.

### Firestore (`firestore.rules`)

| Colección | Lectura | Escritura |
|---|---|---|
| `users/{id}` | Cualquier autenticado | Crear: su propio documento con `role: user` y `status: estudiante`, o `admin`/`tec`. Actualizar: `admin`/`tec`; el dueño sin tocar `role`, `status` ni `campus`, con `activeSession` solo con hora del servidor y `totalTime` solo al cerrar turno y hasta lo que duró; `coordi` del mismo campus sin tocar `role`, `status`, `campus`, `activeSession` ni `subjects`; y cualquier autenticado solo sobre `points`, `ratingBonusPoints` y `badges`. Borrar: `admin` |
| `schools/**` | Público | `admin`/`tec` |
| `announcements/{id}` | Público | Crear y borrar: `admin`/`tec`/`coordi`/`publi`. Actualizar: esos roles; `mae` solo asistencia y puntos; estudiante solo su preregistro y su confirmación de asistencia |
| `attendance/{fecha}` y `report/*` | Autenticados | `admin`/`tec`/`coordi` |
| `asesorias/{id}` | Autenticados | Crear: autenticado, salvo ids `request_*` y campos `requestId`/`assignmentVersion`. Actualizar: sin `requestId`, `coordi`+ o el estudiante dueño sobre `rating`, `comment` y campos de puntos; con `requestId`, solo `rating` y `comment`. Borrar: `admin`, no si es vinculada |
| `videos/{id}` | Público | `admin`/`tec`/`coordi` |
| `advisoryRequests/{id}` | Correo `@tec.mx` verificado y (gestor de la solicitud o con documento en `recipients`) | Nadie desde el cliente |
| `advisoryRequests/{id}/offers/{maeKey}` | Gestor de la solicitud o el propio MAE | Nadie |
| `advisoryRequests/{id}/events/*` | Nadie | Nadie |
| `advisoryRequests/{id}/recipients/{userKey}` | El propio usuario | Nadie |
| `advisoryNotifications/{usuario}/items/*` | El dueño | El dueño solo `readAt` con la hora del servidor; sin crear ni borrar |
| `group_sessions`, `requests` | `admin` o participante (`userInfo.uid`/`peerInfo.uid` igual al UID de Auth) | `admin` o participante; crear: autenticado |
| `schedule` | Autenticados | `admin` |
| `bot_flags`, `discord` | `admin` | `admin` |

Un "gestor de la solicitud" es el estudiante, el creador, `admin`/`tec` o `coordi` del mismo campus.

### Storage (`storage.rules`)

| Ruta | Lectura | Escritura |
|---|---|---|
| `announcements/**` | Autenticados | Crear y actualizar: `admin`/`tec`/`coordi`/`publi`, solo imágenes menores de 5 MB. Borrar: esos roles |
| `users/{correo}/photo` | Autenticados | El dueño (correo del token igual al de la ruta): imagen menor de 2 MB; también puede borrarla |
| `maeteca/{recurso}/{archivo}` | Autenticados | Crear: `admin`/`tec`/`coordi`, solo PDF de 1 byte a menos de 10 MB. Borrar: esos roles. No hay regla de actualización |
| Cualquier otra ruta | Nadie | Nadie |

## 9. Acceso a datos en el cliente

`src/main.js` inicializa Firebase con las variables `VITE_FIREBASE_*` y exporta `firebaseApp`, `firestoreDB`, `firebaseStorage` y `auth`. Con `VITE_USE_EMULATOR=true` conecta Firestore, Auth, Functions y Storage a los emuladores locales antes de montar la app.

| Módulo | Atiende |
|---|---|
| `src/firebase/db/users.js` | Perfil y registro (`createUser`), turnos (`startActiveSession`, `stopActiveSession`), horario, materias, puntos, insignias, fondos, listados para leaderboard y MAEs activos, y las operaciones de administración sobre usuarios (cambio de rol, reseteos) |
| `src/firebase/db/asesorias.js` | Asesorías y evaluaciones: alta del flujo antiguo, conteos por periodo, estadísticas, bono por calificación, limpieza |
| `src/firebase/db/advisoryRequests.js` | Solicitudes de asesoría: wrappers de los callables y suscripciones (`onSnapshot`) a solicitudes, ofertas y notificaciones |
| `src/firebase/db/annoucement.js` | Anuncios y asesorías grupales: CRUD, preregistro y confirmación de asistencia, visibilidad |
| `src/firebase/db/attendance.js` | Reportes de asistencia por fecha |
| `src/firebase/db/maeteca.js` | Recursos de la Maeteca (videos y PDF): consulta, alta individual y en masa, edición, borrado; sube PDF a Storage |
| `src/firebase/db/subjects.js`, `campuses.js`, `majors.js` | Catálogos de `schools/tec.mx/...` |
| `src/firebase/db/settings.js` | Documentos de configuración de evaluaciones guardados en `asesorias` |
| `src/firebase/img/users.js` | Fotos de perfil (`users/{correo}/photo`) y portadas de anuncios (`announcements/...`). Vuelve a llamar `initializeApp` con la misma configuración |
| `src/firebase/adminApi.js` | Wrappers de `syncRoleClaim`, `setUserMaeRole` y `updateInactiveMaeRoles`; sin importadores en el código actual |
| `src/firebase/cache/` | Caché con TTL y etiquetas; las funciones de `db/` invalidan etiquetas al escribir |
| `src/utils/` | `PointsUtils` (cálculo de puntos), `HorarioUtils`, `PerfilUtils`, `ProfileData`, `AnunciosUtils`, `CoordiUtils`, `maetecaImport` y `maetecaTemplate` (carga en masa), `imageCompress`, `FirebaseErrors` |

## 10. Deudas conocidas

- **Puntos desde el navegador.** `updatePoints` se llama desde `Coordi.vue` y `AdminFunciones.vue`; `updateRatingBonusForMae` desde `Inicio.vue` y `PerfilMAE.vue`; `updateExperienceAsesorias` (flujo antiguo `addAsesoria`) suma puntos al MAE. Para que funcione, la regla de `users` permite a cualquier autenticado modificar `points`, `ratingBonusPoints` y `badges` de otros (el comentario de la regla lo documenta como solución transitoria). Solo `registerRequestedAdvisory` lo hace en servidor. Las reglas de puntos y su diseño están en [`docs/sistema-de-puntos.md`](sistema-de-puntos.md).
- **Insignias desde el cliente.** `updateUserAchievementBadge` se ejecuta al abrir perfiles y el leaderboard, y escribe en el documento de otro usuario.
- **Operaciones masivas en el navegador.** Los reseteos de horas y puntos, la limpieza de horarios, la baja de MAEs y el borrado de asesorías viejas de `AdminFunciones.vue` se ejecutan con el SDK de cliente y dependen de que `admin`/`tec` puedan escribir `users` y `asesorias`.
- **Wrappers sin uso.** `adminApi.js` no tiene importadores, y `updateInactiveMaeRolesAdmin` llama a una función `updateInactiveMaeRoles` que ya no existe en `functions/`. `syncRoleClaim` y `setUserMaeRole` siguen desplegadas sin que la interfaz las use.
- **Configuración dentro de `asesorias`.** `reveal_config` y `evaluations_cleared_config` viven como documentos de la colección de asesorías, por lo que las consultas de asesorías deben filtrarlos.
- **Menú y rutas no coinciden** para `subjectCoordi`, `publi` y `tec` (sección 5).
- **Historial leído fuera de la transacción.** En `registerRequestedAdvisory` el historial del MAE se lee antes de la transacción y se compensa con `advisoryHistoryVersion` y hasta cinco reintentos.
- **Colecciones sin consumidor visible.** Reglas e índices de `group_sessions`, `requests`, `schedule`, `bot_flags` y `discord` sin uso en este repositorio (sección 6).
- **Código heredado en `db/users.js`.** Contiene funciones de migración puntual (`addExtraVariables`, `addBackgroundUsers`, `addBadgesToEligibleUsers`) y archivos grandes que concentran varias responsabilidades.
- **Segunda inicialización de Firebase** en `src/firebase/img/users.js`, que duplica la configuración de `src/main.js`.
