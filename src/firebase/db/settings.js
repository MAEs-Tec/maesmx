import { firestoreDB } from "../../main";
import { collection, addDoc, query, where, getDocs, Timestamp, orderBy, limit } from 'firebase/firestore';

export async function getEvaluationsRevealedAt() {
    try {
        const q = query(
            collection(firestoreDB, "asesorias"),
            where("_type", "==", "reveal_config")
        );
        const snap = await getDocs(q);
        if (snap.empty) return null;

        let latest = null;
        snap.docs.forEach(doc => {
            const ts = doc.data().evaluationsRevealedAt;
            if (ts && (!latest || ts.seconds > latest.seconds)) {
                latest = ts;
            }
        });
        return latest;
    } catch (error) {
        console.error("Error fetching settings:", error);
        return null;
    }
}

export async function revelarEvaluaciones() {
    await addDoc(collection(firestoreDB, "asesorias"), {
        _type: "reveal_config",
        evaluationsRevealedAt: Timestamp.now()
    });
}

export async function getEvaluationsClearedAt() {
    try {
        const q = query(
            collection(firestoreDB, "asesorias"),
            where("_type", "==", "evaluations_cleared_config")
        );
        const snap = await getDocs(q);
        if (snap.empty) return null;

        let latest = null;
        snap.docs.forEach(doc => {
            const ts = doc.data().evaluationsClearedAt;
            if (ts && (!latest || ts.seconds > latest.seconds)) {
                latest = ts;
            }
        });
        return latest;
    } catch (error) {
        console.error("Error fetching evaluations cleared at:", error);
        return null;
    }
}

export async function borrarEvaluaciones() {
    await addDoc(collection(firestoreDB, "asesorias"), {
        _type: "evaluations_cleared_config",
        evaluationsClearedAt: Timestamp.now()
    });
}
