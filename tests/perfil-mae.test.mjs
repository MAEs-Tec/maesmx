import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as Vue from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import { compile } from '@vue/compiler-dom';
import { parse as parseJs } from '@babel/parser';
import { renderToString } from '@vue/server-renderer';
import { normalizeProfile } from '../src/utils/ProfileData.js';
import * as profileUtils from '../src/utils/PerfilUtils.js';

const source = readFileSync(new URL('../src/views/PerfilMAE.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const script = compileScript(descriptor, { id: 'profile-test' }).content;
const imports = parseJs(script, { sourceType: 'module' }).program.body.filter(node => node.type === 'ImportDeclaration');
let executable = script;
for (const node of [...imports].reverse()) executable = executable.slice(0, node.start) + executable.slice(node.end);
const names = imports.flatMap(node => node.specifiers.map(specifier => specifier.local.name));
const factory = new Function(...names, executable.replace('export default', 'return'));
const render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)(Vue);

function harness(record, overrides = {}) {
    const messages = [];
    const services = {
        ...Vue, ...profileUtils, normalizeProfile,
        onMounted: () => {}, watch: () => {},
        useRoute: () => ({ params: { id: 'test-mae' } }),
        useToast: () => ({ add: message => messages.push(message) }),
        useLayout: () => ({ isDarkTheme: Vue.ref(false) }),
        FilterMatchMode: { CONTAINS: 'contains', EQUALS: 'equals' },
        getCurrentUser: async () => ({ uid: 'test-mae' }),
        getUserRecord: async () => record,
        getSubjects: async () => [],
        getAsesoriasCountForUserInCurrentSemester: async () => 0,
        countAchievedBadges: async () => 0,
        getAsesoriasByUidAndRating: async () => [],
        getStudentReport: async () => null,
        isInSchedule: () => false,
        ...overrides
    };
    const component = factory(...names.map(name => services[name] ?? (() => {})));
    const state = component.setup({}, { expose() {} });
    const ctx = Vue.proxyRefs(state);
    const html = async () => {
        const app = Vue.createSSRApp({ render() { return render.call(ctx, ctx, []); } });
        const stub = { inheritAttrs: false, setup: (_, { slots }) => () => slots.default?.() };
        for (const name of ['Button', 'Tag', 'InputText', 'Dropdown', 'Rating', 'DataTable', 'Column', 'FileUpload', 'Textarea']) app.component(name, stub);
        app.component('Dialog', { inheritAttrs: false, props: ['visible'], setup: (props, { slots }) => () => props.visible ? slots.default?.() : null });
        app.directive('tooltip', {});
        app.config.warnHandler = () => {};
        return renderToString(app);
    };
    return { state, html, messages };
}

test('initial profile render shows loading without dereferencing a null user', async () => {
    const h = harness(null);
    assert.match(await h.html(), /Cargando perfil/);
});

for (const weekSchedule of [undefined, null, {}]) {
    test(`legacy profile with schedule ${JSON.stringify(weekSchedule)} remains editable`, async () => {
        const h = harness({ uid: 'test-mae', name: 'Test MAE', weekSchedule });
        await h.state.loadProfile();
        const html = await h.html();
        assert.match(html, /Test MAE/);
        assert.match(html, /Horario/);
        assert.equal((html.match(/N\/A/g) || []).length, 5);
        h.state.showDialogHorarios.value = true;
        h.state.addTimeSlot('monday', '11:00', '15:00');
        h.state.addTimeSlot('thursday', '11:00', '12:00');
        assert.equal(h.state.getHorasHorario(), 5);
        assert.match(await h.html(), /Horas/);
    });
}

test('existing hours survive normalization without sharing the editor objects', () => {
    const original = { weekSchedule: { monday: [{ start: '11:00', end: '15:00' }] } };
    const profile = normalizeProfile(original);
    assert.deepEqual(profile.weekSchedule, original.weekSchedule);
    profile.weekSchedule.monday[0].start = '12:00';
    assert.equal(original.weekSchedule.monday[0].start, '11:00');
});

test('a profile with only one badge renders', async () => {
    const h = harness({ uid: 'test-mae', badges: [{ id: '1', name: 'Primer logro', achieved: false }] });
    await h.state.loadProfile();
    assert.match(await h.html(), /Primer logro/);
});

test('missing account and failed reads show a retry action', async () => {
    for (const overrides of [{}, { getUserRecord: async () => { throw new Error('offline'); } }]) {
        const h = harness(null, overrides);
        await h.state.loadProfile();
        assert.ok(h.state.loadError.value);
        assert.equal(h.state.isLoading.value, false);
        assert.match(await h.html(), /role="alert"/);
    }
});

test('statistics failure does not block the schedule editor', async () => {
    const h = harness({ uid: 'test-mae' }, { getSubjects: async () => { throw new Error('offline'); } });
    await h.state.loadProfile();
    assert.equal(h.state.loadError.value, '');
    assert.match(await h.html(), /Horario/);
    assert.equal(h.messages[0].severity, 'warn');
});

test('retry recovers after a temporary read failure', async () => {
    let failing = true;
    const h = harness(null, { getUserRecord: async () => {
        if (failing) throw new Error('offline');
        return { uid: 'test-mae', name: 'Recovered profile' };
    } });
    await h.state.loadProfile();
    assert.ok(h.state.loadError.value);
    failing = false;
    await h.state.loadProfile();
    assert.equal(h.state.loadError.value, '');
    assert.match(await h.html(), /Recovered profile/);
});

test('an older request cannot replace a newer profile', async () => {
    let resolveOld;
    let calls = 0;
    const oldRequest = new Promise(resolve => { resolveOld = resolve; });
    const h = harness(null, { getUserRecord: () => ++calls === 1 ? oldRequest : Promise.resolve({ uid: 'test-mae', name: 'Latest profile' }) });
    const firstLoad = h.state.loadProfile();
    await Promise.resolve();
    await h.state.loadProfile();
    resolveOld({ uid: 'old-mae', name: 'Old profile' });
    await firstLoad;
    assert.equal(h.state.maeInfo.value.name, 'Latest profile');
});
