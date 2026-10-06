# Guía para llevar los custom claims a producción

Rama: `custom-claims` (commit `83938d8`). Nada de esto está desplegado todavía.

> IMPORTANTE — ORDEN OBLIGATORIO. Si despliegas las reglas ANTES de migrar los
> claims, ningún usuario tendrá `role` en su token y TODO write admin fallará
> (la app queda rota). Sigue los pasos en el orden exacto de abajo.

## Resumen del cambio

Antes: el rol se leía del doc de Firestore (`users/{email}.role`).
Ahora: el rol vive en el custom claim `role` del token JWT de Auth
(`request.auth.token.role`), con una sola fuente de verdad y sincronización
explícita vía Cloud Functions admin.

## Paso 0 — Precondiciones

- Estar en la rama `custom-claims` y commiteado:
  ```
  git checkout custom-claims
  git status
  ```
- Tener la cuenta de servicio:
  `C:\Users\adolf\Downloads\peer-teaching-firebase-adminsdk-ik5zh-9d0f0e4335.json`
- `firebase login` hecho (proyecto `peer-teaching`).

## Paso 1 — Migrar los claims (debe ir ANTES del deploy de reglas)

Ejecutar el script contra producción **sin** `--dry-run`:

```
cd C:\Users\adolf\OneDrive\Escritorio\UNI\MAES\Main\maesmx
GOOGLE_APPLICATION_CREDENTIALS="C:\Users\adolf\Downloads\peer-teaching-firebase-adminsdk-ik5zh-9d0f0e4335.json" \
NODE_PATH=functions/node_modules node scripts/migrate-role-claims.js
```

Qué esperar: líneas `OK <email> -> <role>` por usuario, y al final:
`Resumen: 5146 procesados, ... 0 fallos.`

**Atención a los roles NO reconocidos.** El script va a imprimir un bloque
"ATENCION - roles NO reconocidos". En los datos actuales hay 19 usuarios con
roles que no existen en el sistema:
- `"Academic"`: 18 usuarios
- `"a01735821"`: 1 usuario (una matrícula guardada donde debía ir un rol)

El script los escribe TAL CUAL como claim (`role: "Academic"`, etc.), que no
matchea nada en `ROLES`/`ROLE_GROUPS` (esos usan minúsculas). Esos usuarios
quedarán con un rol inerte (= se comportará como `user`). Decide ANTES de migrar
si quieres:
- (a) dejarlos así y corregir los docs de Firestore luego (cambiar `Academic` →
  `mae` o `user`), o
- (b) corregir primero esos 19 docs en Firestore y re-correr el script.
No es bloqueante para el deploy, pero esos 19 no tendrán el rol esperado.

## Paso 2 — Deploy de Cloud Functions

```
firebase deploy --only functions
```
Verifica que aparezcan: `initializeUserRoleClaim`, `syncRoleClaim`,
`setUserMaeRole` (además de `cleanupExpiredAnnouncements`).

## Paso 3 — Deploy de reglas (después de migrar claims)

```
firebase deploy --only firestore:rules,storage:rules
```
Nota: `firebase.json` ya apunta a `firestore.rules` (sin punto) y `storage.rules`.
El viejo `.firestore.rules` (híbrido) fue borrado — no volver a subirlo.

## Paso 4 — Validación

1. Logout + login como `a01741767@tec.mx` (admin). El menú debe mostrar la
   sección "Administrador" y poder entrar a `/admin/dashboard`.
2. Verificar el claim leyendo de vuelta Auth:
   ```
   NODE_PATH=functions/node_modules node -e "const a=require('firebase-admin'); a.initializeApp({projectId:'peer-teaching'}); a.auth().getUserByEmail('a01741767@tec.mx').then(u=>console.log('role:', u.customClaims&&u.customClaims.role));"
   ```
   Esperado: `role: admin`.
3. Test negativo: un usuario normal no debe poder ejecutar `syncRoleClaim`
   (la función hace `assertRole(['admin'])` → `permission-denied`).

## Paso 5 — Deploy del hosting (frontend)

```
npm run build
firebase deploy --only hosting
```

## Paso 6 — Push de la rama

```
git push -u origin custom-claims
```
(Abrir PR contra `dev` para revisión — recomendado antes de merge.)

## Rollback

Si algo sale mal tras el deploy de reglas:
1. Volver a desplegar las reglas viejas (reconstruir `.firestore.rules` híbrido
   o hacer `git checkout` del commit anterior y `firebase deploy --only firestore:rules`).
2. El router/AppMenu viejos puedes restaurarlos con `git revert`.

## Pendientes / decisiones abiertas (no resueltas en esta rama)

1. Los 19 usuarios con roles `Academic`/`a01735821` (ver Paso 1).
2. El resto de Cloud Functions admin (anuncios, materias, asistencia, puntos,
   reset) **no** se restauraron en esta rama. Las vistas admin (`AdminFunciones`,
   `AdminSubjects`, `Coordi`, `GestionAnuncios`, etc.) siguen usando el SDK
   directo de Firestore, NO `adminApi.js`. Si decides migrar esas vistas a
   Cloud Functions, es una fase aparte.
3. Las rutas `admin/asesorias`, `admin/funciones`, `admin/dashboard` quedaron
   con `roles: ['admin']` (antes `['admin','tec']`). Confirmar si `tec` debe
   conservar acceso.