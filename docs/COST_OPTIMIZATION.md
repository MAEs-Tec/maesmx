# Costos y optimización — dev 5decf8a

Septiembre 2026, USD: Firestore 40.56, Hosting 9.12, Functions 2.40, Storage 0.36, Non-Firebase Services 123.02. Suma 175.86 frente al total reportado 175.46: diferencia 0.40 pendiente de conciliación. No atribuir costos a recursos sin desglose por servicio/SKU, región, unidades y créditos.

Base reproducible: entrada JS 2,170,020 bytes (gzip 503,980), CSS 387,160 bytes (gzip 42,240), portada 3,474,840 bytes. Son tamaños del build previo, no tráfico facturado. Ejecutar build y measure:bundle por fase. Objetivos: entrada gzip -40 %, portada -70 %, sin pérdida visual.

Activar VITE_COST_DIAGNOSTICS=true solo en medición. window.maesCostDiagnostics.snapshot()/reset() proporciona contadores locales de caché, consultas, documentos y JSON estimado. No equivalen a lecturas facturadas ni bytes de red. Medir rutas con caché fría/caliente y contrastar con Cloud Billing. No exportar perfiles ni comentarios a telemetría externa.

Comparar USD por 1,000 sesiones y 1,000 asesorías. Ahorro neto = gasto evitado menos nuevas escrituras/invocaciones/almacenamiento. Retorno = costo implementación / ahorro mensual neto.

## Inventario comprobado, 5 octubre 2026

Proyecto peer-teaching, funciones gen1 en us-central1. Además de las funciones del repositorio hay dos extensiones firestore-bigquery-export (Node 14): exportación de requests a maesmx_requests y de users. Son candidatos para investigar los servicios externos, no una atribución probada de los USD 123.02. No retirarlas sin revisar dashboards y consumidores BigQuery. La función syncUserRoleClaimOnWrite tiene reintentos y máximo de 3000 instancias desplegadas; cambiarlo requiere medir volumen, latencia y concurrencia.

## Producción

Cada fase se revisa por separado contra dev. No ejecutar deploy global: hay extensiones fuera del repositorio. Respaldo, dry-run y checkpoints antes de migraciones. Desplegar índices/backend/reglas compatibles antes del cliente. Mantener datos antiguos para reversión durante un ciclo de medición. No borrar historiales.

Pendientes externos: septiembre por SKU/créditos, región exacta de Firestore, métricas y alertas de presupuesto (50/80/100 % del total conciliado, sin pausar servicios).
