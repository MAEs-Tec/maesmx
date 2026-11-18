import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as Vue from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import { parse as parseJs } from '@babel/parser';
import { normalizeProfile } from '../src/utils/ProfileData.js';
import * as profileUtils from '../src/utils/PerfilUtils.js';

const source = readFileSync(new URL('../src/views/PerfilMAE.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
let executable = compileScript(descriptor, { id: 'advisory-profile-test' }).content;
const imports = parseJs(executable, { sourceType: 'module' }).program.body.filter(node => node.type === 'ImportDeclaration');
const names = imports.flatMap(node => node.specifiers.map(item => item.local.name));
for (const node of [...imports].reverse()) executable = executable.slice(0, node.start) + executable.slice(node.end);
const factory = new Function(...names, executable.replace('export default', 'return'));
const request = changes => ({ id: 'request-123', studentKey: 'student', assignedMaeKey: 'mae', status: 'assigned',
    assignmentVersion: 3, subject: { id: 'math', name: 'Matemáticas' }, topic: 'Integrales', ...changes });

function harness({ candidate = request(), register = async () => {}, refresh = async () => ({ uid: 'mae' }),
    matching = async () => [candidate], allowAdd = false, query = { requestId: 'request-123' } } = {}) {
    const messages = [], calls = [], forbidden = [], replaced = [];
    const services = {
        ...Vue, ...profileUtils, normalizeProfile, onMounted: () => {}, watch: () => {},
        useRoute: () => ({ params: { id: 'mae' }, query }),
        useRouter: () => ({ replace: async destination => replaced.push(destination) }),
        useToast: () => ({ add: message => messages.push(message) }),
        useLayout: () => ({ isDarkTheme: Vue.ref(false) }),
        FilterMatchMode: { CONTAINS: 'contains', EQUALS: 'equals' },
        getAdvisoryRequest: async id => { calls.push(['read', id]); return candidate; },
        getMatchingRequests: async (...args) => matching(...args),
        registerRequestedAdvisory: async data => { calls.push(['register', data]); return register(data); },
        addAsesoria: async (...args) => { calls.push(['add', args]); if (!allowAdd) forbidden.push('addAsesoria'); },
        updateRatingBonusForMae: async () => { forbidden.push('updateRatingBonusForMae'); },
        updateAsesoria: async () => { forbidden.push('updateAsesoria'); },
        getUserRecord: refresh,
        getAsesoriasCountForUserInCurrentSemester: async () => 1
    };
    const component = factory(...names.map(name => services[name] ?? (() => {})));
    const state = component.setup({}, { expose() {} });
    state.userInfo.value = { uid: 'student' };
    state.maeInfo.value = { uid: 'mae', subjects: [], points: 10, ratingBonusPoints: 0 };
    return { state, messages, calls, forbidden, replaced };
}

test('request deep link preloads the assigned subject and assignment generation', async () => {
    const h = harness();
    await h.state.openAsesoriaDialog('request-123');
    assert.deepEqual(h.calls, [['read', 'request-123']]);
    assert.equal(h.state.showDialogAsesoria.value, true);
    assert.equal(h.state.selectedRequest.value.assignmentVersion, 3);
    assert.equal(h.state.materiaAsesoria.value.id, 'math');
    assert.equal(h.state.requestLoadError.value, '');
});

test('deep link rejects another student, another MAE and states that cannot register', async () => {
    for (const changes of [{ studentKey: 'other' }, { assignedMaeKey: 'other' }, { status: 'open' },
        { status: 'registered' }, { status: 'closed', closeReason: 'not_held' }]) {
        const h = harness({ candidate: request(changes) });
        await h.state.openAsesoriaDialog('request-123');
        assert.ok(h.state.requestLoadError.value);
        assert.equal(h.state.selectedRequest.value, null);
        assert.equal(h.state.materiaAsesoria.value, null);
        await h.state.saveAsesoria();
        assert.equal(h.calls.filter(([type]) => type === 'register').length, 0);
    }
});

test('closed missing-registration request remains available to its student', async () => {
    const h = harness({ candidate: request({ status: 'closed', closeReason: 'missing_registration' }) });
    await h.state.openAsesoriaDialog('request-123');
    assert.equal(h.state.requestLoadError.value, '');
    assert.equal(h.state.selectedRequest.value.id, 'request-123');
});

test('linked registration calls the server once with review data and clears the dialog', async () => {
    const h = harness();
    await h.state.openAsesoriaDialog('request-123');
    h.state.ratingAsesoria.value = 5;
    h.state.comentarioAsesoria.value = 'Excelente apoyo';
    await h.state.saveAsesoria();
    assert.deepEqual(h.calls[1], ['register', { requestId: 'request-123', assignmentVersion: 3, rating: 5, comment: 'Excelente apoyo' }]);
    assert.deepEqual(h.forbidden, []);
    assert.equal(h.state.showDialogAsesoria.value, false);
    assert.equal(h.state.selectedRequest.value, null);
    assert.equal(h.state.comentarioAsesoria.value, '');
    assert.equal(h.state.ratingAsesoria.value, null);
    assert.ok(h.messages.some(item => item.severity === 'success'));
});

test('registration failure preserves entered review and selected request for retry', async () => {
    const h = harness({ register: async () => { throw new Error('La asignación cambió'); } });
    await h.state.openAsesoriaDialog('request-123');
    h.state.ratingAsesoria.value = 4;
    h.state.comentarioAsesoria.value = 'Conservar comentario';
    await h.state.saveAsesoria();
    assert.equal(h.state.showDialogAsesoria.value, true);
    assert.equal(h.state.selectedRequest.value.id, 'request-123');
    assert.equal(h.state.comentarioAsesoria.value, 'Conservar comentario');
    assert.equal(h.state.ratingAsesoria.value, 4);
    assert.equal(h.state.isSavingAsesoria.value, false);
    assert.equal(h.messages.at(-1).severity, 'error');
    assert.deepEqual(h.forbidden, []);
});

test('double click cannot start a second linked registration while the first is pending', async () => {
    let finish;
    const h = harness({ register: () => new Promise(resolve => { finish = resolve; }) });
    await h.state.openAsesoriaDialog('request-123');
    const first = h.state.saveAsesoria();
    await h.state.saveAsesoria();
    assert.equal(h.calls.filter(([type]) => type === 'register').length, 1);
    assert.equal(h.state.isSavingAsesoria.value, true);
    finish();
    await first;
    assert.equal(h.state.isSavingAsesoria.value, false);
});

test('profile refresh failure after registration does not report a failed save or reopen the dialog', async () => {
    const h = harness({ refresh: async () => { throw new Error('Refresh offline'); } });
    await h.state.openAsesoriaDialog('request-123');
    await h.state.saveAsesoria();
    assert.ok(h.messages.some(item => item.severity === 'success'));
    assert.equal(h.messages.some(item => item.severity === 'error'), false);
    assert.equal(h.state.showDialogAsesoria.value, false);
    assert.equal(h.state.selectedRequest.value, null);
    assert.equal(h.state.isSavingAsesoria.value, false);
    assert.deepEqual(h.forbidden, []);
});

test('plain registration is not blocked when the pending-requests lookup fails', async () => {
    const h = harness({ query: {}, allowAdd: true, matching: async () => { throw new Error('index missing'); } });
    await h.state.openAsesoriaDialog();
    assert.equal(h.state.requestLoadError.value, '');
    assert.ok(h.state.requestLookupHint.value);
    h.state.materiaAsesoria.value = { id: 'math', name: 'Matemáticas' };
    await h.state.saveAsesoria();
    assert.equal(h.calls.filter(([type]) => type === 'add').length, 1);
    assert.equal(h.state.showDialogAsesoria.value, false);
});

test('linked lookup failure stays blocked, and success removes requestId from the URL', async () => {
    const blocked = harness({ candidate: null });
    await blocked.state.openAsesoriaDialog('request-123');
    assert.ok(blocked.state.requestLoadError.value);
    const h = harness({ query: { requestId: 'request-123', other: '1' } });
    await h.state.openAsesoriaDialog('request-123');
    await h.state.saveAsesoria();
    assert.deepEqual(h.replaced, [{ query: { other: '1' } }]);
});
