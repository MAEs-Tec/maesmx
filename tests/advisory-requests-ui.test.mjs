import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as Vue from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import { parse as parseJs } from '@babel/parser';

const source = readFileSync(new URL('../src/components/RequestNotifications.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
let executable = compileScript(descriptor, { id: 'notifications-test' }).content;
const imports = parseJs(executable, { sourceType: 'module' }).program.body.filter(node => node.type === 'ImportDeclaration');
const names = imports.flatMap(node => node.specifiers.map(item => item.local.name));
for (const node of [...imports].reverse()) executable = executable.slice(0, node.start) + executable.slice(node.end);
const factory = new Function(...names, executable.replace('export default', 'return'));

function harness({ failMarkRead = false } = {}) {
    const messages = [], removed = [], subscriptions = [], navigation = [], reads = [];
    let mount, unmount, authCallback, authStopped = false;
    const services = {
        ...Vue,
        onMounted: callback => { mount = callback; },
        onBeforeUnmount: callback => { unmount = callback; },
        getAuth: () => ({}),
        onAuthStateChanged: (_, callback) => {
            authCallback = callback;
            return () => { authStopped = true; };
        },
        useRouter: () => ({ push: async destination => navigation.push(destination) }),
        useToast: () => ({ add: item => messages.push(item), removeGroup: group => removed.push(group) }),
        subscribeNotifications: (key, next, error) => {
            const subscription = { key, next, error, stopped: false };
            subscriptions.push(subscription);
            return () => { subscription.stopped = true; };
        },
        markNotificationRead: async (...args) => {
            reads.push(args);
            if (failMarkRead) throw new Error('offline');
        }
    };
    const component = factory(...names.map(name => services[name]));
    const state = component.setup({}, { expose() {} });
    mount();
    return {
        state, messages, removed, subscriptions, navigation, reads,
        auth: user => authCallback(user), unmount: () => unmount(),
        authStopped: () => authStopped
    };
}
const student = { email: ' A01234567@tec.mx ', emailVerified: true };
const notice = (id, extra = {}) => ({ id, requestId: 'request-1', title: 'Asesoría', ...extra });

test('initial notification snapshot populates unread count without replaying old popups', () => {
    const h = harness();
    h.auth(student);
    assert.equal(h.subscriptions[0].key, 'a01234567');
    h.subscriptions[0].next([notice('old'), notice('read', { readAt: 1 })]);
    assert.equal(h.state.unread.value, 1);
    assert.equal(h.messages.length, 0);
});

test('new unread notices show once while read updates and repeated snapshots do not repeat popups', () => {
    const h = harness();
    h.auth(student);
    const sub = h.subscriptions[0];
    sub.next([notice('old')]);
    sub.next([notice('new'), notice('old'), notice('already-read', { readAt: 1 })]);
    sub.next([notice('new'), notice('old', { readAt: 2 })]);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].data.id, 'new');
    assert.equal(h.state.unread.value, 1);
});

test('logout stops listeners and ignores snapshots still in flight', () => {
    const h = harness();
    h.auth(student);
    const sub = h.subscriptions[0];
    sub.next([notice('old')]);
    h.auth(null);
    sub.next([notice('late')]);
    assert.equal(sub.stopped, true);
    assert.deepEqual(h.state.notifications.value, []);
    assert.equal(h.messages.length, 0);
});

test('unverified accounts never subscribe and account changes discard the previous user data', () => {
    const h = harness();
    h.auth({ ...student, emailVerified: false });
    assert.equal(h.subscriptions.length, 0);
    h.auth(student);
    const old = h.subscriptions[0];
    old.next([notice('old')]);
    h.auth({ email: 'a07654321@tec.mx', emailVerified: true });
    old.next([notice('late')]);
    assert.equal(old.stopped, true);
    assert.deepEqual(h.state.notifications.value, []);
    assert.equal(h.subscriptions[1].key, 'a07654321');
});

test('failed read acknowledgement preserves navigation and reports that notice remains unread', async () => {
    const h = harness({ failMarkRead: true });
    h.auth(student);
    await h.state.openNotification(notice('new'));
    assert.deepEqual(h.reads, [['a01234567', 'new']]);
    assert.deepEqual(h.navigation, [{ name: 'solicitudAsesoria', params: { id: 'request-1' } }]);
    assert.match(h.state.error.value, /pendiente de lectura/);
});

test('unmount stops auth and notification listeners and clears request popups', () => {
    const h = harness();
    h.auth(student);
    h.unmount();
    assert.equal(h.authStopped(), true);
    assert.equal(h.subscriptions[0].stopped, true);
    assert.deepEqual(h.removed, ['advisory-requests']);
});
