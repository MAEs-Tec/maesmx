async function cleanupImage({ db, bucket, path }) {
    if (typeof path !== 'string' || !path.startsWith('announcements/') || path.includes('..')) return { removed: false };
    const migration = await db.doc('settings/analytics').get();
    if (!migration.data()?.imagePathsReady) return { removed: false, reason: 'migration-required' };
    const references = await db.collection('announcements').where('imagePath', '==', path).limit(1).get();
    if (!references.empty) return { removed: false, reason: 'referenced' };
    await bucket.file(path).delete({ ignoreNotFound: true });
    return { removed: true };
}
module.exports = { cleanupImage };
