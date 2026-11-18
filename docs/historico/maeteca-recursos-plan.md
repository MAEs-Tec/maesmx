# Plan: carga en masa de videos y PDFs en la Maeteca

Rama: `feature/maeteca-recursos` (sale de `dev`). Sin commit ni deploy hasta que Adolfo lo pida.

## Alcance

Entra:
1. Carga en masa de links de video desde un Excel (la plantilla se genera al descargarla, con una hoja "Materias" sacada del catálogo actual).
2. Recursos PDF: subirlos, listarlos junto a los videos y verlos dentro de la app.
3. Menú de tres puntos con Editar y Eliminar (hoy los botones existen y no hacen nada; sin borrar no se puede corregir una carga en masa).
4. Filtro por tipo (Todos / Video / PDF).

No entra (está en el Figma pero no se pidió): página "Maeteca • Búsqueda", páginas de detalle con "Relacionado al video", filtros de Etiqueta/Carrera/Semestre, paleta de etiquetas por carrera, chip de duración, zoom propio del visor.

## Decisiones

- Los PDFs se suben a Firebase Storage (el Figma muestra un campo "Archivo pdf"). Límite 10 MB, solo `application/pdf`.
- Todo sigue en la colección `videos` de Firestore; se agrega el campo `Tipo`. Las reglas de Firestore no cambian (`isContentManager` ya cubre create/update/delete).
- Roles que administran: `admin`, `tec`, `coordi` (igual que hoy). El resto solo ve.
- El Excel se lee en el navegador con `xlsx` (ya es dependencia). No se agregan dependencias nuevas.
- Visor de PDF: `<iframe>` con el visor nativo del navegador más un botón "Abrir en otra pestaña". Sin pdf.js.
- La carga en masa no está diseñada en el Figma: se sigue el estilo de los diálogos existentes.
- Estilo: reutilizar las clases y colores que ya tiene `Maeteca.vue`; no agregar degradados ni colores nuevos.

## Modelo de datos (`videos/{id}`)

| Campo | Video | PDF |
|---|---|---|
| `Tipo` | `'video'` (ausente = video) | `'pdf'` |
| `Video` | URL de YouTube | — |
| `Archivo` | — | URL de descarga |
| `ArchivoPath` | — | `maeteca/{id}/{nombre}.pdf` |
| `ArchivoNombre` | — | nombre original |
| `Titulo`, `Informacion`, `Materia`, `Carrera`, `Relacionado[]`, `createdBy`, `createdAt` | igual que hoy | igual |

## Contratos

### `src/utils/maetecaImport.js` (puro: sin imports de Firebase ni alias `@/`)

- `TEMPLATE_HEADERS = ['Link','Nombre del video','Materia','Carrera','Etiquetas']`
- `MAX_IMPORT_ROWS = 500`, `MAX_PDF_BYTES = 10 * 1024 * 1024`
- `extractYoutubeId(url)` → id de 11 caracteres o `null`. Acepta `watch?v=`, `youtu.be/`, `embed/`, `shorts/`, con parámetros extra. Solo hosts de YouTube.
- `parseVideoRows(rows, { subjects, careers, tagOptions, existingVideos })` → `{ valid, invalid }`
  - `rows`: objetos de `XLSX.utils.sheet_to_json(sheet, { defval: '' })`.
  - `valid`: `[{ rowNumber, data: { Tipo:'video', Video, Titulo, Materia, Carrera, Relacionado, Informacion:'' } }]`
  - `invalid`: `[{ rowNumber, raw, errors: [string] }]` con mensajes en español.
  - `rowNumber` es la fila real del Excel (la primera de datos es 2).
  - Encabezados: comparación sin mayúsculas, acentos ni espacios sobrantes. Si falta `Link` o `Nombre del video`, lanza `Error` con mensaje claro.
  - Filas totalmente vacías: se ignoran.
  - `Link`: obligatorio, debe dar un id de YouTube.
  - `Nombre del video`: obligatorio, máximo 120 caracteres.
  - `Materia`: vacío → `'general'`; si no, debe coincidir (normalizado) con `name` o `id` de `subjects`; se guarda el mismo valor que guarda el popup actual.
  - `Carrera`: vacío → `'all'`; si no, coincide con `name` o `code` de `careers`.
  - `Etiquetas`: separadas por coma, sin `#`, sin repetidos; cada una debe coincidir con `tagOptions[].value` y se guarda con la forma canónica.
  - Duplicados: mismo id de YouTube que un video existente o que una fila anterior → inválida.
  - Más de `MAX_IMPORT_ROWS` filas con datos → lanza `Error`.
- `validatePdfFile(file)` → `null` o mensaje de error (tipo y tamaño).

### `src/firebase/db/maeteca.js`

- `RESOURCE_TYPES = [{ name:'Video', code:'video' }, { name:'PDF', code:'pdf' }]`
- `getResourceType(resource)` → `'video' | 'pdf'`
- `addVideosBulk(items)` → `{ created }`. Verifica rol, `writeBatch` en bloques de 400, agrega `createdBy`/`createdAt`, invalida la caché una sola vez.
- `addPdfToMaeteca({ file, Titulo, Materia, Carrera, Relacionado, Informacion })` → `{ id }`. Reserva el id, sube a `maeteca/{id}/{nombreSeguro}` con `contentType: 'application/pdf'`, guarda el documento; si el documento falla, borra el archivo subido.
- `updateMaetecaResource(id, fields)`: solo `Titulo`, `Informacion`, `Materia`, `Carrera`, `Relacionado` y `Video` (este último solo en videos).
- `deleteMaetecaResource(resource)`: borra el documento y, si hay `ArchivoPath`, el archivo (ignora "no encontrado"). Rechaza borrar `intro-maeteca`.
- `extractYoutubeId` se re-exporta desde `maetecaImport.js`. `addVideoToMaeteca` agrega `Tipo:'video'`.
- Usa `firebaseStorage` de `src/main.js` (el que conecta al emulador).

### `storage.rules`

```
match /maeteca/{resourceId}/{fileName} {
  allow read: if signedIn();
  allow create: if hasAnyRole(['admin','tec','coordi'])
    && request.resource.contentType == 'application/pdf'
    && request.resource.size < 10 * 1024 * 1024;
  allow delete: if hasAnyRole(['admin','tec','coordi']);
}
```
Va antes del `match /{allPaths=**}` final. Sin `update`.

### Componentes (`src/components/maeteca/`)

- `MaetecaBulkUpload.vue` — props `visible` (v-model), `subjects`, `existingVideos`; emite `uploaded(count)`.
  Link para descargar la plantilla, selector de `.xlsx`, tabla de vista previa (fila, nombre, link, estado o errores), resumen "N listos, M con errores", botón "Subir N videos" deshabilitado con 0 válidos. Las filas con error se omiten y se dice cuántas.
- `MaetecaResourceDialog.vue` — props `visible` (v-model), `resource` (`null` = crear), `subjects`; emite `saved`.
  Crear: selector "Tipo de recurso" (Video / PDF); Video pide Link con vista previa reactiva (sin `innerHTML`); PDF pide archivo. Editar: mismo formulario sin cambiar tipo ni archivo. Título "Agregar recurso" / "Editar recurso", botón "Agregar" / "Guardar".
- `MaetecaPdfViewer.vue` — props `url`, `title`. Encabezado con el título y botón "Abrir en otra pestaña"; `<iframe>`; texto de respaldo con link si no se puede mostrar.

### `src/views/Maeteca.vue` (integración)

- Sustituye el diálogo inline por `MaetecaResourceDialog`.
- Junto al "+": botón para carga en masa (solo quienes administran).
- Tres puntos: `Menu` con Editar y Eliminar, visible solo para quienes administran.
- Confirmación de borrado: "¿Estás seguro que deseas eliminar este video?" / "…este recurso?", con el nombre del recurso.
- Filtro por tipo junto al buscador.
- Tarjeta de PDF: ícono `pi pi-file-pdf` en lugar de miniatura. Al elegir un PDF, el área principal muestra `MaetecaPdfViewer`.
- Limpieza: quitar `lookPreview` (usa `innerHTML`), los botones de prueba comentados y el `console.log` de videos.

## Verificación

- `node --test tests/maeteca-import.test.mjs` (pruebas nuevas del parser y del validador).
- `node --test tests/` para confirmar que no se rompió lo existente.
- `npm run build`.
- No correr `npm run lint` (lleva `--fix`).
- Revisión visual en el navegador con datos reales: al final, fuera del workflow.

## Reparto

| Paso | Quién | Archivos |
|---|---|---|
| Briefs | Opus | — |
| Datos | Sonnet | `maetecaImport.js`, `maeteca.js`, `storage.rules`, `tests/maeteca-import.test.mjs` |
| Carga en masa | Sonnet | `MaetecaBulkUpload.vue` |
| Diálogo y visor | Sonnet | `MaetecaResourceDialog.vue`, `MaetecaPdfViewer.vue` |
| Integración | Sonnet | `Maeteca.vue` |
| Revisión | Opus | diff, pruebas, build |
| Correcciones | Sonnet | lo que marque la revisión |
