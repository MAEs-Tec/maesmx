const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeedbackService, validateFeedback, buildIssue, cleanPage, neutralizeMentions, MAX_PER_HOUR } = require('../feedback');

class HttpsError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const DELETE = Symbol('delete');

// Firestore mínimo en memoria: doc().set/update (con FieldValue.delete), runTransaction con get/set.
function fakeDb() {
    const data = new Map();
    let auto = 0;
    const ref = (collection, id) => ({
        id,
        path: `${collection}/${id}`,
        get: async () => ({ exists: data.has(`${collection}/${id}`), data: () => data.get(`${collection}/${id}`) }),
        set: async (value) => data.set(`${collection}/${id}`, { ...value }),
        update: async (value) => {
            const next = { ...data.get(`${collection}/${id}`), ...value };
            for (const [k, v] of Object.entries(next)) if (v === DELETE) delete next[k];
            data.set(`${collection}/${id}`, next);
        }
    });
    return {
        data,
        collection: (name) => ({ doc: (id) => ref(name, id ?? `fb${++auto}`) }),
        runTransaction: async (fn) =>
            fn({
                get: (r) => r.get(),
                set: (r, value) => data.set(r.path, { ...value })
            })
    };
}

function harness({ token = 'tkn', response = { status: 201, ok: true, body: { number: 7, html_url: 'https://github.com/o/r/issues/7' } }, time = 1_000_000 } = {}) {
    const db = fakeDb();
    const calls = [];
    const clock = { time };
    const responses = Array.isArray(response) ? [...response] : null;
    const service = createFeedbackService({
        db,
        HttpsError,
        FieldValue: { serverTimestamp: () => 'SERVER_TIME', delete: () => DELETE },
        getToken: () => token,
        repo: 'MAEs-Tec/maesmx',
        now: () => clock.time,
        logger: { warn() {} },
        fetchImpl: async (url, options) => {
            calls.push({ url, options, payload: JSON.parse(options.body) });
            const r = responses ? responses.shift() : response;
            if (r instanceof Error) throw r;
            return { status: r.status, ok: r.ok, json: async () => r.body };
        }
    });
    return { db, calls, clock, service };
}

const context = (token = {}) => ({ auth: { uid: 'auth-1', token: { email: 'A00000006@tec.mx', role: 'user', name: 'Elena Prueba', email_verified: true, ...token } } });
const valid = { type: 'fallo', title: 'No carga la Maeteca', body: 'Al abrir la Maeteca en el celular se queda en blanco.', page: '/maeteca', userAgent: 'Mozilla/5.0' };

test('sin sesión o sin correo verificado no se puede enviar', async () => {
    const { service } = harness();
    await assert.rejects(service.submit(valid, {}), { code: 'unauthenticated' });
    await assert.rejects(service.submit(valid, context({ email_verified: false })), { code: 'permission-denied' });
});

test('valida tipo, título y descripción', () => {
    assert.throws(() => validateFeedback({ ...valid, type: 'otro' }, HttpsError), { code: 'invalid-argument' });
    assert.throws(() => validateFeedback({ ...valid, title: 'abc' }, HttpsError), { code: 'invalid-argument' });
    assert.throws(() => validateFeedback({ ...valid, body: 'corto' }, HttpsError), { code: 'invalid-argument' });
    const ok = validateFeedback({ ...valid, title: '  '.repeat(3) + 'x'.repeat(200) }, HttpsError);
    assert.equal(ok.title.length, 120);
});

test('la página se reduce a la ruta, sin dominio ni query', () => {
    assert.equal(cleanPage('/maeteca'), '/maeteca');
    assert.equal(cleanPage('https://peer-teaching.web.app/#/solicitudes/abc?x=1'), '/solicitudes/abc');
    assert.equal(cleanPage('javascript:alert(1)'), '');
});

test('el issue es público: lleva tipo, página y rol, pero no nombre, correo ni matrícula', () => {
    const issue = buildIssue(validateFeedback({ ...valid, body: 'Hola @someone, falla esto. Mi correo es a00000006@tec.mx' }, HttpsError), { id: 'fb1', role: 'mae' });
    assert.equal(issue.title, '[Fallo] No carga la Maeteca');
    assert.deepEqual(issue.labels, ['bug', 'desde-la-app']);
    assert.match(issue.body, /`\/maeteca`/);
    assert.match(issue.body, /\*\*Rol de quien lo envía:\*\* mae/);
    assert.ok(!issue.body.includes('Elena'));
    assert.ok(!issue.body.includes('@someone'), 'las menciones se neutralizan');
    assert.equal(neutralizeMentions('@abc'), '@\u200babc');
});

test('envío correcto: guarda todo en Firestore y abre el issue con el token', async () => {
    const { db, calls, service } = harness();
    const result = await service.submit(valid, context());
    assert.equal(result.issueUrl, 'https://github.com/o/r/issues/7');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.github.com/repos/MAEs-Tec/maesmx/issues');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer tkn');
    assert.ok(!calls[0].options.body.includes('a00000006'));

    const saved = db.data.get(`feedback/${result.id}`);
    assert.equal(saved.uid, 'a00000006');
    assert.equal(saved.email, 'a00000006@tec.mx');
    assert.equal(saved.name, 'Elena Prueba');
    assert.equal(saved.status, 'nuevo');
    assert.equal(saved.issueNumber, 7);
    assert.equal(saved.createdAt, 'SERVER_TIME');
});

test('sin token o con GitHub caído el mensaje se guarda igual, con issueError', async () => {
    const noToken = harness({ token: '' });
    const a = await noToken.service.submit(valid, context());
    assert.equal(a.issueUrl, null);
    assert.equal(noToken.calls.length, 0);
    assert.match(noToken.db.data.get(`feedback/${a.id}`).issueError, /GITHUB_FEEDBACK_TOKEN/);

    const down = harness({ response: new Error('ECONNRESET') });
    const b = await down.service.submit(valid, context());
    assert.match(down.db.data.get(`feedback/${b.id}`).issueError, /ECONNRESET/);

    const forbidden = harness({ response: [{ status: 403, ok: false }, { status: 403, ok: false }] });
    const c = await forbidden.service.submit(valid, context());
    assert.equal(forbidden.calls.length, 2);
    assert.ok(!('labels' in forbidden.calls[1].payload), 'el reintento va sin etiquetas');
    assert.match(forbidden.db.data.get(`feedback/${c.id}`).issueError, /no tiene permiso/);
});

test(`máximo ${MAX_PER_HOUR} envíos por hora por usuario`, async () => {
    const { service, clock } = harness();
    for (let i = 0; i < MAX_PER_HOUR; i++) await service.submit(valid, context());
    await assert.rejects(service.submit(valid, context()), { code: 'resource-exhausted' });
    // Otra persona no se ve afectada.
    await service.submit(valid, context({ email: 'a00000012@tec.mx' }));
    // Pasada la hora se libera.
    clock.time += 3600000;
    await service.submit(valid, context());
});

test('el 410 de GitHub (issues desactivados) se explica en español', async () => {
    const { githubError } = require('../feedback');
    assert.match(githubError(410), /issues están desactivados/);
    assert.match(githubError(401), /token/);
    assert.equal(githubError(500), 'GitHub respondió 500.');
    const h = harness({ response: { status: 410, ok: false } });
    const r = await h.service.submit(valid, context());
    assert.match(h.db.data.get(`feedback/${r.id}`).issueError, /desactivados/);
});

test('reintentar: solo admin/tec, abre el issue con el mismo texto público y limpia el error', async () => {
    const h = harness({ response: [{ status: 410, ok: false }, { status: 201, ok: true, body: { number: 9, html_url: 'https://github.com/o/r/issues/9' } }] });
    const { id } = await h.service.submit(valid, context());
    assert.ok(h.db.data.get(`feedback/${id}`).issueError);

    await assert.rejects(h.service.retryIssue({ id }, context()), { code: 'permission-denied' });
    await assert.rejects(h.service.retryIssue({ id }, {}), { code: 'unauthenticated' });
    await assert.rejects(h.service.retryIssue({ id: '../x' }, context({ role: 'admin' })), { code: 'invalid-argument' });
    await assert.rejects(h.service.retryIssue({ id: 'noexiste' }, context({ role: 'admin' })), { code: 'not-found' });

    const r = await h.service.retryIssue({ id }, context({ role: 'tec', email: 'a00000002@tec.mx' }));
    assert.deepEqual(r, { id, issueUrl: 'https://github.com/o/r/issues/9', issueNumber: 9 });
    const saved = h.db.data.get(`feedback/${id}`);
    assert.equal(saved.issueNumber, 9);
    assert.ok(!('issueError' in saved));
    // El reintento usa el rol de quien envió (user), no el de quien reintenta, y no lleva datos personales.
    const payload = h.calls.at(-1).payload;
    assert.match(payload.body, /\*\*Rol de quien lo envía:\*\* user/);
    assert.ok(!payload.body.includes('a00000006') && !payload.body.includes('Elena'));
    // Si ya tiene issue, no abre otro.
    await h.service.retryIssue({ id }, context({ role: 'admin' }));
    assert.equal(h.calls.length, 2);
});

test('reintentar cuando GitHub sigue fallando devuelve el motivo', async () => {
    const h = harness({ response: { status: 410, ok: false } });
    const { id } = await h.service.submit(valid, context());
    await assert.rejects(h.service.retryIssue({ id }, context({ role: 'admin' })), { code: 'unavailable', message: /desactivados/ });
});
