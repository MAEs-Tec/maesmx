# Emuladores de Firebase (desarrollo local)

Sirve para probar el sistema de custom claims SIN tocar producción. Corre todo
en tu laptop (Firestore, Auth, Functions, Storage + UI).

## Requisitos (ya los tienes)

- `firebase` CLI (14.x)
- Java 11+ (para Firestore/Auth emulator) — Java 21 OK
- Node 22

## Cómo usarlo (2 terminales)

Terminal 1 — levantar los emuladores:

```
firebase emulators:start
```

La primera vez descarga los binarios (Firestore jar, UI). Cuando veas la tabla
de puertos, está listo. La interfaz (Emulator UI) queda en
http://127.0.0.1:4000

Terminal 2 — poblar datos de prueba (usuarios + claims + docs):

```
NODE_PATH=functions/node_modules node scripts/seed-emulator.js
```

Crea 4 usuarios (con claim ya seteado):
- `admin@tec.mx` / `password123` — admin
- `coordi@tec.mx` / `password123` — coordi
- `mae@tec.mx` / `password123` — mae
- `user@tec.mx` / `password123` — user

Terminal 3 (o en el mismo 2) — levantar el front conectado a emuladores:

```
npm run dev
```

> El front detecta `.env.local` (que tiene `VITE_USE_EMULATOR=true`) y conecta
> Firestore/Auth/Functions/Storage a localhost. Si quieres volver a apuntar a
> producción, borra o renombra `.env.local`.

## Probar el flujo de roles

1. Abre la app (`npm run dev`, normalmente http://localhost:5173).
2. Login con `admin@tec.mx` / `password123`.
3. Verifica el menú "Administrador" y acceso a `/admin/dashboard`.
4. Login con `user@tec.mx` y confirma que NO ve opciones admin.

## Notas

- Las reglas (`firestore.rules`/`storage.rules`) se evalúan en el emulador, así
  que puedes validar permisos de verdad con el SDK de cliente (el Admin SDK de
  los scripts las bypassa).
- `initializeUserRoleClaim` (trigger onCreate) corre automáticamente en el
  emulador de Functions al crear usuarios.
- Los datos del emulador se borran de memoria al apagar, salvo que uses
  `--export-on-exit` / `--import`. El seed se re-corre en segundos.
- Las Cloud Functions nuevas (`syncRoleClaim`, `setUserMaeRole`) se pueden
  probar desde la Emulator UI o invocándolas vía el front (el wrapper
  `adminApi.js` ya apunta a Functions).