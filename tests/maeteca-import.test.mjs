import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TEMPLATE_HEADERS,
    MAX_IMPORT_ROWS,
    MAX_PDF_BYTES,
    extractYoutubeId,
    parseVideoRows,
    validatePdfFile,
    toSafePdfFileName
} from '../src/utils/maetecaImport.js';

const subjects = [
    { id: 'TC1028', name: 'Pensamiento computacional' },
    { id: 'MA1001', name: 'Matemáticas I' }
];
const careers = [
    { name: 'Todas', code: 'all' },
    { name: 'ITC', code: 'itc' },
    { name: 'IMT', code: 'imt' },
    { name: 'IDS', code: 'ids' }
];
const tagOptions = [
    { label: '#maeteca', value: 'maeteca' },
    { label: '#general', value: 'general' },
    { label: '#tutorial', value: 'tutorial' },
    { label: '#matematicas', value: 'matematicas' },
    { label: '#Quimica', value: 'Quimica' },
    { label: '#Ciencias sociales', value: 'Ciencias sociales' },
    { label: '#Creatividad', value: 'Creatividad' },
    { label: '#Fisica', value: 'Fisica' }
];
const ctx = { subjects, careers, tagOptions, existingVideos: [] };

const ID = 'B9YR-GXGncw';
const ID2 = '2ntPaw4vkc8';
const ytLink = (id) => `https://youtu.be/${id}`;

function row(over = {}, rowNum) {
    const r = { Link: ytLink(ID), 'Nombre del video': 'Euler', Materia: '', Carrera: '', Etiquetas: '', ...over };
    if (rowNum !== undefined) Object.defineProperty(r, '__rowNum__', { value: rowNum, enumerable: false });
    return r;
}

test('extractYoutubeId acepta las formas habituales', () => {
    assert.equal(extractYoutubeId(`https://www.youtube.com/watch?v=${ID}&t=10s`), ID);
    assert.equal(extractYoutubeId(`https://youtu.be/${ID}?si=x`), ID);
    assert.equal(extractYoutubeId(`https://www.youtube.com/embed/${ID}`), ID);
    assert.equal(extractYoutubeId(`https://www.youtube.com/shorts/${ID}`), ID);
    assert.equal(extractYoutubeId(`https://m.youtube.com/watch?v=${ID}`), ID);
    assert.equal(extractYoutubeId(`youtube.com/watch?v=${ID}`), ID);
});

test('extractYoutubeId rechaza hosts ajenos e ids inválidos', () => {
    assert.equal(extractYoutubeId(`https://evil.com/watch?v=${ID}`), null);
    assert.equal(extractYoutubeId(`https://youtube.com.evil.com/watch?v=${ID}`), null);
    assert.equal(extractYoutubeId('https://youtu.be/abc123def4'), null);
    assert.equal(extractYoutubeId(null), null);
    assert.equal(extractYoutubeId(12345), null);
    assert.equal(extractYoutubeId('   '), null);
});

test('parseVideoRows: fila válida completa', () => {
    const { valid, invalid } = parseVideoRows([
        row({ Materia: 'Pensamiento computacional', Carrera: 'ITC', Etiquetas: 'tutorial' })
    ], ctx);
    assert.equal(invalid.length, 0);
    assert.equal(valid.length, 1);
    assert.deepEqual(valid[0].data, {
        Tipo: 'video',
        Video: ytLink(ID),
        Titulo: 'Euler',
        Materia: 'TC1028',
        Carrera: 'itc',
        Relacionado: ['tutorial'],
        Informacion: ''
    });
    assert.deepEqual(Object.keys(valid[0].data).sort(),
        ['Carrera', 'Informacion', 'Materia', 'Relacionado', 'Tipo', 'Titulo', 'Video']);
});

test('parseVideoRows: rowNumber desde __rowNum__ y respaldo índice + 2', () => {
    const a = row({}, 4);
    const b = row({ Link: ytLink(ID2) });
    const { valid } = parseVideoRows([a, b], ctx);
    assert.equal(valid[0].rowNumber, 5);
    assert.equal(valid[1].rowNumber, 3);
});

test('parseVideoRows: ignora filas vacías', () => {
    const empty = { Link: '', 'Nombre del video': '', Materia: '', Carrera: '', Etiquetas: '' };
    const { valid, invalid } = parseVideoRows([empty, row(), empty], ctx);
    assert.equal(valid.length, 1);
    assert.equal(invalid.length, 0);
    assert.equal(valid[0].rowNumber, 3);
});

test('parseVideoRows: encabezados con mayúsculas, acentos y espacios', () => {
    const { valid } = parseVideoRows([
        { '  LINK ': ytLink(ID), 'Nombre del vídeo': 'Euler', Extra: 'x' }
    ], ctx);
    assert.equal(valid.length, 1);
    assert.equal(valid[0].data.Titulo, 'Euler');
});

test('parseVideoRows: errores de archivo', () => {
    assert.throws(() => parseVideoRows([{ Link: ytLink(ID) }], ctx), /Faltan las columnas: Nombre del video/);
    assert.throws(() => parseVideoRows([], ctx), /no tiene filas con videos/);
    assert.throws(() => parseVideoRows(undefined, ctx), /no tiene filas con videos/);
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => row({ Link: `https://youtu.be/${String(i).padStart(11, 'a')}` }));
    assert.throws(() => parseVideoRows(many, ctx), /máximo es 500/);
});

test('parseVideoRows: materia', () => {
    const r = parseVideoRows([
        row({ Link: ytLink(ID), Materia: '' }),
        row({ Link: ytLink(ID2), Materia: 'pensamiento computacional' }),
        row({ Link: 'https://youtu.be/aaaaaaaaaaa', Materia: 'ma1001' }),
        row({ Link: 'https://youtu.be/bbbbbbbbbbb', Materia: 'Alquimia' })
    ], ctx);
    assert.deepEqual(r.valid.map((v) => v.data.Materia), ['general', 'TC1028', 'MA1001']);
    assert.match(r.invalid[0].errors[0], /La materia "Alquimia" no existe\./);

    const sinSubjects = parseVideoRows([row()], { ...ctx, subjects: null });
    assert.equal(sinSubjects.valid[0].data.Materia, 'general');
});

test('parseVideoRows: carrera', () => {
    const r = parseVideoRows([
        row({ Link: ytLink(ID), Carrera: 'ITC' }),
        row({ Link: ytLink(ID2), Carrera: 'Todas' }),
        row({ Link: 'https://youtu.be/aaaaaaaaaaa', Carrera: '' }),
        row({ Link: 'https://youtu.be/bbbbbbbbbbb', Carrera: 'XYZ' })
    ], ctx);
    assert.deepEqual(r.valid.map((v) => v.data.Carrera), ['itc', 'all', 'all']);
    assert.match(r.invalid[0].errors[0], /La carrera "XYZ" no existe\. Usa Todas, ITC, IMT, IDS\./);
});

test('parseVideoRows: etiquetas', () => {
    const ok = parseVideoRows([row({ Etiquetas: '#matematicas, quimica, matematicas' })], ctx);
    assert.deepEqual(ok.valid[0].data.Relacionado, ['matematicas', 'Quimica']);
    const bad = parseVideoRows([row({ Etiquetas: 'tutorial, inventada' })], ctx);
    assert.equal(bad.valid.length, 0);
    assert.deepEqual(bad.invalid[0].errors, ['La etiqueta "inventada" no existe.']);
});

test('parseVideoRows: duplicados', () => {
    const existing = [
        { id: 'a', Tipo: 'pdf', Video: ytLink(ID) },
        { id: 'b', Video: `https://www.youtube.com/watch?v=${ID2}` }
    ];
    const r = parseVideoRows([row({ Link: ytLink(ID) }), row({ Link: ytLink(ID2) })], { ...ctx, existingVideos: existing });
    assert.equal(r.valid.length, 1);
    assert.equal(r.valid[0].rowNumber, 2);
    assert.deepEqual(r.invalid[0].errors, ['Este video ya está en la Maeteca.']);

    const dup = parseVideoRows([row(), row()], ctx);
    assert.equal(dup.valid.length, 1);
    assert.deepEqual(dup.invalid[0].errors, ['Este video ya aparece en la fila 2.']);
});

test('parseVideoRows: un duplicado de una fila inválida no invalida la siguiente', () => {
    const r = parseVideoRows([
        row({ 'Nombre del video': '' }),
        row({ Link: ytLink(ID) })
    ], ctx);
    assert.equal(r.invalid.length, 1);
    assert.equal(r.valid.length, 1);
    assert.equal(r.valid[0].rowNumber, 3);
});

test('parseVideoRows: nombre largo y errores acumulados', () => {
    const largo = parseVideoRows([row({ 'Nombre del video': 'x'.repeat(121) })], ctx);
    assert.deepEqual(largo.invalid[0].errors, ['El nombre pasa de 120 caracteres.']);

    const multi = parseVideoRows([row({ Link: 'nada', 'Nombre del video': '', Materia: 'zzz', Carrera: 'qqq', Etiquetas: 'nope' })], ctx);
    assert.equal(multi.invalid[0].errors.length, 5);
    assert.deepEqual(multi.invalid[0].raw, { link: 'nada', titulo: '', materia: 'zzz', carrera: 'qqq', etiquetas: 'nope' });
});

test('parseVideoRows: celdas numéricas no truenan', () => {
    const r = parseVideoRows([row({ 'Nombre del video': 12345 })], ctx);
    assert.equal(r.valid[0].data.Titulo, '12345');
});

test('TEMPLATE_HEADERS coincide con el contrato', () => {
    assert.deepEqual(TEMPLATE_HEADERS, ['Link', 'Nombre del video', 'Materia', 'Carrera', 'Etiquetas']);
});

test('validatePdfFile', () => {
    assert.equal(validatePdfFile({ name: 'a.pdf', type: 'application/pdf', size: 1000 }), null);
    assert.equal(validatePdfFile({ name: 'a.png', type: 'image/png', size: 1000 }), 'Solo se permiten archivos PDF.');
    assert.equal(validatePdfFile({ name: 'a.pdf', type: 'application/pdf', size: 0 }), 'El archivo está vacío.');
    assert.equal(validatePdfFile({ name: 'a.pdf', type: 'application/pdf', size: MAX_PDF_BYTES }), 'El PDF debe pesar menos de 10 MB.');
    assert.equal(validatePdfFile({ name: 'x.PDF', type: '', size: 10 }), null);
    assert.equal(validatePdfFile(null), 'Elige un archivo PDF.');
});

test('toSafePdfFileName', () => {
    assert.equal(toSafePdfFileName('Guía de Cálculo (v2).pdf'), 'Guia-de-Calculo-v2.pdf');
    assert.equal(toSafePdfFileName('***.pdf'), 'documento.pdf');
    const largo = toSafePdfFileName(`${'a'.repeat(200)}.pdf`);
    assert.ok(largo.length <= 84);
    assert.ok(largo.endsWith('.pdf'));
});

test('buildTemplateSheets lists the subject catalog and round-trips through the parser', async () => {
    const { buildTemplateSheets, parseVideoRows: parse } = await import('../src/utils/maetecaImport.js');
    const XLSX = await import('xlsx');
    const subjects = [{ id: 'TC1028', name: 'Pensamiento computacional' }, { id: 'MA1028', name: 'Modelación matemática' }, { name: 'sin clave' }];
    const careers = [{ name: 'Todas', code: 'all' }, { name: 'ITC', code: 'itc' }];
    const tagOptions = [{ label: '#matematicas', value: 'matematicas' }];
    const sheets = buildTemplateSheets({ subjects, careers, tagOptions });
    assert.deepEqual(Object.keys(sheets), ['Videos', 'Instrucciones', 'Materias']);
    assert.deepEqual(sheets.Videos, [['Link', 'Nombre del video', 'Materia', 'Carrera', 'Etiquetas']]);
    assert.deepEqual(sheets.Materias, [['Clave', 'Nombre'], ['general', 'General'], ['MA1028', 'Modelación matemática'], ['TC1028', 'Pensamiento computacional']]);
    assert.deepEqual(buildTemplateSheets().Materias, [['Clave', 'Nombre'], ['general', 'General']]);

    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
    XLSX.utils.sheet_add_aoa(wb.Sheets.Videos, [['https://youtu.be/B9YR-GXGncw', 'Euler', sheets.Materias[2][0], 'ITC', 'matematicas'], ['https://youtu.be/2ntPaw4vkc8', 'Polinomios', sheets.Materias[3][1], '', '']], { origin: 'A2' });
    const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const result = parse(XLSX.utils.sheet_to_json(back.Sheets.Videos, { defval: '' }), { subjects, careers, tagOptions, existingVideos: [] });
    assert.equal(result.invalid.length, 0);
    assert.deepEqual(result.valid.map((v) => v.data.Materia), ['MA1028', 'TC1028']);
});

test('buildTemplateWorkbook adds dropdowns and the file still parses with xlsx', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const XLSX = await import('xlsx');
    const { buildTemplateWorkbook } = await import('../src/utils/maetecaTemplate.js');
    const { parseVideoRows: parse } = await import('../src/utils/maetecaImport.js');
    const subjects = [{ id: 'TC1028', name: 'Pensamiento computacional' }, { id: 'MA1028', name: 'Modelación matemática' }];
    const careers = [{ name: 'Todas', code: 'all' }, { name: 'ITC', code: 'itc' }];
    const tagOptions = [{ label: '#matematicas', value: 'matematicas' }];

    const workbook = buildTemplateWorkbook(ExcelJS, { subjects, careers, tagOptions });
    assert.deepEqual(workbook.worksheets.map((w) => w.name), ['Videos', 'Instrucciones', 'Materias']);
    const videos = workbook.getWorksheet('Videos');
    assert.deepEqual(videos.getCell('C2').dataValidation.formulae, ['Materias!$B$2:$B$4']);
    assert.equal(videos.getCell('C501').dataValidation.type, 'list');
    assert.equal(videos.getCell('C502').dataValidation, undefined);
    assert.deepEqual(videos.getCell('D2').dataValidation.formulae, ['"Todas,ITC"']);

    videos.getRow(2).values = ['https://youtu.be/B9YR-GXGncw', 'Euler', 'Modelación matemática', 'ITC', 'matematicas'];
    const back = XLSX.read(Buffer.from(await workbook.xlsx.writeBuffer()));
    assert.deepEqual(back.SheetNames, ['Videos', 'Instrucciones', 'Materias']);
    const empty = XLSX.read(Buffer.from(await buildTemplateWorkbook(ExcelJS, { subjects, careers, tagOptions }).xlsx.writeBuffer()));
    assert.deepEqual(XLSX.utils.sheet_to_json(empty.Sheets.Videos, { defval: '' }), []);
    const result = parse(XLSX.utils.sheet_to_json(back.Sheets.Videos, { defval: '' }), { subjects, careers, tagOptions, existingVideos: [] });
    assert.equal(result.invalid.length, 0);
    assert.equal(result.valid[0].data.Materia, 'MA1028');
    assert.equal(result.valid[0].rowNumber, 2);
});
