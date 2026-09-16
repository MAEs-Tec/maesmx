# Plan — Migración completa a custom claims (Opción B)

## Goal

Reemplazar la autorización basada en el campo `role` de Firestore por custom
claims de Firebase Auth, de forma **coherente y completa** (código cliente +
Cloud Functions + reglas de seguridad), con un script de migración para los
usuarios existentes y todo commiteado en `dev`.

## Contexto / estado actual

- Repo: `C:/Users/adolf/OneDrive/Escritorio/UNI/MAES/Main/maesmx`, rama `dev`,
  `HEAD = cb93135`.
- El sistema nuevo de custom claims (`src/auth/roles.js`, `src/firebase/adminApi.js`,
  `firestore.rules`, `storage.rules`, +22 Cloud Functions) fue **descartado del
  working tree** en un paso anterior y **ya no existe** ni en disco ni en HEAD.
- Lo único que quedó es `.firestore.rules` (con punto) en HEAD, que es un híbrido
  inconsistente: algunas reglas ya piden `request.auth.token.role == 'admin'`
  (custom claim) pero **nada** en el código asigna ese claim → cualquier admin
  quedaría bloqueado en producción. Ese es el bug que motivó esta tarea.
- El router actual (`src/router/index.js`) usa `getCurrentUser()` y lee `role`
  desde el doc de Firestore. `AppMenu.vue` hace lo mismo.
- `firebase.json` en HEAD NO declara las reglas nuevas (`firestore.rules` /
  `storage.rules`); solo `firestore.indexes.json`.
- Credencial de servicio disponible para scripts admin:
  `C:\Users\adolf\Downloads\peer-teaching-firebase-adminsdk-ik5zh-9d0f0e4335.json`
  (proyecto `peer-teaching`). `firebase-admin@^11` ya está en
  `functions/node_modules`. `firebase` CLI v14.25.0 instalado, logueado como
  `a01741767@tec.mx`.
- El usuario objetivo (admin) es `a01741767@tec.mx`, uid
  `xKzEzQSZbtN1tSapqwQxGxycozC2`.

## Arquitectura / enfoque

Tres capas que deben quedar alineadas con **una sola fuente de verdad**: el
custom claim `role` del token JWT de Auth.

1. **Auth** — el claim `role` se setea al crear usuario (`onCreate`, default `user`)
   y se sincroniza desde Firestore solo mediante Cloud Functions admin explícitas.
2. **Cliente** — `getClaimsRole()` lee `token.claims.role`; el router y el menú
   deciden por claim, no por Firestore.
3. **Seguridad** — `firestore.rules` y `storage.rules` autorizan por
   `request.auth.token.role`; las Cloud Functions valida con `assertRole`.

Los cambios de `role` en Firestore (hechos por funciones admin) DEBEN ir siempre
acompañados de `setCustomUserClaims`. No se permite que el cliente se reescriba
su propio claim con el valor de Firestore (se elimina esa ruta de escalación).

## Step-by-step tasks

Cada tarea es un commit independiente. Verificación con comando + salida esperada.

---

### Tarea 1 — Restaurar el skeleton de roles del cliente

Crear `src/auth/roles.js` con el contenido exacto de abajo (era el que existía
antes del descarte).

**Archivo: `src/auth/roles.js`**

```js
import { getAuth } from 'firebase/auth';

export const ROLES = {
    ADMIN: 'admin',
    TEC: 'tec',
    COORDI: 'coordi',
    SUBJECT_COORDI: 'subjectCoordi',
    MAE: 'mae',
    PUBLI: 'publi',
    USER: 'user',
    EXMAE: 'exmae'
};

export const ROLE_GROUPS = {
    admin: [ROLES.ADMIN],
    techAdmin: [ROLES.ADMIN, ROLES.TEC],
    coordi: [ROLES.ADMIN, ROLES.TEC, ROLES.COORDI],
    mae: [ROLES.ADMIN, ROLES.TEC, ROLES.COORDI, ROLES.SUBJECT_COORDI, ROLES.MAE, ROLES.PUBLI]
};

export async function getClaimsRole({ forceRefresh = false } = {}) {
    const user = getAuth().currentUser;
    if (!user) return null;

    const token = await user.getIdTokenResult(forceRefresh);
    if (token.claims.role) return token.claims.role;

    // Si no hay claim, devolver fallback SIN auto-reescribir el claim.
    // El claim debe ponerse por el flujo admin/migración, no por el cliente.
    return ROLES.USER;
}

export function canAccessRoute(route, role) {
    const matchedRoles = route.matched
        .map((record) => record.meta?.roles)
        .filter(Boolean);
    const allowedRoles = matchedRoles.length ? matchedRoles[matchedRoles.length - 1] : route.meta?.roles;

    return !allowedRoles || allowedRoles.includes(role);
}

export function buildMenuForRole(role, uid) {
    const model = [
        {
            label: 'Estudiante',
            items: [
                { label: 'Inicio', icon: 'pi pi-fw pi-home', to: '/inicio' },
                { label: 'Maes activos', icon: 'pi pi-fw pi-globe', to: '/maesactivos' },
                { label: 'Horarios', icon: 'pi pi-fw pi-clock', to: '/horarios' },
                { label: 'Asesorías grupales', icon: 'pi pi-fw pi-calendar', to: '/asesoriasGrupales' },
                { label: 'Maeteca', icon: 'pi pi-fw pi-desktop', to: '/maeteca' }
            ]
        }
    ];

    if (ROLE_GROUPS.techAdmin.includes(role)) {
        const adminItems = [
            { label: 'Usuarios', icon: 'pi pi-fw pi-users', to: '/admin/usuarios' },
            { label: 'Materias', icon: 'pi pi-fw pi-pencil', to: '/admin/materias' }
        ];

        if (role === ROLES.ADMIN) {
            adminItems.push(
                { label: 'Asesorías', icon: 'pi pi-fw pi-list', to: '/admin/asesorias' },
                { label: 'Funciones', icon: 'pi pi-fw pi-key', to: '/admin/funciones' },
                { label: 'Dashboard', icon: 'pi pi-fw pi-chart-bar', to: '/admin/dashboard' },
                { label: 'Historial asistencia', icon: 'pi pi-fw pi-history', to: '/admin/historialAsistencia' }
            );
        }

        model.push({ label: 'Administrador', items: adminItems });
    }

    if (ROLE_GROUPS.mae.includes(role)) {
        model.push({
            label: 'MAE',
            items: [
                { label: 'Mi perfil', icon: 'pi pi-fw pi-user-edit', to: `/mae/${uid}` },
                { label: 'Leaderboard', icon: 'pi pi-fw pi-star', to: '/leaderboard' },
                { label: 'Mis asesorías', icon: 'pi pi-fw pi-book', to: '/misasesorias' },
                { label: 'Mis evaluaciones', icon: 'pi pi-fw pi-heart', to: '/misevaluaciones' },
                { label: 'Asistencia grupales', icon: 'pi pi-fw pi-th-large', to: '/asistenciaGrupales' }
            ]
        });
    }

    if ([ROLES.ADMIN, ROLES.TEC, ROLES.COORDI, ROLES.SUBJECT_COORDI].includes(role)) {
        model.push({
            label: 'Coordi',
            items: [
                { label: 'Asistencia', icon: 'pi pi-fw pi-check-square', to: '/coordi' },
                { label: 'Gestión de anuncios', icon: 'pi pi-fw pi-cog', to: '/gestionAnuncios' }
            ]
        });
    }

    return model;
}
```

Nota: `getClaimsRole` aquí ya NO llama a `refreshMyRoleClaim` (esa ruta de
auto-reescritura se elimina por diseño, ver Riesgos).

**Verificar:**

```
# desde la raíz del repo
ls -la src/auth/roles.js
```
Salida esperada: el archivo existe, tamaño ~4 KB.

**Commit:**
```
git add src/auth/roles.js && git commit -m "feat(auth): restaura skeleton de roles por custom claims en cliente"
```

---

### Tarea 2 — Restaurar `adminApi.js` (wrappers de Cloud Functions)

Crear `src/firebase/adminApi.js`. Mantener los wrappers que existían, pero
**quitar `refreshMyRoleClaim`** (auto-reescritura eliminada) y quitar el
`callFunction('addSubject')`/etc. que dependan de funciones aún no creadas en
esta fase. Dejar únicamente los wrappers cuyas Cloud Functions sí se restauran en la Tarea 4.

```js
import { getFunctions, httpsCallable } from 'firebase/functions';
import { firebaseApp } from '../main';

const functions = getFunctions(firebaseApp);

async function callFunction(name, payload = {}) {
    const fn = httpsCallable(functions, name);
    const result = await fn(payload);
    return result.data;
}

// Roles / usuarios (solo lectura del rol vía función admin explícita, no auto-claim)
export function setUserMaeRoleAdmin({ matricula, role, status }) {
    return callFunction('setUserMaeRole', {
        matricula,
        role: role?.value || role,
        status: status?.value || status
    });
}

export function updateInactiveMaeRolesAdmin(file = null) {
    return callFunction('updateInactiveMaeRoles', { emails: file ? null : null });
}
```

Nota: los wrappers completos (puntos, badges, anuncios, materias, asistencia) se
restauran en la Tarea 4 junto con sus funciones. En esta tarea solo se restablece
el módulo mínimo para que `roles.js` no rompa imports. Si el linter/compilador
requiere más, completar en Tarea 4.

**Verificar:**
```
ls -la src/firebase/adminApi.js
```

**Commit:**
```
git add src/firebase/adminApi.js && git commit -m "feat(auth): restaura adminApi core (sin auto-claim)"
```

---

### Tarea 3 — Migrar router y menú a `getClaimsRole`

**Archivo `src/router/index.js`:**

- Reemplazar el import de `getCurrentUser` por `canAccessRoute` y `getClaimsRole`:

```js
import { createRouter, createWebHashHistory } from 'vue-router';
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { canAccessRoute, getClaimsRole } from '@/auth/roles';
import AppLayout from '@/layout/AppLayout.vue';
```

- En el `beforeEach`, reemplazar el bloque de resolución de rol:

```js
        const role = await getClaimsRole();
        if (canAccessRoute(to, role)) {
            return next();
        }
        return next("/auth/access");
```

(sustituye el bloque actual que hace `const { role } = await getCurrentUser();`
y los dos `if` de `to.meta.roles.includes(role)` → `/pages/notfound`.)

- Revisar las rutas admin: `admin/asesorias`, `admin/funciones`, `dashboard` deben
  quedar con `meta.roles: ['admin']` (antes `['admin','tec']`). Confirmar/editar si
  el HEAD actual aún las tiene como `['admin','tec']`.

**Archivo `src/layout/AppMenu.vue`:**

- Reemplazar la lógica de `onMounted` por:

```js
import { buildMenuForRole, getClaimsRole } from '@/auth/roles';

const model = ref([]);

onMounted(async () => {
    const role = await getClaimsRole();
    model.value = buildMenuForRole(role, getAuth().currentUser?.uid);
});
```

- Quitar el bloque grande de if/else que construía el menú manualmente.

**Verificar:**
```
git diff --stat src/router/index.js src/layout/AppMenu.vue
npm run lint        # si existe; si no, saltar con nota
```
Salida esperada: diff muestra los dos archivos; lint sin errores nuevos.

**Commit:**
```
git add src/router/index.js src/layout/AppMenu.vue && git commit -m "feat(auth): router y menu usan getClaimsRole"
```

---

### Tarea 4 — Restaurar Cloud Functions de roles y sincronización

Sobrescribir `functions/index.js` (el HEAD tiene solo 44 líneas con
`cleanupExpiredAnnouncements`). Conservar esa función y añadir:

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// --- helpers de roles ---
function assertAuthenticated(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication is required.');
    }
}
function getRole(context) {
    return context.auth?.token?.role || 'user';
}
function assertRole(context, allowedRoles) {
    assertAuthenticated(context);
    const role = getRole(context);
    if (!allowedRoles.includes(role)) {
        throw new functions.https.HttpsError('permission-denied', `Role '${role}' is not allowed.`);
    }
}
function requiredString(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new functions.https.HttpsError('invalid-argument', `${field} is required.`);
    }
    return value.trim();
}

// Al crear un usuario nuevo, asignar claim role: 'user'.
exports.initializeUserRoleClaim = functions.auth.user().onCreate(async (user) => {
    await admin.auth().setCustomUserClaims(user.uid, { role: 'user' });
});

// Función ADMIN explícita para sincronizar el claim de UN usuario desde Firestore.
// No es auto-reescritura: requiere rol admin para ejecutarse.
exports.syncRoleClaim = functions.https.onCall(async (data, context) => {
    assertRole(context, ['admin']);
    const email = requiredString(data.email, 'email').toLowerCase();

    const snap = await db.collection('users')
        .where('email', '==', email).limit(1).get();
    if (snap.empty) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
    }
    const role = snap.docs[0].data().role || 'user';

    const authUser = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(authUser.uid, { role });

    return { email, role };
});

// setUserMaeRole actualiza el doc Y el claim (sincronizado).
exports.setUserMaeRole = functions.https.onCall(async (data, context) => {
    assertRole(context, ['admin']);
    const matricula = requiredString(data.matricula, 'matricula').toLowerCase();
    const role = requiredString(data.role, 'role');
    const status = requiredString(data.status, 'status');
    const email = `${matricula}@tec.mx`;

    const snap = await db.collection('users').where('email', '==', email).get();
    if (snap.empty) return { updated: 0 };

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.update(doc.ref, { role, status }));
    await batch.commit();

    try {
        const authUser = await admin.auth().getUserByEmail(email);
        await admin.auth().setCustomUserClaims(authUser.uid, { role });
    } catch (e) {
        console.warn(`No se pudo setear claim para ${email}: ${e.message}`);
    }

    return { updated: snap.size };
});

// cleanupExpiredAnnouncements (conservar la versión actual del HEAD tal cual).
exports.cleanupExpiredAnnouncements = functions.pubsub.schedule('0 0 1 * *')
    .timeZone('America/Mexico_City')
    .onRun(async () => {
        // ... contenido actual sin cambios ...
    });
```

Nota: en esta fase solo se restauran las funciones de **roles y sincronización de
claim** (`initializeUserRoleClaim`, `syncRoleClaim`, `setUserMaeRole`) más la existente
`cleanupExpiredAnnouncements`. El resto de funciones admin (/anuncios, /materias,
/asistencia, /puntos) se restauran en una fase posterior — no bloquean esta migración.

**Verificar:**
```
# sintaxis
node --check functions/index.js
```
Salida esperada: sin errores (exit 0).

**Commit:**
```
git add functions/index.js && git commit -m "feat(auth): cloud functions de roles + sincronizacion de claim"
```

---

### Tarea 5 — Reglas de Firestore y Storage coherentes por claim

Crear `firestore.rules` (sin punto) con TODAS las reglas basadas en
`request.auth.token.role` (contenido que ya existía antes del descarte, copiado
abajo de forma íntegra):

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function role() {
      return signedIn() && request.auth.token.role is string
        ? request.auth.token.role
        : 'user';
    }

    function hasAnyRole(roles) {
      return signedIn() && role() in roles;
    }

    function isAdmin() {
      return hasAnyRole(['admin']);
    }

    function isTechAdmin() {
      return hasAnyRole(['admin', 'tec']);
    }

    function isCoordi() {
      return hasAnyRole(['admin', 'tec', 'coordi']);
    }

    function isContentManager() {
      return hasAnyRole(['admin', 'tec', 'coordi']);
    }

    function isOwnEmail(email) {
      return signedIn()
        && request.auth.token.email is string
        && email is string
        && email.lower() == request.auth.token.email.lower();
    }

    function isOwnUserDoc() {
      return isOwnEmail(resource.data.email);
    }

    function isCreatingOwnUserDoc() {
      return isOwnEmail(request.resource.data.email)
        && request.resource.data.role == 'user'
        && request.resource.data.status == 'estudiante';
    }

    function doesNotChangeProtectedUserFields() {
      return !request.resource.data.diff(resource.data).affectedKeys().hasAny([
        'role',
        'status',
        'points',
        'totalTime',
        'badges',
        'useCoins'
      ]);
    }

    match /users/{userId} {
      allow create: if isCreatingOwnUserDoc() || isTechAdmin();
      allow read: if signedIn();
      allow update: if isTechAdmin() || (isOwnUserDoc() && doesNotChangeProtectedUserFields());
      allow delete: if isAdmin();
    }

    match /schools/{schoolId}/subjects/{subjectId} {
      allow read: if true;
      allow write: if isTechAdmin();
    }

    match /schools/{document=**} {
      allow read: if true;
      allow write: if isTechAdmin();
    }

    match /announcements/{announcementId} {
      allow read: if true;
      allow create, update, delete: if isContentManager();
    }

    match /attendance/{dateId} {
      allow read, write: if isCoordi();

      match /report/{reportId} {
        allow read, write: if isCoordi();
      }
    }

    match /asesorias/{asesoriaId} {
      allow create: if signedIn();
      allow read: if signedIn();
      allow update: if isCoordi();
      allow delete: if isAdmin();
    }

    match /videos/{videoId} {
      allow read: if true;
      allow create, update, delete: if isContentManager();
    }

    match /{document=**} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }
  }
}
```

Crear `storage.rules`:

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    function signedIn() {
      return request.auth != null;
    }

    function role() {
      return signedIn() && request.auth.token.role is string
        ? request.auth.token.role
        : 'user';
    }

    function hasAnyRole(roles) {
      return signedIn() && role() in roles;
    }

    match /announcements/{allPaths=**} {
      allow read: if true;
      allow write: if hasAnyRole(['admin', 'tec', 'coordi']);
    }

    match /users/{email}/photo {
      allow read: if true;
      allow write: if signedIn()
        && request.auth.token.email is string
        && email.lower() == request.auth.token.email.lower();
    }

    match /{allPaths=**} {
      allow read: if true;
      allow write: if hasAnyRole(['admin']);
    }
  }
}
```

**Borrar el híbrido viejo**: eliminar `.firestore.rules` (con punto) para no
mantener dos archivos de reglas.

**Archivo `firebase.json`:** añadir `rules` a `firestore` y el bloque `storage`:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      { "source": "**", "destination": "/index.html" }
    ]
  },
  "functions": {
    "source": "functions"
  },
  "firestore": {
    "indexes": "firestore.indexes.json",
    "rules": "firestore.rules"
  },
  "storage": {
    "rules": "storage.rules"
  }
}
```

**Verificar:**
```
ls -la firestore.rules storage.rules firebase.json
git status --short
```
Salida esperada: los tres archivos presentes; `.firestore.rules` ausente (borrado).

**Commit:**
```
git rm .firestore.rules
git add firestore.rules storage.rules firebase.json && git commit -m "feat(auth): reglas de firestore y storage por custom claims"
```

---

### Tarea 6 — Script de migración de claims (usuarios existentes)

Crear `scripts/migrate-role-claims.js` que recorre TODOS los usuarios de Firestore
y setea el claim `role` en Auth según el campo `role` del doc. Usa la cuenta de
servicio por `GOOGLE_APPLICATION_CREDENTIALS`.

```js
// migrate-role-claims.js
// Setea el custom claim `role` a todos los usuarios existentes de Firestore.
// Uso:
//   GOOGLE_APPLICATION_CREDENTIALS="C:\Users\adolf\Downloads\peer-teaching-firebase-adminsdk-ik5zh-9d0f0e4335.json" \
//   NODE_PATH=functions/node_modules node scripts/migrate-role-claims.js [--dry-run]
const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'peer-teaching';
const DRY_RUN = process.argv.includes('--dry-run');

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

async function main() {
    const snap = await db.collection('users').get();
    let updated = 0;
    let skipped = 0;
    const failures = [];

    for (const doc of snap.docs) {
        const data = doc.data();
        const email = data.email;
        const role = data.role || 'user';

        if (doc.id === email?.split('@')[0] || true) {
            // el doc se clavea por el prefijo de email; usamos data.email
        }

        if (!email || typeof email !== 'string') {
            skipped += 1;
            continue;
        }

        try {
            if (DRY_RUN) {
                console.log(`[dry-run] ${email} -> ${role}`);
                updated += 1;
                continue;
            }
            const authUser = await admin.auth().getUserByEmail(email.toLowerCase());
            await admin.auth().setCustomUserClaims(authUser.uid, { role });
            updated += 1;
            console.log(`OK ${email} -> ${role}`);
        } catch (e) {
            failures.push(`${email}: ${e.message}`);
        }
    }

    console.log(`\nResumen: ${updated} procesados, ${skipped} sin email, ${failures.length} fallos.`);
    if (failures.length) failures.forEach((f) => console.log('FALLO', f));
    process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
```

Nota: quitar el bloque inútil `if (doc.id === ... || true)` antes de committear —
es un artefacto de plantilla; la lógica real solo necesita `email` y `role`.

**Verificar (dry-run, sin escribir):**
```
cd "C:/Users/adolf/OneDrive/Escritorio/UNI/MAES/Main/maesmx"
GOOGLE_APPLICATION_CREDENTIALS="C:\Users\adolf\Downloads\peer-teaching-firebase-adminsdk-ik5zh-9d0f0e4335.json" \
NODE_PATH=functions/node_modules node scripts/migrate-role-claims.js --dry-run
```
Salida esperada: listado `[dry-run] <email> -> <role>` uno por usuario, y al final
`Resumen: N procesados...`, sin fallos.

**Commit:**
```
git add scripts/migrate-role-claims.js && git commit -m "feat(auth): script de migracion de claims para usuarios existentes"
```

---

### Tarea 7 — Ejecutar la migración real

Correr el script SIN `--dry-run` y verificar leyendo de vuelta al admin.

```
cd "C:/Users/adolf/OneDrive/Escritorio/UNI/MAES/Main/maesmx"
GOOGLE_APPLICATION_CREDENTIALS="C:\Users\adolf\Downloads\peer-teaching-firebase-adminsdk-ik5zh-9d0f0e4335.json" \
NODE_PATH=functions/node_modules node scripts/migrate-role-claims.js
```
Salida esperada: `OK <email> -> <role>` por usuario; `Resumen` con 0 fallos.

Verificar el admin con un script de lectura puntual (o reutilizar un snippet):

```
NODE_PATH=functions/node_modules node -e "
const admin=require('firebase-admin');
admin.initializeApp({projectId:'peer-teaching'});
admin.auth().getUserByEmail('a01741767@tec.mx').then(u=>console.log('role:', u.customClaims && u.customClaims.role));
"
```
Salida esperada: `role: admin`.

No requiere commit (es ejecución, no cambio de código).

---

### Tarea 8 — Deploy y validación final

1. Deploy de reglas y funciones (requiere confirmación del usuario / entorno prod):

```
firebase deploy --only firestore:rules,storage:rules,functions
```

2. Validar que el admin entra (`role: admin` reflejado tras logout/login).

3. `git status` limpio y `git push`.

**Verificar:**
```
firebase deploy --only firestore:rules,storage:rules,functions
```
Salida esperada: `✔ Deploy complete!` sin errores.

---

## Tests / validación (resumen)

- Cada tarea tiene verificación con comando + salida esperada (arriba).
- Test de integración manual clave: login como `a01741767@tec.mx`, confirmar que
  el menú muestra la sección "Administrador" y que puede acceder a
  `/admin/dashboard` (que ahora es `roles: ['admin']`).
- Test negativo: un usuario `user` intentando `setUserMaeRole` debe recibir
  `permission-denied` (la función hace `assertRole(context, ['admin'])`).

## Riesgos, tradeoffs y preguntas abiertas

- **Ventana de inconsistencia durante el deploy**: si se despliegan las reglas
  (`firestore.rules`) ANTES de migrar los claims, ningún usuario tendrá `role` y
  todo write admin falla. Orden obligatorio: (1) migrar claims, (2) deploy reglas.
- **Eliminación de `refreshMyRoleClaim`**: es intencional; evita que un usuario
  se auto-ascienda reescribiendo su claim desde Firestore. El trade-off es que el
  rol en el token queda "stale" hasta el próximo refresh de token; mitigar forzando
  re-login tras un cambio de rol, y documentarlo.
- **`exists` de usuarios con email malformado**: el script salta (no falla) los que
  no tengan `email` string; revisar el `Resumen` por `skipped`.
- **Credencial hardcodeada en comandos**: la ruta de la cuenta de servicio aparece
  en los comandos. No commitear la key. Considerar mover a variable de entorno
  documentada (ya se respeta `GOOGLE_APPLICATION_CREDENTIALS`).
- **Pregunta abierta**: ¿el resto de Cloud Functions admin (anuncios, materias,
  asistencia, puntos) se restauran también en esta entrega, o es fase posterior?
  Este plan lo deja como fase posterior para no bloquear la migración de claims.
- **Pregunta abierta**: confirmar que las rutas admin quedan con `['admin']` (sin
  `tec`) como estaba en el diseño descartado, o si `tec` debe conservar acceso a
  `admin/asesorias`/`admin/funciones`/`dashboard`.
```