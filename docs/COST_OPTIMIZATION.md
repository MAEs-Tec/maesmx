# Costos y optimización — dev 5decf8a

Septiembre 2026, USD: Firestore 40.56, Hosting 9.12, Functions 2.40, Storage 0.36, Non-Firebase Services 123.02. Suma 175.86 frente al total reportado 175.46: diferencia 0.40 pendiente de conciliación. No atribuir costos a recursos sin desglose por servicio/SKU, región, unidades y créditos.

Base reproducible: entrada JS 2,170,020 bytes (gzip 503,980), CSS 387,160 bytes (gzip 42,240), portada 3,474,840 bytes. Son tamaños del build previo, no tráfico facturado. Ejecutar build y measure:bundle por fase. Objetivos: entrada gzip -40 %, portada -70 %, sin pérdida visual.

Activar VITE_COST_DIAGNOSTICS=true solo en medición. window.maesCostDiagnostics.snapshot()/reset() proporciona contadores locales de caché, consultas, documentos y JSON estimado. No equivalen a lecturas facturadas ni bytes de red. Medir rutas con caché fría/caliente y contrastar con Cloud Billing. No exportar perfiles ni comentarios a telemetría externa.

Comparar USD por 1,000 sesiones y 1,000 asesorías. Ahorro neto = gasto evitado menos nuevas escrituras/invocaciones/almacenamiento. Retorno = costo implementación / ahorro mensual neto.

## Inventario comprobado, 5 octubre 2026

Proyecto peer-teaching, funciones gen1 en us-central1. Además de las funciones del repositorio hay dos extensiones firestore-bigquery-export (Node 14): exportación de requests a maesmx_requests y de users. Son candidatos para investigar los servicios externos, no una atribución probada de los USD 123.02. No retirarlas sin revisar dashboards y consumidores BigQuery. La función syncUserRoleClaimOnWrite tiene reintentos y máximo de 3000 instancias desplegadas; cambiarlo requiere medir volumen, latencia y concurrencia.

## Producción

Cada fase se revisa por separado contra dev. No ejecutar deploy global: hay extensiones fuera del repositorio. Respaldo, dry-run y checkpoints antes de migraciones. Desplegar índices/backend/reglas compatibles antes del cliente. Mantener datos antiguos para reversión durante un ciclo de medición. No borrar historiales.

Firestore comprobado: edición Standard, multirregión nam5. Pendientes externos: septiembre por SKU/créditos, métricas facturadas y alertas de presupuesto (50/80/100 % del total conciliado, sin pausar servicios).

## Implementación y comprobaciones

- Consultas de asesorías filtradas por MAE/estudiante, período, materia y evaluación en servidor, con cursor fecha + ID y hasta 50 documentos. Exportaciones explícitas recorren todas las páginas. Los documentos antiguos se completan antes de habilitar los nuevos filtros.
- Directorio básico separado de fotografías. TTL de directorio, leaderboard y estadísticas: 15 minutos; asistencia actual y sesiones: 30 segundos. Caché aislada por proyecto y cuenta, invalidaciones entre pestañas, eliminación de caché v1 y protección contra respuestas anteriores a una invalidación.
- Registro/evaluación/corrección/eliminación de asesorías en transacciones del backend. IDs de operación impiden duplicar registros y premios. Parejas conservan primera/última fecha y se corrigen tras eliminar o cambiar historial. Bonus, usuarios únicos y distribuciones se mantienen por deltas. Perfil y leaderboard no conceden puntos ni insignias al abrirse.
- Resúmenes privados de dashboard y bonus; conteos públicos para usuarios autenticados. Custom claims y sincronización existentes conservados. Asistencia y compras de fondos también actualizan sus puntos/monedas desde el servidor.
- Asistencia histórica mediante collectionGroup y páginas; período inicial: mes actual. Configuración de evaluaciones en settings/evaluations. Limpieza de anuncios en lotes de 450, conservando el registro para no perder asistencia grupal.
- Imágenes comprimidas antes de subirlas, con límites de 5/10 MiB y tipos JPEG/PNG/WebP en Storage. Imágenes sustituidas se limpian solo sin referencias y después del backfill de rutas. App Check queda configurable en observación; no se ha habilitado enforcement en producción.
- PrimeVue importado por consumidor, Excel diferido, portada responsiva WebP, fondos SVG comprimidos sin cambiar rutas y caché de Hosting para archivos versionados.
- CI incluye lint sin --fix, pruebas, build, medición de bundle y emuladores.

Resultado local final: entrada JS gzip cercana a 196 kB frente a 504 kB (-61 %); portada 1280px de 47,810 bytes frente a 3,474,840 (-98.6 %). Son tamaños de artefactos, no porcentajes de ahorro económico. Hay 37 pruebas unitarias y una prueba de integración que comprueba migración repetible, doble envío simultáneo, correcciones, eliminaciones, 73 registros con la misma fecha sin pérdidas al paginar, roles y límites de Storage. Revisión en navegador de portada móvil/escritorio, perfil en ambos temas, leaderboard, dashboard y tablas con datos demo. No equivale a una revisión visual completa de todas las pantallas.

Los resúmenes agregan escrituras y lecturas por operación. Una asesoría con área/campus puede actualizar aproximadamente 15 documentos; la sincronización de insignias añade invocaciones/lecturas. Medir este costo antes de afirmar ahorro neto. Los contadores locales son estimaciones; no reemplazan Cloud Billing. Las colecciones pequeñas de configuración/directorio/anuncios aún tienen consultas completas; la paginación aplicada cubre asesorías y asistencia histórica.

## Migración y despliegue revisable

1. Revisar la integración contra dev actualizado y respaldar Firestore. No desplegar todavía el frontend nuevo sobre datos sin migrar.
2. Desplegar únicamente los índices, las funciones de este repositorio y reglas compatibles revisadas. El CLI debe mostrar los nombres explícitos; evitar `firebase deploy` global porque hay extensiones ajenas al repositorio.
3. Ejecutar `node scripts/migrate-cost-data.cjs --project=peer-teaching` para dry-run. Comparar totales y usuarios únicos. El dry-run no escribe datos.
4. Con una ventana de mantenimiento y respaldo revisado, ejecutar `node scripts/migrate-cost-data.cjs --project=peer-teaching --apply --resume=cost_FECHA`. Conserva JSON originales y settings en `backups.local/cost_FECHA`, checkpoints, recibos por documento y una conciliación antes de activar la versión. No subir esos respaldos al repositorio. Al reanudar una versión ya activada se retorna sin modificarla.
5. Publicar el cliente con la configuración real de Firebase; la configuración demo local no se versiona. Comprobar registro, evaluación y roles. Conservar el modelo antiguo durante un ciclo de medición.
6. Para revertir el puntero antes de operaciones posteriores: `node scripts/migrate-cost-data.cjs --project=peer-teaching --apply --rollback=cost_FECHA`. El script rechaza versiones con operaciones nuevas posteriores a la activación. Si ya hay actividad, reconstruir una versión nueva; no restaurar un resumen viejo sobre datos nuevos. No restaurar ni borrar asesorías como mecanismo de ahorro.

App Check requiere la clave de sitio real mediante VITE_APP_CHECK_SITE_KEY, observación en consola y verificación de usuarios públicos antes de enforcement. El presupuesto mensual requiere la factura conciliada y permisos de Billing; estos datos no están disponibles en el repositorio. No se borraron recursos externos ni se migró/desplegó producción.

Para preparar las alertas de presupuesto sin modificar Billing: `node scripts/budget-alerts.cjs --project=peer-teaching --amount=IMPORTE_CONCILIADO`. Tras revisar la salida, `--apply` crea o actualiza únicamente ese presupuesto y conserva destinatarios existentes. No incluye apagado automático. No se ejecutó porque el importe/ajuste de USD 0.40 sigue sin conciliación.
