const { createHash } = require('node:crypto');
const MAE_ROLES = ['admin', 'tec', 'coordi', 'subjectCoordi', 'publi', 'mae'];
const round = n => Math.round(Number(n || 0) * 100) / 100;
const hash = value => createHash('sha256').update(value).digest('hex');
function semester(date) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit' }).formatToParts(date);
    const year = parts.find(p => p.type === 'year').value;
    const month = Number(parts.find(p => p.type === 'month').value);
    return `${year}-${month < 7 ? '01' : '02'}`;
}
function real(a) { return a && a._test !== true && !a._type; }
function bonus(sum, count) { return count > 0 ? round(Math.max(20, Math.min(50, sum / count * 10))) : 0; }
function individualPoints(first, recent) { return (first ? 10 : 5) * (recent ? 0.5 : 1); }
function snapshotUser(user) {
    return { uid: user.uid || user.id, name: user.name || '', career: user.career || '',
        area: user.area || '', campus: user.campus || '', role: user.role || 'user', profilePictureUrl: user.photoURL || '' };
}
function contribution(a) {
    if (!real(a)) return null;
    const date = a.date?.toDate ? a.date.toDate() : new Date(a.date);
    const validDate = !Number.isNaN(date.getTime());
    return { semester: validDate ? semester(date) : 'undated', uid: a.userInfo?.uid, peer: a.peerInfo?.uid,
        area: a.subject?.area, campus: a.userInfo?.campus, countable: a.duplicate !== true,
        rating: a.rating != null && Number.isFinite(Number(a.rating)) ? Number(a.rating) : null };
}
function badgeUpdates(user, count) {
    const earned = new Set();
    [1, 10, 30, 50, 100, 200, 500].forEach((threshold, i) => { if (count >= threshold) earned.add(String(i + 1)); });
    if (user.photoURL) earned.add('8');
    if (Number(user.totalTime) >= 4800) earned.add('9');
    if (user.role === 'mae' || count > 0) earned.add('12');
    if (['admin', 'tec', 'coordi'].includes(user.role)) earned.add('13');
    if (['admin', 'tec'].includes(user.role)) earned.add('14');
    if (user.role === 'publi') earned.add('15');
    return (user.badges || []).map(b => earned.has(String(b.id)) ? { ...b, achieved: true } : b);
}
// Return staged writes so the caller can finish *all* reads before committing.
async function projectChange(tx, db, version, before, after, updatedAt) {
    const summaries = new Map(); const memberships = new Map(); const peers = new Map();
    for (const [record, sign] of [[before, -1], [after, 1]]) {
        const c = contribution(record); if (!c) continue;
        for (const scope of ['all', c.semester]) {
            if (!summaries.has(scope)) summaries.set(scope, { total: 0, groups: new Map() });
            const summary = summaries.get(scope); summary.total += sign;
            const groups = [['users', 'all', c.uid]];
            if (c.area && c.uid) groups.push(['areas', c.area, c.uid]);
            if (c.campus) groups.push(['campuses', c.campus, c.uid]);
            for (const [type, label, uid] of groups) {
                const groupKey = `${type}:${hash(String(label))}`;
                if (!summary.groups.has(groupKey)) summary.groups.set(groupKey, { type, label, total: 0 });
                if (type !== 'users') summary.groups.get(groupKey).total += sign;
                if (uid) {
                    const memberId = hash(JSON.stringify([scope, type, label, uid]));
                    const m = memberships.get(memberId) || { scope, groupKey, count: 0 };
                    m.count += sign; memberships.set(memberId, m);
                }
            }
        }
        if (c.peer) {
            const key = `${c.semester}~${c.peer}`;
            const p = peers.get(key) || { uid: c.peer, semester: c.semester, count: 0, ratingCount: 0, ratingSum: 0 };
            if (c.countable) { p.count += sign; if (c.rating !== null) { p.ratingCount += sign; p.ratingSum += sign * c.rating; } }
            peers.set(key, p);
        }
    }
    const base = db.collection('analytics').doc(version);
    const writes = [];
    for (const [scope, delta] of summaries) {
        const ref = base.collection('summaries').doc(scope); const snap = await tx.get(ref);
        const value = snap.exists ? snap.data() : { totalAsesorias: 0, totalUniqueUsers: 0, areas: {}, campuses: {} };
        value.totalAsesorias += delta.total; value.updatedAt = updatedAt;
        for (const [key, group] of delta.groups) {
            if (group.type === 'users') continue;
            const id = key.split(':')[1]; value[group.type] ||= {};
            value[group.type][id] ||= { label: group.label, totalAsesorias: 0, totalUniqueUsers: 0 };
            value[group.type][id].totalAsesorias += group.total;
        }
        delta.value = value; writes.push([ref, value]);
    }
    for (const [id, delta] of memberships) {
        const ref = base.collection('members').doc(id); const snap = await tx.get(ref);
        const previous = snap.exists ? snap.data().count : 0; const next = previous + delta.count;
        if (next < 0) throw new Error('Statistics out of sync; rebuild before writing');
        const uniqueDelta = Number(next > 0) - Number(previous > 0);
        const [type, groupId] = delta.groupKey.split(':');
        const value = summaries.get(delta.scope).value;
        if (type === 'users') value.totalUniqueUsers += uniqueDelta;
        else value[type][groupId].totalUniqueUsers += uniqueDelta;
        if (delta.count !== 0) writes.push([ref, { count: next }]);
    }
    for (const [id, delta] of peers) {
        const ref = base.collection('peers').doc(id); const snap = await tx.get(ref);
        const old = snap.exists ? snap.data() : { count: 0, ratingCount: 0, ratingSum: 0 };
        const value = { uid: delta.uid, semester: delta.semester, count: old.count + delta.count,
            ratingCount: old.ratingCount + delta.ratingCount, ratingSum: round(old.ratingSum + delta.ratingSum), updatedAt };
        if (value.count < 0 || value.ratingCount < 0) throw new Error('Peer statistics out of sync');
        delta.value = value; writes.push([ref, value]);
        writes.push([base.collection('counts').doc(id), { uid: delta.uid, semester: delta.semester, count: value.count, updatedAt }]);
    }
    return { writes, peers };
}
module.exports = { hash, round, semester, real, bonus, individualPoints, snapshotUser, contribution, badgeUpdates, projectChange, MAE_ROLES };
