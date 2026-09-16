# Estado del proyecto — custom claims

Fecha de última revisión: 2026-09-09 (heartbeat)

## Estado: COMPLETADO (sin deploy a producción)

La migración a custom claims (Opción B) está implementada y commiteada en la
rama `custom-claims`. Nada se desplegó a producción (como se pidió).

## Commits

- `83938d8` feat(auth): migración a custom claims (roles en token JWT)
- `bc64ca6` docs: guía de deploy a producción para custom claims

## Qué se implementó

- `src/auth/roles.js` — ROLES, ROLE_GROUPS, getClaimsRole (sin auto-claim), canAccessRoute, buildMenuForRole
- `src/firebase/adminApi.js` — wrappers de Cloud Functions de roles
- `src/router/index.js` + `src/layout/AppMenu.vue` — autorización por getClaimsRole
- `functions/index.js` — initializeUserRoleClaim (onCreate), syncRoleClaim (admin), setUserMaeRole
- `firestore.rules` / `storage.rules` — reglas por request.auth.token.role
- `scripts/migrate-role-claims.js` — migración de claims (--dry-run)
- `GO_PROD_GUIA.md` — guía de deploy a producción

## Archivos descartados (recuperables o no)

No se pudieron recuperar por git (nunca se commitearon; solo blobs dangling).
Se recrearon desde contenido capturado previamente.

## Verificación realizada

- node --check: OK (functions + script)
- npm run build: compila limpio
- dry-run de migración contra producción real: 5146 usuarios, 0 fallos (solo lectura)

## Hallazgo pendiente de decisión (NO bloqueante)

19 usuarios con roles corruptos en Firestore:
- "Academic": 18 usuarios
- "a01735821": 1 usuario (matrícula donde debía ir un rol)

El script los marca como "no reconocidos" y los escribe tal cual (claim inerte).
Documentado en la guía con opciones de resolución.

## Pendientes (requieren acción manual del usuario)

1. Migración real (sin --dry-run) — DEBE ir ANTES del deploy de reglas
2. Deploy de functions → reglas → hosting (orden en GO_PROD_GUIA.md)
3. Decidir sobre los 19 roles corruptos
4. Migración del resto de funciones admin a adminApi.js (fase aparte, no cubierta)

## Agentes

Ningún agente/subagente corriendo. No hubo que relanzar nada.

## Nota sobre el heartbeat

Todas las iteraciones posteriores a la implementación no mostraron cambios.
El trabajo está terminado; no se esperan más cambios salvo que el usuario
inicie el deploy manual.