const crypto = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');

const MAE_ROLES = ['mae', 'coordi', 'admin', 'subjectCoordi', 'publi', 'tec'];
const COORDI_ROLES = ['coordi', 'admin', 'tec'];
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const userKeyFromEmail = value => normalizeEmail(value).split('@')[0];
const millis = value => {
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    return 0;
};
const LATE_TURN_WINDOW_MS = 10 * 60 * 1000;
const round = value => Math.round(value * 100) / 100;
function isActiveMae(user, now = Date.now()) {
    const start = millis(user?.activeSession?.startTime);
    return MAE_ROLES.includes(user?.role) && start > now - 5 * 60 * 60 * 1000 && start <= now;
}
function advisoryPoints(previous, now) {
    const first = previous.length === 0;
    const recent = previous.some(item => now - millis(item.date) >= 0 && now - millis(item.date) < 3 * 60 * 60 * 1000);
    return {
        pointsAwarded: (first ? 10 : 5) * (recent ? 0.5 : 1),
        pointsReason: first ? 'first_time_student' : recent ? 'recurrent_under_3_hours' : 'recurrent_student'
    };
}
function ratingBonus(ratings) {
    const valid = ratings.map(Number).filter(Number.isFinite);
    return valid.length ? round(Math.max(20, Math.min(50, valid.reduce((a, b) => a + b, 0) / valid.length * 10))) : 0;
}

function createAdvisoryService({ db, admin, functions, now = () => Date.now() }) {
    const requests = db.collection('advisoryRequests');
    const stamp = () => Timestamp.fromMillis(now());
    const fail = (code, message) => { throw new functions.https.HttpsError(code, message); };
    function text(value, field, max = 200) {
        if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail('invalid-argument', `${field} no es válido.`);
        return value.trim();
    }
    function id(value, field = 'requestId') {
        const result = text(value, field, 128);
        if (!/^[\w-]+$/.test(result)) fail('invalid-argument', `${field} no es válido.`);
        return result;
    }
    async function actor(context) {
        const email = normalizeEmail(context.auth?.token?.email);
        if (!context.auth) fail('unauthenticated', 'Inicia sesión.');
        if (!context.auth.token.email_verified || !/^[a-z0-9._%+-]+@tec\.mx$/.test(email)) fail('permission-denied', 'Verifica tu correo institucional.');
        const key = userKeyFromEmail(email);
        const profile = await db.collection('users').doc(key).get();
            if (!profile.exists) fail('failed-precondition', 'Tu perfil ya no esta disponible.');
        const user = profile.data();
        return { key, email, user, role: context.auth.token.role || user.role || 'user' };
    }
    function manages(who, request) {
        return request.studentKey === who.key || request.creatorKey === who.key ||
            ['admin', 'tec'].includes(who.role) || (who.role === 'coordi' && who.user.campus === request.campus);
    }
    function requireManage(who, request) {
        if (!manages(who, request)) fail('permission-denied', 'No puedes gestionar esta solicitud.');
    }
    function requireOpen(request) {
        if (request.status !== 'open') fail('failed-precondition', 'La solicitud ya no busca asesor.');
    }
    async function readRequest(tx, ref) {
        const snap = await tx.get(ref);
        if (!snap.exists) fail('not-found', 'Solicitud no encontrada.');
        return snap.data();
    }
    async function coordinators(campus) {
        const snap = await db.collection('users').where('campus', '==', campus).where('role', 'in', COORDI_ROLES).get();
        return snap.docs.map(doc => doc.id);
    }
    // Solo usuarios con turno reciente; isActiveMae sigue siendo la fuente de verdad.
    async function activeMaes(campus) {
        const since = Timestamp.fromMillis(now() - 5 * 60 * 60 * 1000);
        const snap = await db.collection('users').where('campus', '==', campus).where('activeSession.startTime', '>', since).get();
        return snap.docs.filter(doc => isActiveMae(doc.data(), now()));
    }
    async function eligible(request) {
        return (await activeMaes(request.campus)).filter(doc => doc.id !== request.studentKey && doc.id !== request.lastUnassignedMaeKey);
    }
    const matchesSubject = (user, request) => (user.subjects || []).some(subject => subject.id === request.subject.id);
    function event(tx, ref, eventId, type, recipients, title, body, generation = 0) {
        tx.set(ref.collection('events').doc(eventId), {
            requestId: ref.id, type, recipientKeys: [...new Set(recipients.filter(Boolean))],
            title, body, generation, createdAt: stamp()
        });
    }
    const participants = request => [request.studentKey, request.creatorKey, request.assignedMaeKey];
    async function createAdvisoryRequest(data, context) {
        const who = await actor(context);
        const operationId = id(data.operationId, 'operationId');
        const email = normalizeEmail(data.studentEmail || who.email);
        if (!/^[a-z0-9._%+-]+@tec\.mx$/.test(email)) fail('invalid-argument', 'Introduce un correo institucional válido.');
        if (email !== who.email && !COORDI_ROLES.includes(who.role)) fail('permission-denied', 'Solo coordinación puede publicar por otro estudiante.');
        const studentKey = userKeyFromEmail(email);
        const [studentSnap, subjectSnap] = await Promise.all([
            db.collection('users').doc(studentKey).get(),
            db.doc(`schools/tec.mx/subjects/${id(data.subjectId, 'subjectId')}`).get()
        ]);
        if (!subjectSnap.exists) fail('invalid-argument', 'Materia no encontrada.');
        const student = studentSnap.exists ? studentSnap.data() : null;
        const campus = text(student?.campus || (email === who.email ? who.user.campus : null) || data.campus, 'campus', 100);
        if (who.role === 'coordi' && who.user.campus !== campus) fail('permission-denied', 'El campus no corresponde a tu coordinación.');
        const topic = data.topic == null || data.topic === '' ? '' : text(data.topic, 'tema', 500);
        const subject = { id: subjectSnap.id, name: subjectSnap.data().name || subjectSnap.id, area: subjectSnap.data().area || '' };
        const request = {
            creatorKey: who.key, studentKey, studentEmail: email, studentName: student?.name || email,
            campus, subject, topic, status: 'open', closeReason: null,
            assignedMaeKey: null, assignedMaeName: null, assignedLocation: null,
            assignmentVersion: 0, activeOfferCount: 0, advisoryId: null,
            createdAt: stamp(), updatedAt: stamp(), broadenedAt: null
        };
        const [all, coordis] = await Promise.all([eligible(request), coordinators(campus)]);
        const matching = all.filter(doc => matchesSubject(doc.data(), request));
        request.broadcastMode = matching.length ? 'subject' : 'all';
        request.broadenAt = Timestamp.fromMillis(now() + 5 * 60 * 1000);
        const ref = requests.doc(crypto.createHash('sha256').update(`${who.key}:${operationId}`).digest('hex'));
        await db.runTransaction(async tx => {
            if ((await tx.get(ref)).exists) return;
            tx.create(ref, request);
            event(tx, ref, 'created', 'request_created', [...participants(request), ...coordis], 'Solicitud publicada', `Se busca asesoría de ${subject.name}.`);
            event(tx, ref, 'broadcast-0', 'help_requested', (matching.length ? matching : all).map(doc => doc.id), '¿Puedes apoyar?', `Se busca asesoría de ${subject.name}${topic ? `: ${topic}` : ''}.`);
        });
        return { requestId: ref.id };
    }
    async function offerAdvisoryHelp(data, context) {
        const who = await actor(context);
        const ref = requests.doc(id(data.requestId));
        const location = text(data.location, 'mesa o ubicación', 200);
        const initial = await ref.get();
        if (!initial.exists) fail('not-found', 'Solicitud no encontrada.');
        const coordis = await coordinators(initial.data().campus);
        await db.runTransaction(async tx => {
            const request = await readRequest(tx, ref);
            requireOpen(request);
            const [profile, previous] = await Promise.all([tx.get(db.collection('users').doc(who.key)), tx.get(ref.collection('offers').doc(who.key))]);
            const user = profile.data();
            if (!profile.exists) fail('failed-precondition', 'Tu perfil ya no esta disponible.');
            if (who.key === request.studentKey || !isActiveMae(user, now()) || user.campus !== request.campus ||
                (request.broadcastMode === 'subject' && !matchesSubject(user, request))) fail('permission-denied', 'Este aviso no está disponible para tu turno.');
            const old = previous.data();
            const alreadyActive = old?.status === 'active' && old.assignmentVersion === request.assignmentVersion;
            tx.set(ref.collection('offers').doc(who.key), {
                maeKey: who.key, name: user.name || who.key, location, status: 'active',
                assignmentVersion: request.assignmentVersion, createdAt: old?.createdAt || stamp(), updatedAt: stamp()
            });
            tx.update(ref, { activeOfferCount: request.activeOfferCount + (alreadyActive ? 0 : 1), updatedAt: stamp() });
            if (!alreadyActive) event(tx, ref, `offer-${request.assignmentVersion}-${who.key}-${now()}`, 'help_offered', [...participants(request), ...coordis],
                'Un MAE puede apoyar', `${user.name || who.key} ofrece asesoría de ${request.subject.name}.`);
        });
        return { requestId: ref.id };
    }
    async function withdrawAdvisoryOffer(data, context) {
        const who = await actor(context);
        const ref = requests.doc(id(data.requestId));
        await db.runTransaction(async tx => {
            const request = await readRequest(tx, ref);
            requireOpen(request);
            const offerRef = ref.collection('offers').doc(who.key);
            const offer = await tx.get(offerRef);
            if (!offer.exists || offer.data().status !== 'active' || offer.data().assignmentVersion !== request.assignmentVersion) return;
            tx.update(offerRef, { status: 'withdrawn', updatedAt: stamp() });
            tx.update(ref, { activeOfferCount: Math.max(0, request.activeOfferCount - 1), updatedAt: stamp() });
        });
        return { requestId: ref.id };
    }
    async function assignAdvisoryRequest(data, context) {
        const who = await actor(context);
        const ref = requests.doc(id(data.requestId));
        const maeKey = text(data.maeKey, 'maeKey', 128).toLowerCase();
        if (!/^[a-z0-9._%+-]+$/.test(maeKey)) fail('invalid-argument', 'maeKey no es valido.');
        await db.runTransaction(async tx => {
            const request = await readRequest(tx, ref);
            requireManage(who, request);
            if (request.status === 'assigned' && request.assignedMaeKey === maeKey) return;
            requireOpen(request);
            const [offerSnap, profile, offersSnap] = await Promise.all([
                tx.get(ref.collection('offers').doc(maeKey)), tx.get(db.collection('users').doc(maeKey)),
                tx.get(ref.collection('offers').where('assignmentVersion', '==', request.assignmentVersion).where('status', '==', 'active'))
            ]);
            const offer = offerSnap.data();
            if (!offer || offer.status !== 'active' || offer.assignmentVersion !== request.assignmentVersion ||
                !isActiveMae(profile.data(), now()) || profile.data().campus !== request.campus) fail('failed-precondition', 'La oferta ya no está disponible.');
            tx.update(ref, { status: 'assigned', assignedMaeKey: maeKey, assignedMaeName: offer.name, assignedLocation: offer.location, updatedAt: stamp() });
            event(tx, ref, `assigned-${request.assignmentVersion}`, 'request_assigned', [...participants(request), maeKey], 'Asesoría asignada', `${offer.name} te espera en ${offer.location}.`);
            const others = offersSnap.docs.map(doc => doc.id).filter(key => key !== maeKey);
            if (others.length) event(tx, ref, `not-selected-${request.assignmentVersion}`, 'offer_not_selected', others,
                'Ya se asignó otro MAE', `La solicitud de ${request.subject.name} ya tiene asesor. ¡Gracias por ofrecerte!`, request.assignmentVersion);
        });
        return { requestId: ref.id };
    }
    async function unassignAdvisoryRequest(data, context) {
        const who = await actor(context);
        const ref = requests.doc(id(data.requestId));
        await db.runTransaction(async tx => {
            const request = await readRequest(tx, ref);
            requireManage(who, request);
            if (request.status === 'open') return;
            if (request.status !== 'assigned') fail('failed-precondition', 'No hay una asignación que retirar.');
            // El scheduler creará el siguiente broadcast a partir de needsBroadcast, sin re-avisar al MAE retirado.
            tx.update(ref, {
                status: 'open', assignedMaeKey: null, assignedMaeName: null, assignedLocation: null,
                assignmentVersion: request.assignmentVersion + 1, activeOfferCount: 0, broadcastMode: 'all',
                lastUnassignedMaeKey: request.assignedMaeKey || null, needsBroadcast: true,
                broadenAt: stamp(), broadenedAt: stamp(), updatedAt: stamp()
            });
            event(tx, ref, `unassigned-${request.assignmentVersion}`, 'request_unassigned', participants(request), 'Se busca otro asesor', `La solicitud de ${request.subject.name} vuelve a estar abierta.`);
        });
        return { requestId: ref.id };
    }
    async function closeAdvisoryRequest(data, context) {
        const who = await actor(context);
        if (!['not_held', 'missing_registration'].includes(data.reason)) fail('invalid-argument', 'Motivo de cierre inválido.');
        const ref = requests.doc(id(data.requestId));
        await db.runTransaction(async tx => {
            const request = await readRequest(tx, ref);
            requireManage(who, request);
            if (request.status === 'closed' && request.closeReason === data.reason) return;
            if (!['open', 'assigned'].includes(request.status) || (data.reason === 'missing_registration' && !request.assignedMaeKey)) fail('failed-precondition', 'El cierre no corresponde al estado de la solicitud.');
            tx.update(ref, { status: 'closed', closeReason: data.reason, updatedAt: stamp(), closedAt: stamp() });
            event(tx, ref, `closed-${request.assignmentVersion}`, 'request_closed', participants(request), 'Solicitud cerrada',
                data.reason === 'not_held' ? 'La asesoría no se realizó.' : 'La asesoría está pendiente de registro.');
        });
        return { requestId: ref.id };
    }
    function profileInfo(user, key, isStudent = false) {
        const info = { uid: key, name: user.name || key, career: user.career || '', profilePictureUrl: user.photoURL || user.profilePictureUrl || '', area: user.area || '', campus: user.campus || '' };
        if (isStudent) info.role = user.role || 'user';
        return info;
    }
    async function registerRequestedAdvisory(data, context) {
        const who = await actor(context);
        const ref = requests.doc(id(data.requestId));
        const advisoryRef = db.collection('asesorias').doc(`request_${ref.id}`);
        const rating = data.rating == null ? null : data.rating;
        if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) fail('invalid-argument', 'La evaluación debe estar entre 1 y 5.');
        const comment = data.comment == null || data.comment === '' ? '' : text(data.comment, 'comentario', 2000);
        // El historial se lee fuera de la transacción para no bloquear todas las asesorías del MAE.
        const first = await ref.get();
        if (!first.exists) fail('not-found', 'Solicitud no encontrada.');
        const seen = first.data();
        if (seen.studentKey !== who.key) fail('permission-denied', 'Solo el estudiante puede registrar esta asesoría.');
        if (seen.status === 'registered' && seen.advisoryId === advisoryRef.id) return { requestId: ref.id, advisoryId: advisoryRef.id };
        if (!seen.assignedMaeKey) fail('failed-precondition', 'La asignación cambió o no permite registro.');
        const historySnap = await db.collection('asesorias').where('peerInfo.uid', '==', seen.assignedMaeKey).get();
        const timestamp = now();
        await db.runTransaction(async tx => {
            const request = await readRequest(tx, ref);
            if (request.studentKey !== who.key) fail('permission-denied', 'Solo el estudiante puede registrar esta asesoría.');
            if (request.status === 'registered' && request.advisoryId === advisoryRef.id) return;
            if (request.assignedMaeKey !== seen.assignedMaeKey) fail('aborted', 'La asignación cambió, intenta de nuevo.');
            if (data.assignmentVersion !== request.assignmentVersion || !request.assignedMaeKey ||
                !(request.status === 'assigned' || (request.status === 'closed' && request.closeReason === 'missing_registration'))) fail('failed-precondition', 'La asignación cambió o no permite registro.');
            const peerRef = db.collection('users').doc(request.assignedMaeKey);
            const [peerSnap, studentSnap, existing] = await Promise.all([
                tx.get(peerRef), tx.get(db.collection('users').doc(who.key)), tx.get(advisoryRef)
            ]);
            if (!peerSnap.exists || !studentSnap.exists) fail('failed-precondition', 'No se encontraron los perfiles.');
            if (existing.exists) fail('failed-precondition', 'El registro ya existe y requiere revisión.');
            const history = historySnap.docs.map(doc => doc.data()).filter(item => item._test !== true && !item._type);
            const previous = history.filter(item => item.userInfo?.uid === who.key && millis(item.date) <= timestamp);
            const points = advisoryPoints(previous, timestamp);
            const peer = peerSnap.data();
            const updates = { points: Math.max(0, round((Number(peer.points) || 0) + points.pointsAwarded)) };
            {
                const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', year: 'numeric', month: 'numeric' }).formatToParts(new Date(timestamp));
                const year = Number(parts.find(part => part.type === 'year').value);
                const month = Number(parts.find(part => part.type === 'month').value);
                const start = Date.UTC(year, month <= 6 ? 0 : 6, 1, 6);
                const end = Date.UTC(year, month <= 6 ? 6 : 12, 1, 6);
                const ratings = history.filter(item => item.rating != null && item.duplicate !== true && millis(item.date) >= start && millis(item.date) < end).map(item => item.rating);
                updates.ratingBonusPoints = ratingBonus(rating === null ? ratings : [...ratings, rating]);
                updates.points = Math.max(0, round(updates.points + updates.ratingBonusPoints - (Number(peer.ratingBonusPoints) || 0)));
            }
            tx.create(advisoryRef, {
                requestId: ref.id, assignmentVersion: request.assignmentVersion,
                peerInfo: profileInfo(peer, request.assignedMaeKey), userInfo: profileInfo(studentSnap.data(), who.key, true),
                subject: request.subject, rating, comment, date: stamp(), duplicate: false,
                ...points, pointsSubjectId: request.subject.id, pointsAwardedAt: stamp()
            });
            tx.update(peerRef, updates);
            tx.update(ref, { status: 'registered', advisoryId: advisoryRef.id, registeredAt: stamp(), updatedAt: stamp() });
            event(tx, ref, 'registered', 'advisory_registered', participants(request), 'Asesoría registrada', `El estudiante registró su asesoría de ${request.subject.name}.`);
        });
        return { requestId: ref.id, advisoryId: advisoryRef.id };
    }
    async function dispatchEvent(snapshot) {
        const value = snapshot.data();
        const requestRef = requests.doc(value.requestId);
        // Bounded chunks; each recipient is a transaction so retries never reset readAt.
        const keys = [...new Set(value.recipientKeys || [])];
        for (let offset = 0; offset < keys.length; offset += 20) {
            await Promise.all(keys.slice(offset, offset + 20).map(key => db.runTransaction(async tx => {
                const notificationId = value.type === 'help_requested' ? `${value.requestId}_help-${value.generation || 0}` : `${value.requestId}_${snapshot.id}`;
                const notificationRef = db.collection('advisoryNotifications').doc(key).collection('items').doc(notificationId);
                const existing = await tx.get(notificationRef);
                if (existing.exists) return;
                tx.set(requestRef.collection('recipients').doc(key), { userKey: key, createdAt: value.createdAt }, { merge: true });
                tx.create(notificationRef, {
                    requestId: value.requestId, eventId: snapshot.id, type: value.type,
                    title: value.title, body: value.body, createdAt: value.createdAt, readAt: null
                });
            })));
        }
    }
    async function broadenOne(ref) {
        const before = await ref.get();
        if (!before.exists || before.data().status !== 'open') return;
        const all = await eligible(before.data());
        await db.runTransaction(async tx => {
            const request = await readRequest(tx, ref);
            if (request.status !== 'open') return;
            const widen = request.broadcastMode === 'subject' && millis(request.broadenAt) <= now() && request.activeOfferCount === 0;
            if (!widen && !request.needsBroadcast) return;
            tx.update(ref, { broadcastMode: 'all', broadenedAt: stamp(), needsBroadcast: false, updatedAt: stamp() });
            event(tx, ref, `expanded-${request.assignmentVersion}`, 'help_requested',
                all.filter(doc => doc.id !== request.lastUnassignedMaeKey && (!widen || !matchesSubject(doc.data(), request))).map(doc => doc.id),
                '¿Puedes apoyar?', `Se busca asesoría de ${request.subject.name}${request.topic ? `: ${request.topic}` : ''}.`, request.assignmentVersion);
        });
    }
    async function broadenPending() {
        // Page through open requests instead of loading historical data.
        let cursor = null;
        const open = [], broadened = new Set();
        do {
            let query = requests.where('status', '==', 'open').orderBy('__name__').limit(100);
            if (cursor) query = query.startAfter(cursor);
            const snap = await query.get();
            const due = snap.docs.filter(doc => doc.data().needsBroadcast ||
                (doc.data().broadcastMode === 'subject' && millis(doc.data().broadenAt) <= now() && doc.data().activeOfferCount === 0));
            for (let offset = 0; offset < due.length; offset += 10) {
                await Promise.all(due.slice(offset, offset + 10).map(doc => broadenOne(doc.ref)));
            }
            due.forEach(doc => broadened.add(doc.id));
            open.push(...snap.docs);
            cursor = snap.size === 100 ? snap.docs[snap.docs.length - 1] : null;
        } while (cursor);
        if (!open.length) return;
        await notifyLateTurns(open.filter(doc => !broadened.has(doc.id)));
    }
    // MAEs que inician turno con solicitudes abiertas: un solo evento por solicitud con los nuevos destinatarios.
    async function notifyLateTurns(open) {
        const byCampus = new Map();
        for (const doc of open) byCampus.set(doc.data().campus, [...(byCampus.get(doc.data().campus) || []), doc]);
        for (const [campus, docs] of byCampus) {
            // MAEs already on turn were covered by the create/broaden/unassign broadcasts;
            // only recent turn starts need checking, which keeps per-minute reads bounded.
            const maes = (await activeMaes(campus)).filter(doc => millis(doc.data().activeSession?.startTime) > now() - LATE_TURN_WINDOW_MS);
            if (!maes.length) continue;
            const byKey = new Map(maes.map(doc => [doc.id, doc.data()]));
            for (const doc of docs) {
                const request = doc.data();
                const pool = maes.filter(mae => mae.id !== request.studentKey && mae.id !== request.lastUnassignedMaeKey &&
                    (request.broadcastMode !== 'subject' || matchesSubject(mae.data(), request)));
                const notified = await Promise.all(pool.map(mae => db.collection('advisoryNotifications').doc(mae.id).collection('items').doc(`${doc.id}_help-${request.assignmentVersion}`).get()));
                const fresh = pool.filter((mae, index) => !notified[index].exists).map(mae => mae.id).slice(0, 200);
                if (!fresh.length) continue;
                await db.runTransaction(async tx => {
                    const current = await readRequest(tx, doc.ref);
                    if (current.status !== 'open' || current.assignmentVersion !== request.assignmentVersion) return;
                    const keys = fresh.filter(key => key !== current.lastUnassignedMaeKey && (current.broadcastMode !== 'subject' || matchesSubject(byKey.get(key), current)));
                    if (!keys.length) return;
                    event(tx, doc.ref, `turn-${current.assignmentVersion}-${now()}`, 'help_requested', keys,
                        '¿Puedes apoyar?', `Se busca asesoría de ${current.subject.name}${current.topic ? `: ${current.topic}` : ''}.`, current.assignmentVersion);
                });
            }
        }
    }
    return { createAdvisoryRequest, offerAdvisoryHelp, withdrawAdvisoryOffer, assignAdvisoryRequest, unassignAdvisoryRequest, closeAdvisoryRequest, registerRequestedAdvisory, dispatchEvent, broadenPending };
}

module.exports = { createAdvisoryService, normalizeEmail, userKeyFromEmail, isActiveMae, advisoryPoints, ratingBonus };
