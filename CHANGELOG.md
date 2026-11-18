# Changelog

## 2026-09-18

**Correcciones e integración de ramas**

- Se unificaron `Gaelfixes` y `dev`, conservando la carga masiva de materias,
  las horas de Salud y las reglas activas de Firestore.
- Los perfiles de MAE ahora toleran cuentas antiguas sin horario, materias,
  logros u otros campos opcionales y muestran estados de carga y error.
- La edición administrativa de roles conserva horas, puntos y logros; además,
  el menú y las rutas reaccionan a cambios de permisos sin cerrar sesión.
- Una función de Firebase sincroniza los roles de Firestore con los custom
  claims de Firebase Auth.
- Las reglas de Firestore bloquean cambios de rol o estatus hechos por usuarios
  sin permisos, evitando escalación de privilegios.
- Se eliminó el archivo histórico `.firestore.rules`; Firebase despliega la
  única fuente vigente, `firestore.rules`.

## 3.8.0 (2023-07-24)

**Migration Guide**

-   Update theme files.
-   Update assets style files
-   Remove code highlight

**Implemented New Features and Enhancements**

-   Upgrade to PrimeVue 3.30.2

## 3.7.0 (2023-05-06)

-   Upgrade to PrimeVue 3.28.0

**Implemented New Features and Enhancements**

## 3.6.0 (2023-04-12)

**Implemented New Features and Enhancements**

-   Upgrade to PrimeVue 3.26.1
-   Upgrade to vite 4.2.1
