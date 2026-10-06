// Opt-in local diagnostics. Counts are estimates, never billing measurements.
const enabled = import.meta.env.VITE_COST_DIAGNOSTICS === 'true';
const counters = new Map();
export function recordCostOperation(name, { documents = 0, bytes = 0, durationMs = 0 } = {}) {
    if (!enabled) return;
    const previous = counters.get(name) || { requests: 0, documents: 0, bytes: 0, durationMs: 0 };
    counters.set(name, { requests: previous.requests + 1, documents: previous.documents + documents,
        bytes: previous.bytes + bytes, durationMs: previous.durationMs + durationMs });
}
export async function measuredRead(name, read) {
    const start = performance.now();
    const snapshot = await read();
    if (enabled) {
        const data = snapshot.docs ? snapshot.docs.map(doc => doc.data()) : snapshot.exists() ? snapshot.data() : null;
        recordCostOperation(name, { documents: snapshot.size ?? (snapshot.exists() ? 1 : 0),
            bytes: new TextEncoder().encode(JSON.stringify(data)).length, durationMs: performance.now() - start });
    }
    return snapshot;
}
if (enabled && typeof window !== 'undefined') {
    window.maesCostDiagnostics = { snapshot: () => Object.fromEntries(counters), reset: () => counters.clear() };
}
