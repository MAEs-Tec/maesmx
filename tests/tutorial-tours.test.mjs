import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    TUTORIAL_VERSION,
    MENU_SECTIONS,
    PAGE_TOURS,
    sectionsForRole,
    pendingMenuKeys,
    buildMenuSteps,
    buildPageSteps,
    hasPageTour,
    seenUpdate
} from '../src/tutorial/tours.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('cada rol ve solo las secciones de su menú', () => {
    const keys = (role) => sectionsForRole(role).map((s) => s.key);
    assert.deepEqual(keys('user'), ['menu-estudiante']);
    assert.deepEqual(keys('exmae'), ['menu-estudiante']);
    assert.deepEqual(keys(undefined), ['menu-estudiante']);
    assert.deepEqual(keys('mae'), ['menu-estudiante', 'menu-mae']);
    assert.deepEqual(keys('publi'), ['menu-estudiante', 'menu-mae', 'menu-publi']);
    assert.deepEqual(keys('subjectCoordi'), ['menu-estudiante', 'menu-mae', 'menu-coordi']);
    assert.deepEqual(keys('coordi'), ['menu-estudiante', 'menu-mae', 'menu-coordi']);
    assert.deepEqual(keys('tec'), ['menu-estudiante', 'menu-admin', 'menu-mae', 'menu-coordi']);
    assert.deepEqual(keys('admin'), ['menu-estudiante', 'menu-admin', 'menu-mae', 'menu-coordi']);
});

test('pendingMenuKeys: usuario nuevo ve todo; al subir de rol, solo lo nuevo', () => {
    assert.deepEqual(pendingMenuKeys('user', undefined), ['menu-estudiante']);
    assert.deepEqual(pendingMenuKeys('user', { 'menu-estudiante': TUTORIAL_VERSION }), []);
    assert.deepEqual(pendingMenuKeys('mae', { 'menu-estudiante': TUTORIAL_VERSION }), ['menu-mae']);
    assert.deepEqual(pendingMenuKeys('mae', { 'menu-estudiante': TUTORIAL_VERSION - 1 }), ['menu-estudiante', 'menu-mae']);
    assert.deepEqual(pendingMenuKeys('coordi', 'basura'), ['menu-estudiante', 'menu-mae', 'menu-coordi']);
});

test('buildMenuSteps: saludo, un paso por opción del menú y el botón de ayuda al final', () => {
    const steps = buildMenuSteps('user', { firstName: 'Ana' });
    assert.match(steps[0].popover.title, /Hola, Ana/);
    assert.equal(steps[0].element, undefined);
    const items = MENU_SECTIONS.find((s) => s.key === 'menu-estudiante').items;
    assert.equal(steps.length, items.length + 2);
    assert.equal(steps[1].element, '[data-tour="menu:/inicio"]');
    assert.equal(steps.at(-1).element, '[data-tour="tutorial-button"]');
});

test('buildMenuSteps: al subir de rol el saludo habla de funciones nuevas', () => {
    const steps = buildMenuSteps('mae', { keys: ['menu-mae'] });
    assert.match(steps[0].popover.title, /funciones nuevas/);
    assert.ok(steps.some((s) => s.element === '[data-tour="menu:/mae"]'));
    assert.ok(!steps.some((s) => s.element === '[data-tour="menu:/inicio"]'));
});

test('buildMenuSteps: las opciones solo de admin no aparecen para tec', () => {
    const tec = buildMenuSteps('tec').map((s) => s.element);
    const admin = buildMenuSteps('admin').map((s) => s.element);
    assert.ok(tec.includes('[data-tour="menu:/admin/usuarios"]'));
    assert.ok(!tec.includes('[data-tour="menu:/admin/funciones"]'));
    assert.ok(admin.includes('[data-tour="menu:/admin/funciones"]'));
});

test('el menú del tutorial coincide con buildMenuForRole', () => {
    const roles = read('../src/auth/roles.js');
    for (const section of MENU_SECTIONS) {
        for (const item of section.items) {
            if (item.to) assert.ok(roles.includes(`to: '${item.to}'`), `falta ${item.to} en roles.js`);
        }
    }
    assert.ok(roles.includes("tour: 'menu:/mae'"));
});

test('guías de página: filtran por rol y apuntan a data-tour que existen en la vista', () => {
    assert.ok(hasPageTour('maeteca'));
    assert.ok(!hasPageTour('noexiste'));
    assert.deepEqual(buildPageSteps('noexiste', 'admin'), []);

    const user = buildPageSteps('maeteca', 'user').map((s) => s.element);
    const coordi = buildPageSteps('maeteca', 'coordi').map((s) => s.element);
    assert.ok(!user.includes('[data-tour="maeteca-agregar"]'));
    assert.ok(coordi.includes('[data-tour="maeteca-agregar"]'));
    assert.ok(!buildPageSteps('inicio', 'user').some((s) => s.element.includes('inicio-turno')));

    const views = {
        inicio: 'Inicio', solicitudAsesoria: 'SolicitudesAsesoria', maeteca: 'Maeteca',
        misasesorias: 'Asesorias', coordi: 'Coordi', adminusuarios: 'AdminUsers'
    };
    assert.deepEqual(Object.keys(PAGE_TOURS).sort(), Object.keys(views).sort());
    for (const [route, view] of Object.entries(views)) {
        const source = read(`../src/views/${view}.vue`);
        for (const step of PAGE_TOURS[route].steps) {
            const id = step.element.match(/data-tour="([^"]+)"/)[1];
            assert.ok(source.includes(`data-tour="${id}"`), `${view}.vue no tiene data-tour="${id}"`);
        }
    }
});

test('seenUpdate arma los campos con punto para updateDoc', () => {
    assert.deepEqual(seenUpdate(['menu-mae', 'menu-coordi']), {
        'tutorials.menu-mae': TUTORIAL_VERSION,
        'tutorials.menu-coordi': TUTORIAL_VERSION
    });
    assert.deepEqual(seenUpdate([]), {});
});
