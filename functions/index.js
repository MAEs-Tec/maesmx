const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();


// Se ejecuta automáticamente el día 1 de cada mes a las 00:00
exports.cleanupExpiredAnnouncements = functions.pubsub.schedule('0 0 1 * *').timeZone('America/Mexico_City').onRun(async (context) => {
    try {
      const now = new Date();
      const announcementsRef = db.collection('announcements');
      
      // Buscar anuncios vencidos que aún están visibles
      // Filtramos por visible=true Y dateTime < ahora
      const query = announcementsRef
        .where('visible', '==', true)
        .where('dateTime', '<', admin.firestore.Timestamp.fromDate(now));
      
      const snapshot = await query.get();
      
      if (snapshot.empty) {
        console.log('No announcements to delete');
        return null;
      }
      //El batch es una escritura por lotes. Asi no son una por una 
      const batch = db.batch();
      let count = 0;
      
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        count++;
      });
      
      await batch.commit();
      
      console.log(`Successfully deleted ${count} expired announcements`);
      return null;
      
    } catch (error) {
      console.error('Error cleaning up announcements:', error);
      return null;
    }
});
