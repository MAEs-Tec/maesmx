# Solicitudes de asesoría

## Flujo

- Estudiantes publican para sí; coordinación (`coordi`, `admin`, `tec`) puede publicar por otro correo institucional, aunque todavía no tenga cuenta. El campus usa el identificador del catálogo existente.
- Una cuenta con ese correo verificado obtiene acceso a su solicitud. No se crean perfiles ficticios ni se usa el UID de Auth como matrícula.
- Primero se avisa a MAEs del campus con turno vigente (menos de cinco horas) y la materia registrada. Sin coincidencias se avisa a todos los MAEs en turno. Sin ofertas se amplía después de cinco minutos; el trabajo programado se ejecuta cada minuto, por lo que puede tardar hasta aproximadamente seis minutos.
- Los MAEs se ofrecen con mesa/ubicación. El estudiante o coordinación selecciona una sola oferta. La ubicación es texto, no un catálogo de mesas.
- Un estudiante tiene como máximo una solicitud abierta o asignada por materia (candado en `advisoryRequestLocks/{matricula}_{materia}`).
- Una oferta deja de contar cuando su MAE cierra turno o cambia de campus: el trabajo programado la marca `expired` y la solicitud puede ampliarse.
- El cierre manual es `not_held` o `missing_registration`. Este último conserva la asignación para permitir el registro posterior.
- A las 3 h de publicada, una solicitud abierta se cierra como `expired`; una asignada pasa a `missing_registration` y todavía se puede registrar.
- Solamente `registerRequestedAdvisory` crea la asesoría vinculada, actualiza puntos y confirma la solicitud en una transacción. `advisoryHistoryVersion` en el perfil del MAE detecta registros simultáneos y repite el cálculo. Sin calificación no se toca el bono. «Registrada» significa que existe el registro del estudiante; no es prueba independiente de asistencia física.

## Componentes y datos

- `advisoryRequests`: solicitud, identidad del beneficiario, materia, campus, estado y versión de asignación. Subcolecciones `offers`, `events` y `recipients`.
- `advisoryNotifications/{matricula}/items`: notificaciones privadas. La distribución desde eventos se puede reintentar sin duplicar avisos ni borrar su lectura.
- Nueva vista `/solicitudes` y detalle `/solicitudes/:id`; campana en el layout autenticado. El perfil admite `?requestId=...` y el flujo de autenticación conserva ese enlace.
- Los listeners tienen límites y se liberan al salir. El historial del estudiante y campus se pagina bajo demanda. No se envían push con la web cerrada.
- Las funciones nuevas están en `functions/advisory-requests.js`; los clientes no escriben estados, ofertas ni enlaces directamente.

## Verificación local

Pruebas sin emuladores:

```powershell
node --test functions/tests/*.test.cjs tests/advisory-requests-ui.test.mjs tests/advisory-profile.test.mjs tests/perfil-mae.test.mjs tests/roles.test.mjs
```

La integración requiere Firestore Emulator con las reglas actuales y un proyecto cuyo ID empiece con `demo-`. Se niega a ejecutarse contra un host remoto. Con el emulador ya iniciado:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:GCLOUD_PROJECT = 'demo-maes-requests'
node --test tests/advisory-requests.integration.test.mjs
```

Para la web, usar Auth, Firestore, Functions y Storage locales, `VITE_USE_EMULATOR=true` y configuración Firebase de proyecto demo. La conexión ocurre antes del montaje de Vue. `VITE_STORAGE_EMULATOR_PORT` permite cambiar el puerto de Storage si 9199 está ocupado. No usar cuentas reales en el entorno demo.

La revisión manual debe cubrir tres sesiones separadas (estudiante, MAE y coordinación), publicación, popup, respuesta, elección, ubicación, cierre y registro; comprobar también móvil y cuenta creada después del aviso. La ampliación automática se prueba con reloj inyectado; iniciar Firestore/Functions no ejecuta por sí solo Cloud Scheduler.

## Publicación

Incluye la función nueva `syncOwnRoleClaim` y el índice `advisoryRequests (status, createdAt)` que usa la caducidad. Desplegar primero funciones, reglas e índices; esperar a que los índices estén disponibles y después publicar Hosting. Validar en un entorno de prueba antes de producción. No es necesaria una migración de asesorías históricas. No borrar funciones de solicitudes mientras existan clientes que las usen.

El flujo vinculado protege su identidad y su adjudicación de puntos frente a reintentos. Persisten permisos heredados para editar puntos desde el navegador en otros flujos; este cambio no migra toda la gamificación al servidor.
