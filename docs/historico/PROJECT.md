@ -0,0 +1,235 @@
# MAEs Tec — Documentación del proyecto

Plataforma de asesorías y gestión de MAEs para el Tecnológico de Monterrey (campus de la plataforma MAE). Aplicación web SPA basada en Vue 3 + Vite, con backend serverless en Firebase (Firestore + Cloud Functions + Storage).

---

## 1. Resumen general

| Campo                  | Valor                                                                 |
|------------------------|-----------------------------------------------------------------------|
| Nombre del paquete     | `sakai-vue` (versión 3.8.0)                                            |
| Framework frontend     | Vue 3 (`^3.2.41`) + Vue Router 4 + Vite 4                              |
| Librería UI            | PrimeVue (`^3.30.2`) + PrimeFlex + PrimeIcons                          |
| Backend                | Firebase (Firestore, Auth, Cloud Functions, Storage)                    |
| Funciones (motor)      | Node 22 (`functions/index.js`), `firebase-admin ^11`, `firebase-functions ^4` |
| Estilo                 | SCSS (Sass `^1.55.0`) con tema oscuro personalizado                     |
| Historial               | `createWebHashHistory` (hash routing)                                  |
| Scripts npm            | `dev`, `build`, `deploy` (build + `firebase deploy`), `lint`, `preview` |

**Dependencias clave del frontend:** `firebase ^10.14.1`, `chart.js 3.3.2`, `file-saver`, `xlsx ^0.18.5` (lectura de Excel), `uuid ^10`, `vue-router ^4.1.5`.

---

## 2. Estructura del repositorio

```
maesmx/
├── firebase.json               # Config hosting + functions + firestore + storage
├── firestore.rules            # Reglas de seguridad de Firestore
├── firestore.indexes.json     # Índices compuestos
├── storage.rules              # Reglas de seguridad de Storage
├── package.json               # sakai-vue 3.8.0
├── vite.config.js             # Alias '@' → ./src
├── index.html                 # Punto de entrada
├── functions/
│   ├── index.js               # TODAS las Cloud Functions (backend, Node 22)
│   └── package.json           # maesmx-functions 1.0.0
├── public/                    # favicon, themes, assets estáticos
└── src/
    ├── main.js                # Bootstrap app + registro global PrimeVue + init Firebase
    ├── App.vue
    ├── auth/roles.js          # ROLES, ROLE_GROUPS, getClaimsRole, canAccessRoute, buildMenuForRole
    ├── firebase/
    │   ├── adminApi.js        # Wrappers de todas las Cloud Functions (httpsCallable)
    │   ├── db/                # Acceso directo a Firestore (client SDK)
    │   │   ├── annoucement.js, asesorias.js, attendance.js,
    │   │   ├── campuses.js, maeteca.js, majors.js, subjects.js, users.js
    │   └── img/users.js       # Segundo app Firebase (storage perfiles/anuncios)
    ├── layout/                # AppLayout, AppMenu, AppMenuItem, AppSidebar, AppTopbar, AppFooter...
    ├── router/index.js        # Rutas + guards por rol + requiresAuth
    ├── utils/                 # AnunciosUtils, CoordiUtils, HorarioUtils, PerfilUtils
    ├── components/            # MaeCard, InformacionMae, MateriasIntensivas, BlockViewer...
    ├── views/                 # Vistas de la app (ver sección 4)
    │   └── utilities/         # Documentation.vue
    └── assets/                # SCSS layout, images, demo styles
```

**Alias:** `vite.config.js` configura `@` → `./src` (usado en imports como `@/auth/roles`).

---

## 3. Sistema de roles y permisos

Definidos en `src/auth/roles.js`. Los roles viven en los *custom claims* de Firebase Auth (`token.role`), sincronizados desde el doc del usuario en Firestore.

### Roles (`ROLES`)

| Rol           | Descripción                                  |
|---------------|----------------------------------------------|
| `admin`       | Administrador (acceso total)                 |
| `tec`         | Tecnología / tech admin (materias, usuarios) |
| `coordi`      | Coordinador (asistencia, anuncios)           |
| `subjectCoordi`| Coordinador de materia                      |
| `mae`         | MAE activo                                    |
| `publi`       | Publicista / difusión                         |
| `exmae`       | MAE inactivo (dado de baja)                   |
| `user`        | Estudiante por defecto                        |

### Grupos de acceso (`ROLE_GROUPS`)

- `admin` → `admin`
- `techAdmin` → `admin`, `tec`
- `coordi` → `admin`, `tec`, `coordi`
- `mae` → `admin`, `tec`, `coordi`, `subjectCoordi`, `mae`, `publi`

### Flujo de rol en el cliente

`getClaimsRole()` lee `user.getIdTokenResult()` → si no existe `token.roles`, llama a `refreshMyRoleClaim()` (Cloud Function) que busca el rol en el doc `users/{email}` y lo vuelve a grabar como custom claim. `canAccessRoute()` contrasta los `meta.roles` de la ruta contra el rol activo.

---

## 4. Rutas principales (`src/router/index.js`)

Rutas públicas (sin auth): `landing` (raíz), `documentation`, `/auth/*`.

Rutas protegidas (`requiresAuth` + `meta.roles`):

| Ruta                        | Rol(es) permitido(s)                        |
|-----------------------------|---------------------------------------------|
| `/inicio`, `/maesactivos`, `/horarios`, `/biblioteca`, `/halloffame`, `/maeteca` | Todos los autenticados |
| `/profile`, `/leaderboard`  | `admin, coordi, mae, tec`                   |
| `/misasesorias`, `/misevaluaciones`, `/asistenciaGrupales` | `admin, coordi, mae, tec, publi` |
| `/coordi`, `/gestionAnuncios` | `admin, coordi, tec`                      |
| `/admin/usuarios`, `/admin/materias` | `admin, tec`                         |
| `/admin/asesorias`, `/admin/funciones`, `/admin/dashboard`, `/admin/historialAsistencia` | `admin` |

**Guard global** (`router.beforeEach`): si la ruta no requiere auth → pasa. Si requiere auth y no hay usuario → redirige a `/auth/login` (con manejo especial del query `asesoriaId` para asesorías grupales). Luego valida el rol y, si no hay acceso, redirige a `/auth/access`.

---

## 5. Cloud Functions (backend)

Todas en `functions/index.js` (Node 22). `admin.initializeApp()` sin argumentos (usa credenciales por defecto de Firebase).

### Autenticación / roles

| Función | Tipo | Descripción |
|---------|------|-------------|
| `initializeUserRoleClaim` | auth trigger (`onCreate`) | Al crear usuario nuevo, setea claim `role: 'user'` |
| `refreshMyRoleClaim` | callable | Lee rol del doc `users/{email}` y lo reescribe como claim |
| `setUserMaeRole` | callable (admin) | Convierte un estudiante (por matrícula → `@tec.mx`) a MAE/coordi/etc., inicializando datos del perfil si era `user`/`estudiante` |
| `updateInactiveMaeRoles` | callable (admin) | Da de baja MAEs inactivos (→ `exmae`) o reactiva según lista de emails (Excel importado) o por horario vacío + 0 horas |

### Mantenimiento / reseteo (admin)

- `clearAllUsersWeekSchedule` — vacía `weekSchedule` de todos los MAE roles.
- `clearUsersData` — resta puntos, limpia `subjects`, `totalTime`, `points`.
- `resetAllUsersTotalTimeAndPoints` — resetea `totalTime` y `points` de todos.
- `saveScheduleSubjectsExperience` — recalcula puntos por horario/materias.
- `deleteOldAsesorias` — borra asesorías de años anteriores.

### Puntos / badges

- `addUserPoints` (coordi) — suma/resta puntos (con badge #18 "Ups..." al restar).
- `updateUserAchievementBadge` — marca un badge como conseguido.

### Materias (`schools/tec.mx/subjects`)

- `addSubject`, `upsertSubjects`, `deleteSubject` — CRUD (techAdmin).

### Anuncios

- `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement`, `toggleAnnouncementVisibility` (contentManager).
- `cleanupExpiredAnnouncements` — pub/sub schedule `0 0 1 * *` (America/Mexico_City), borra anuncios `visible:true` con `dateTime` vencido.

### Asistencia

- `updateAttendanceReport` (coordi) — escribe `attendance/{fecha}/report/{uid}` con reporte.
- `addAttendanceRegister` (coordi) — registra `report: 'RR'`.
- `incrementTotalTime` (coordi) — suma horas a `totalTime` (conversión a minutos).

**Helpers internos:** `assertAuthenticated`, `assertRole`, `getRole`, `requiredString`, `chunkDocs` (batches de 450), `normalizeDate`, `dateKey`, `setRoleClaimByEmail`, `addUserPoints`, `sanitizeAnnouncement`.

**Constantes:** `BADGES` (18 badges), `BACKGROUNDS` (8 fondos de perfil), `ADMIN_ROLES`, `TECH_ADMIN_ROLES`, `CONTENT_MANAGER_ROLES`, `COORDI_ROLES`, `MAE_ROLES`.

---

## 6. Capa de acceso a datos (`src/firebase/`)

- **`adminApi.js`** — wrappers `httpsCallable` de TODAS las Cloud Functions (un export por función, con sufijo `Admin`). Cada función usa `callFunction(name, payload)` → `result.data`.
  - Incluye `readTecEmailsFromExcel(file)`: lee un `.xlsx`, extrae la columna `Matrícula` y genera emails `{matricula}@tec.mx`.
- **`db/*.js`** — acceso directo al client SDK de Firestore:
  - `users.js` (1034 líneas, el más grande), `asesorias.js`, `attendance.js`, `annoucement.js`, `maeteca.js`, `subjects.js`, `campuses.js`, `majors.js`.
  - `subjects/campuses/majors` leen de `schools/tec.mx/...`.
- **`img/users.js`** — app Firebase secundaria (`firebaseAppImage`) para manejo de fotos de perfil y anuncios en Storage.

### Config Firebase (`src/main.js`)

Config desde variables de entorno (`import.meta.env.VITE_FIREBASE_*`): `apiKey`, `authDomain`, `databaseURL`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, `measurementId`. Exporta `firebaseApp`, `firestoreDB`, `firebaseStorage`, `auth`.

`main.js` también registra globalmente todos los componentes de PrimeVue y services (ToastService, DialogService, ConfirmationService) y directivas (tooltip, badge, ripple, styleclass).

---

## 7. Reglas de seguridad

### Firestore (`firestore.rules`, v2)

Roles accedidos vía `request.auth.token.role`. Funciones auxiliares: `signedIn`, `role`, `hasAnyRole`, `isAdmin`, `isTechAdmin`, `isCoordi`, `isContentManager`, `isOwnEmail`, `isOwnUserDoc`, `isCreatingOwnUserDoc`, `doesNotChangeProtectedUserFields`.

| Colección | Reglas |
|-----------|--------|
| `users/{userId}` | create: solo doc propio de estudiante o techAdmin; read: cualquier autenticado; update: techAdmin o dueño (sin tocar campos protegidos); delete: admin |
| `schools/{...}/subjects/...` | read público; write techAdmin |
| `announcements/{id}` | read público; write contentManager |
| `attendance/{date}/report/{id}` | read/write coordi |
| `asesorias/{id}` | create/read autenticado; update coordi; delete admin |
| `videos/{id}` | read público; write contentManager |
| `{document=**}` (fallback) | read autenticado; write admin |

**Campos protegidos** en `users`: `role`, `status`, `points`, `totalTime`, `badges`, `useCoins` (un usuario normal no puede modificarlos a sí mismo).

### Storage (`storage.rules`, v2)

- `announcements/{...}`: read público, write `admin/tec/coordi`.
- `users/{email}/photo`: read público, write solo el dueño (email token == email ruta).
- `{allPaths=**}` (fallback): read público, write admin.

---

## 8. Vistas principales (`src/views/`)

- **Estudiante/MAE:** `Inicio`, `MaesActivos`, `Horarios`, `AsesoriasGrupales`, `PerfilMAE`, `Biblioteca`, `Leaderboard`, `HallofFame`, `Maeteca`, `Asesorias` (mis asesorías), `Evaluaciones`, `AsistenciaGrupales`, `PerfilMAE`, `ConfiguracionMAE`.
- **Coordi:** `Coordi` (asistencia), `GestionAnuncios`.
- **Admin:** `AdminAsesorias`, `AdminUsers`, `AdminSubjects`, `AdminFunciones`, `Dashboard`, `AdminHistorialAsistencias`.
- **Auth:** `Login`, `Register`, `PasswordReset`, `Access`, `Error`.
- **Landing:** `Landing`, `LandingTemplate`, `NotFound`.
- **Componentes de vista:** `Chart.vue`, `LoadingProfile.vue`.

---

## 9. Despliegue

- Script `npm run deploy`: `vite build && firebase deploy`.
- `firebase.json`: hosting (public `dist`, rewrite SPA a `/index.html`), functions (source `functions`), firestore (`firestore.indexes.json` + `firestore.rules`), storage (`storage.rules`).

---

## 10. Estado reciente del trabajo (rama `dev`)

Cambios sin commitear al momento de generar este documento:

**Nuevos archivos (staged):**
- `firestore.rules`, `storage.rules`
- `src/auth/roles.js` (sistema de roles por custom claims)
- `src/firebase/adminApi.js` (wrappers de Cloud Functions)

**Modificados (sin stage):**
- `firebase.json` — incluye `functions`, `firestore` (rules) y `storage` (rules)
- `functions/index.js` — +562 líneas: se añadieron ~22 Cloud Functions (roles, materias, anuncios, asistencia, mantenimiento de datos)
- `src/layout/AppMenu.vue` — menú ahora generado dinámicamente por rol
- `src/router/index.js` — rutas con `meta.roles` + guard de rol
- `src/views/AdminFunciones.vue`, `src/views/AdminSubjects.vue`, `src/views/Coordi.vue`, `src/views/GestionAnuncios.vue` — migradas a Cloud Functions vía `adminApi.js`

**Trabajo pendiente (no verificado aún):** ejecutar `npm run lint` y `npm run build` para validar que todo compila.