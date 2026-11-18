// Convierte errores de Firebase en mensajes que un MAE o coordi pueda entender y reportar.
// Antes todo salia como "Consulta con un administrador" y no se podia saber que habia fallado.
export const getErrorDetail = (error, fallback = 'Intenta de nuevo en unos minutos.') => {
    switch (error?.code) {
        case 'permission-denied':
            return 'Firebase rechazó el cambio por falta de permisos. Avisa al equipo técnico (error: permission-denied).';
        case 'unavailable':
        case 'deadline-exceeded':
            return 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.';
        case 'unauthenticated':
            return 'Tu sesión expiró. Cierra sesión, vuelve a entrar e intenta de nuevo.';
        case 'not-found':
            return 'No se encontró el perfil del MAE en la base de datos. Avisa al equipo técnico.';
        default:
            return error?.userMessage ?? fallback;
    }
};

// Error con un mensaje pensado para mostrarse tal cual en el toast
export const createUserError = (userMessage, code) => {
    const error = new Error(userMessage);
    error.userMessage = userMessage;
    if (code) error.code = code;
    return error;
};
