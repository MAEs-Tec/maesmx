const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

exports.cleanupExpiredAnnouncements = functions.https.onRequest(
  async (req, res) => {
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
        return res.status(200).json({
          success: true,
          message: 'No announcements to update',
          updated: 0,
          timestamp: new Date().toISOString()
        });
      }
      
      // Actualizar en las operaciones escritas
      // Si se llega a ocupar mas de 500 (que no creo la vdd) tendriamos que paginar
      const operation = db.batch();
      let count = 0;
      
      snapshot.docs.forEach(doc => {
        operation.update(doc.ref, { visible: false });
        count++;
      });
      
      await operation.commit();
      
      console.log(`Successfully cleaned up ${count} expired announcements`);
      
      return res.status(200).json({
        success: true,
        message: `Successfully updated ${count} announcements to visible: false`,
        updated: count,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Error cleaning up announcements:', error);
      return res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);
