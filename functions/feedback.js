// Sugerencias y reportes de fallos desde la app.
//
// submitFeedback (callable, requiere sesión):
//   1. Limita a MAX_PER_HOUR envíos por usuario (doc feedbackRate/{matrícula}).
//   2. Guarda el mensaje completo, con quién lo envió, en feedback/{id} (solo admin/tec lo leen).
//   3. Abre un issue en GitHub SIN nombre ni correo: el repositorio es público.
// Si GitHub falla o no hay token, el envío no se pierde: queda en Firestore con issueError.

const TYPES = {
    sugerencia: { label: 'Sugerencia', githubLabels: ['enhancement', 'desde-la-app'] },
    fallo: { label: 'Fallo', githubLabels: ['bug', 'desde-la-app'] }
};
const STATUSES = ['nuevo', 'en_revision', 'hecho', 'descartado'];
const LIMITS = { title: [5, 120], body: [10, 4000], page: 200, userAgent: 300 };
const MAX_PER_HOUR = 5;
const HOUR_MS = 3600000;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

function cleanText(value, max) {
    return String(value ?? '')
        .replace(/\r\n/g, '\n')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim()
        .slice(0, max);
}

// Solo la ruta (sin query, hash de datos ni dominio): /maeteca, /solicitudes/abc...
function cleanPage(value) {
    const text = cleanText(value, LIMITS.page);
    const path = text.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/?#/, '').split('?')[0];
    return /^\/[\w\-./:]*$/.test(path) ? path : '';
}

// Evita notificar a cuentas de GitHub (@usuario) y cerrar issues (#123 no hace daño).
function neutralizeMentions(text) {
    return text.replace(/@(?=[A-Za-z0-9-])/g, '@​');
}

function validateFeedback(data, HttpsError) {
    const type = String(data?.type ?? '');
    if (!TYPES[type]) throw new HttpsError('invalid-argument', 'Elige si es una sugerencia o un fallo.');
    const title = cleanText(data?.title, LIMITS.title[1]);
    if (title.length < LIMITS.title[0]) throw new HttpsError('invalid-argument', `El título debe tener al menos ${LIMITS.title[0]} caracteres.`);
    const body = cleanText(data?.body, LIMITS.body[1]);
    if (body.length < LIMITS.body[0]) throw new HttpsError('invalid-argument', `Cuéntanos un poco más (mínimo ${LIMITS.body[0]} caracteres).`);
    return {
        type,
        title,
        body,
        page: cleanPage(data?.page),
        userAgent: cleanText(data?.userAgent, LIMITS.userAgent)
    };
}

// Texto del issue público: sin nombre, correo ni matrícula.
function buildIssue(feedback, { id, role }) {
    const meta = TYPES[feedback.type];
    const lines = [
        `**Tipo:** ${meta.label}`,
        `**Página:** ${feedback.page ? `\`${feedback.page}\`` : 'sin dato'}`,
        `**Rol de quien lo envía:** ${role}`,
        `**Navegador:** ${feedback.userAgent ? `\`${feedback.userAgent.replace(/`/g, "'")}\`` : 'sin dato'}`,
        '',
        '---',
        '',
        neutralizeMentions(feedback.body),
        '',
        '---',
        `<sub>Enviado desde la app (feedback \`${id}\`). Los datos de quien lo envió están en Firestore, no aquí.</sub>`
    ];
    return {
        title: `[${meta.label}] ${neutralizeMentions(feedback.title)}`,
        body: lines.join('\n'),
        labels: meta.githubLabels
    };
}

function createFeedbackService({ db, HttpsError, FieldValue, getToken, repo, fetchImpl = fetch, now = () => Date.now(), logger = console }) {
    async function reserveSlot(userKey) {
        const ref = db.collection('feedbackRate').doc(userKey);
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const current = snap.exists ? snap.data() : {};
            const time = now();
            const fresh = !current.windowStart || time - current.windowStart >= HOUR_MS;
            const count = fresh ? 0 : Number(current.count || 0);
            if (count >= MAX_PER_HOUR) {
                throw new HttpsError('resource-exhausted', 'Ya enviaste varios mensajes en la última hora. Intenta más tarde.');
            }
            tx.set(ref, { windowStart: fresh ? time : current.windowStart, count: count + 1 });
        });
    }

    async function openIssue(issue) {
        const token = getToken();
        if (!token) return { error: 'GitHub no configurado (falta GITHUB_FEEDBACK_TOKEN).' };
        const request = (payload) =>
            fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'Content-Type': 'application/json',
                    'User-Agent': 'maesmx-feedback'
                },
                body: JSON.stringify(payload)
            });
        let response = await request(issue);
        // Sin permiso para etiquetas (o etiqueta inválida): se reintenta sin ellas.
        if (response.status === 422 || response.status === 403) {
            const { labels: _labels, ...withoutLabels } = issue;
            response = await request(withoutLabels);
        }
        if (!response.ok) return { error: githubError(response.status) };
        const created = await response.json();
        return { number: created.number, url: created.html_url };
    }

    // Intenta abrir el issue y deja el resultado en el documento (issueNumber/issueUrl o issueError).
    async function attachIssue(ref, feedback, role) {
        let issue;
        try {
            issue = await openIssue(buildIssue(feedback, { id: ref.id, role }));
        } catch (error) {
            issue = { error: `No se pudo contactar a GitHub: ${error.message}` };
        }
        if (issue.error) {
            logger.warn('Feedback guardado sin issue', { id: ref.id, error: issue.error });
            await ref.update({ issueError: issue.error });
            return null;
        }
        await ref.update({ issueNumber: issue.number, issueUrl: issue.url, issueError: FieldValue.delete() });
        return issue.url;
    }

    async function submit(data, context) {
        if (!context.auth) throw new HttpsError('unauthenticated', 'Inicia sesión para enviar sugerencias.');
        const email = normalizeEmail(context.auth.token?.email);
        const userKey = email.split('@')[0];
        if (!userKey || !/^[a-z0-9._-]+$/.test(userKey)) throw new HttpsError('permission-denied', 'Cuenta sin correo válido.');
        if (context.auth.token?.email_verified === false) throw new HttpsError('permission-denied', 'Verifica tu correo antes de enviar sugerencias.');

        const feedback = validateFeedback(data, HttpsError);
        await reserveSlot(userKey);

        const role = context.auth.token?.role || 'user';
        const ref = db.collection('feedback').doc();
        await ref.set({
            ...feedback,
            role,
            uid: userKey,
            email,
            name: cleanText(context.auth.token?.name, 120),
            status: 'nuevo',
            createdAt: FieldValue.serverTimestamp()
        });

        const issueUrl = await attachIssue(ref, feedback, role);
        return { id: ref.id, issueUrl };
    }

    // Admin/tec: vuelve a intentar el issue de un envío que se guardó sin él (token vencido, issues desactivados…).
    async function retryIssue(data, context) {
        if (!context.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.');
        if (!ADMIN_ROLES.includes(context.auth.token?.role)) throw new HttpsError('permission-denied', 'Solo admin y tec pueden reintentar.');
        const id = String(data?.id ?? '');
        if (!/^[A-Za-z0-9]{1,64}$/.test(id)) throw new HttpsError('invalid-argument', 'Sugerencia inválida.');
        const ref = db.collection('feedback').doc(id);
        const snap = await ref.get();
        if (!snap.exists) throw new HttpsError('not-found', 'La sugerencia ya no existe.');
        const saved = snap.data();
        if (saved.issueUrl) return { id, issueUrl: saved.issueUrl, issueNumber: saved.issueNumber };
        // Mismo texto público que al enviarlo: solo campos validados, sin nombre ni correo.
        const feedback = { type: saved.type, title: saved.title, body: saved.body, page: saved.page || '', userAgent: saved.userAgent || '' };
        if (!TYPES[feedback.type]) throw new HttpsError('failed-precondition', 'La sugerencia guardada no tiene un tipo válido.');
        const issueUrl = await attachIssue(ref, feedback, saved.role || 'user');
        if (!issueUrl) {
            const after = (await ref.get()).data();
            throw new HttpsError('unavailable', after?.issueError || 'GitHub no respondió.');
        }
        const after = (await ref.get()).data();
        return { id, issueUrl, issueNumber: after?.issueNumber ?? null };
    }

    return { submit, retryIssue };
}

const ADMIN_ROLES = ['admin', 'tec'];

// Mensajes en español para los fallos más comunes de la API de issues.
function githubError(status) {
    if (status === 410) return 'Los issues están desactivados en el repositorio de GitHub.';
    if (status === 401) return 'El token de GitHub no es válido o venció.';
    if (status === 403 || status === 404) return 'El token de GitHub no tiene permiso para crear issues en el repositorio.';
    return `GitHub respondió ${status}.`;
}

module.exports = { createFeedbackService, githubError, validateFeedback, buildIssue, cleanPage, neutralizeMentions, TYPES, STATUSES, MAX_PER_HOUR };
