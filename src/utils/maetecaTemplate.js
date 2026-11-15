// Arma la plantilla de carga en masa de la Maeteca con ExcelJS.
// ExcelJS se recibe como parámetro para cargarlo solo cuando se descarga la plantilla.
import { buildTemplateSheets, MAX_IMPORT_ROWS } from './maetecaImport.js';

const WIDTHS = {
    Videos: [45, 40, 38, 12, 40],
    Instrucciones: [20, 12, 95, 32],
    Materias: [14, 60]
};

export function buildTemplateWorkbook(ExcelJS, { subjects, careers, tagOptions } = {}) {
    const sheets = buildTemplateSheets({ subjects, careers, tagOptions });
    const workbook = new ExcelJS.Workbook();

    for (const [name, rows] of Object.entries(sheets)) {
        const sheet = workbook.addWorksheet(name);
        sheet.addRows(rows);
        sheet.columns.forEach((column, i) => {
            column.width = WIDTHS[name][i] ?? 20;
        });
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    const videos = workbook.getWorksheet('Videos');
    const lastRow = MAX_IMPORT_ROWS + 1;
    const subjectCount = sheets.Materias.length - 1;
    const careerNames = (Array.isArray(careers) ? careers : []).map((c) => c.name);

    // Materia: lista con los nombres de la hoja "Materias". No bloquea texto libre
    // para que también se pueda escribir la clave.
    const subjectRule = {
        type: 'list',
        allowBlank: true,
        formulae: [`Materias!$B$2:$B$${subjectCount + 1}`],
        showErrorMessage: false,
        showInputMessage: true,
        promptTitle: 'Materia',
        prompt: 'Elige de la lista o escribe el nombre o la clave. Vacío = General.'
    };

    const careerRule = careerNames.length
        ? {
            type: 'list',
            allowBlank: true,
            formulae: [`"${careerNames.join(',')}"`],
            showErrorMessage: true,
            errorStyle: 'error',
            errorTitle: 'Carrera no válida',
            error: `Elige una de: ${careerNames.join(', ')}.`
        }
        : null;

    // Se asigna celda por celda; ExcelJS las agrupa en un solo rango al escribir.
    for (let row = 2; row <= lastRow; row++) {
        videos.getCell(`C${row}`).dataValidation = subjectRule;
        if (careerRule) videos.getCell(`D${row}`).dataValidation = careerRule;
    }

    return workbook;
}
