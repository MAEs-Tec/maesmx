// Arma la plantilla de carga en masa de la Maeteca con ExcelJS.
// ExcelJS se recibe como parámetro para cargarlo solo cuando se descarga la plantilla.
// Con `videos`, la hoja "Videos" sale llena con los videos actuales (exportación).
import { buildTemplateSheets, MAX_IMPORT_ROWS } from './maetecaImport.js';

const WIDTHS = {
    Videos: [45, 40, 38, 12, 40],
    Instrucciones: [20, 12, 95, 32],
    Materias: [14, 60],
    Carreras: [12, 60]
};

export function buildTemplateWorkbook(ExcelJS, { subjects, careers, tagOptions, videos } = {}) {
    const sheets = buildTemplateSheets({ subjects, careers, tagOptions, videos });
    const workbook = new ExcelJS.Workbook();

    for (const [name, rows] of Object.entries(sheets)) {
        const sheet = workbook.addWorksheet(name);
        sheet.addRows(rows);
        sheet.columns.forEach((column, i) => {
            column.width = WIDTHS[name]?.[i] ?? 20;
        });
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    const videosSheet = workbook.getWorksheet('Videos');
    const lastRow = Math.max(MAX_IMPORT_ROWS, sheets.Videos.length - 1) + 1;
    const subjectCount = sheets.Materias.length - 1;
    const careerCount = sheets.Carreras.length - 1;

    // Materia y Carrera: listas con los nombres de sus hojas. No bloquean texto libre
    // para que también se pueda escribir la clave o el nombre completo.
    const subjectRule = {
        type: 'list',
        allowBlank: true,
        formulae: [`Materias!$B$2:$B$${subjectCount + 1}`],
        showErrorMessage: false,
        showInputMessage: true,
        promptTitle: 'Materia',
        prompt: 'Elige de la lista o escribe el nombre o la clave. Vacío = General.'
    };

    const careerRule = careerCount
        ? {
            type: 'list',
            allowBlank: true,
            formulae: [`Carreras!$A$2:$A$${careerCount + 1}`],
            showErrorMessage: false,
            showInputMessage: true,
            promptTitle: 'Carrera',
            prompt: 'Elige las siglas de la lista o escribe el nombre. Vacío = Todas.'
        }
        : null;

    // Se asigna celda por celda; ExcelJS las agrupa en un solo rango al escribir.
    for (let row = 2; row <= lastRow; row++) {
        videosSheet.getCell(`C${row}`).dataValidation = subjectRule;
        if (careerRule) videosSheet.getCell(`D${row}`).dataValidation = careerRule;
    }

    return workbook;
}
