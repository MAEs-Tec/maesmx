// Sonido corto para avisos nuevos, generado con Web Audio (sin archivos).
// Solo suena con la página abierta y después de que la persona interactuó con ella:
// los navegadores bloquean el audio automático hasta entonces.

const STORAGE_KEY = 'maesmx:avisos-sonido';
let context = null;

function getContext() {
    if (context) return context;
    const AudioContextClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AudioContextClass) return null;
    try {
        context = new AudioContextClass();
    } catch {
        context = null;
    }
    return context;
}

export function isNotificationSoundOn() {
    try {
        return localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
        return true;
    }
}

export function setNotificationSoundOn(on) {
    try {
        localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
        // Sin almacenamiento la preferencia dura solo esta visita.
    }
}

// Se llama en la primera interacción para que el navegador permita el audio después.
export function unlockNotificationSound() {
    const ctx = getContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

// Escucha la primera interacción con la página para habilitar el audio. Devuelve cómo dejar de escuchar.
export function listenForSoundUnlock() {
    if (typeof window === 'undefined') return () => {};
    const options = { once: true, capture: true };
    window.addEventListener('pointerdown', unlockNotificationSound, options);
    window.addEventListener('keydown', unlockNotificationSound, options);
    return () => {
        window.removeEventListener('pointerdown', unlockNotificationSound, options);
        window.removeEventListener('keydown', unlockNotificationSound, options);
    };
}

// Dos tonos suaves y breves (~0.35 s).
export function playNotificationSound() {
    const ctx = getContext();
    if (!ctx) return;
    const play = () => {
        const start = ctx.currentTime + 0.01;
        [[880, 0], [1175, 0.14]].forEach(([frequency, offset]) => {
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, start + offset);
            gain.gain.exponentialRampToValueAtTime(0.12, start + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2);
            oscillator.connect(gain).connect(ctx.destination);
            oscillator.start(start + offset);
            oscillator.stop(start + offset + 0.22);
        });
    };
    if (ctx.state === 'suspended') ctx.resume().then(play).catch(() => {});
    else play();
}
