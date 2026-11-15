# Abre una sesion de Claude Code con Opus y le pide el video de lo nuevo de la Maeteca
# usando la skill /brag completa (no brag-slim).
#
# Uso (desde cualquier carpeta):
#   pwsh -File scripts\video-maeteca.ps1
#   pwsh -File scripts\video-maeteca.ps1 -SoloPrompt   # solo imprime el encargo, no abre nada

param(
    [switch]$SoloPrompt
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

$prompt = @'
/brag

Haz un video corto de lanzamiento de lo nuevo de la Maeteca en MAEs MX. Usa la skill /brag completa (la de HyperFrames), no brag-slim.

## Que es
MAEs MX es la app de asesorias entre pares del Tec de Monterrey (Vue 3 + PrimeVue + Firebase). La Maeteca es su biblioteca de recursos de estudio. El video es para los coordinadores y MAEs que suben contenido: debe ensenar como se usa lo nuevo, paso a paso, no solo presumirlo.

## Que hay de nuevo (commit a4948b0 en dev)
1. Carga en masa de videos desde Excel.
2. Recursos PDF que se ven dentro de la app.
3. Editar y eliminar recursos desde el menu de tres puntos.
4. Filtro por tipo: Todos / Video / PDF.

Solo los roles admin, tec y coordi ven los controles para administrar. Los estudiantes solo ven y abren los recursos.

## Como se usa (este es el recorrido que debe mostrar el video)
Carga en masa:
1. En la Maeteca, boton de subir junto al "+" (tooltip "Carga en masa de videos").
2. "Descargar plantilla": baja un Excel con tres hojas (Videos, Instrucciones, Materias).
3. En la hoja Videos se llena un video por fila: Link (YouTube), Nombre del video, Materia, Carrera, Etiquetas. Materia y Carrera traen lista desplegable; Materia tambien acepta la clave (ej. TC1028). Etiquetas van separadas por coma.
4. "Elegir archivo Excel": aparece la vista previa fila por fila, con "Listo" o el motivo del error (link que no es de YouTube, materia que no existe, video duplicado) y el resumen "N listos, M con errores".
5. "Subir N videos": se suben las filas validas; las que tienen error se omiten. Maximo 500 por archivo.

PDF:
1. Boton "+" -> "Agregar recurso" -> Tipo de recurso: PDF.
2. "Elegir PDF" (maximo 10 MB), nombre, materia, carrera y etiquetas -> "Agregar".
3. La tarjeta del PDF aparece junto a los videos con un icono de PDF. Al abrirla, el PDF se ve en el visor donde va el reproductor, con boton "Abrir en otra pestana".

Editar y eliminar:
- Tres puntos de la tarjeta -> "Editar" o "Eliminar". Eliminar pide confirmacion. El video de introduccion no se puede eliminar.

## De donde sacar la interfaz real
Lee el codigo; no inventes pantallas ni textos:
- src/views/Maeteca.vue
- src/components/maeteca/MaetecaBulkUpload.vue
- src/components/maeteca/MaetecaResourceDialog.vue
- src/components/maeteca/MaetecaPdfViewer.vue
- src/utils/maetecaImport.js y src/utils/maetecaTemplate.js (columnas de la plantilla y mensajes de error)
- docs/maeteca-recursos-plan.md (alcance y decisiones)
Usa los textos de la interfaz tal como estan en el codigo (en espanol) y los colores que ya usa la vista.

## Reglas
- Idioma: espanol. Antes de renderizar, confirmame si lleva narracion o solo texto en pantalla y musica.
- Estilo sobrio y limpio, coherente con la app: sin degradados ni colores nuevos, sin efectos exagerados.
- No uses datos reales de alumnos; usa nombres y materias de ejemplo.
- No digas que esto ya esta en produccion: esta en la rama dev y falta desplegar (incluida la regla nueva de storage.rules).
- Deja el resultado en una carpeta nueva brag-output-<fecha>-<hora> en la raiz del repo, como las anteriores.
- No hagas commit, push ni deploy. No subas ni publiques el video en ningun lado. No corras "npm run lint".
- Al terminar dime la ruta del video, la duracion, y que revisaste tu mismo (render completo, frames, audio) y que no.
'@

if ($SoloPrompt) {
    $prompt
    return
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    throw 'No encuentro el comando "claude" en el PATH. Corre con -SoloPrompt y pega el encargo en una sesion con Opus.'
}

Set-Location $repo
claude --model opus $prompt
