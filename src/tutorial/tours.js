// Catálogo de recorridos guiados (driver.js). Datos y reglas puras, sin Firebase,
// para poder probarlos con node --test.
//
// - Recorrido del menú: se muestra solo la primera vez que alguien ve cada sección
//   del menú lateral. Si le suben el rol (user -> mae), solo ve las secciones nuevas.
// - Guía de página: se abre con el botón "?" de la barra superior.
//
// Lo que ya vio cada quien se guarda en users/{matrícula}.tutorials como
// { 'menu-mae': 1, ... }. Subir TUTORIAL_VERSION vuelve a mostrar todo.

export const TUTORIAL_VERSION = 1;

const ALL = null; // sección visible para cualquier rol
const TECH_ADMIN = ['admin', 'tec'];
const MAE_ROLES = ['admin', 'tec', 'coordi', 'subjectCoordi', 'mae', 'publi'];
const COORDI_ROLES = ['admin', 'tec', 'coordi', 'subjectCoordi'];
const MANAGER_ROLES = ['admin', 'tec', 'coordi']; // Maeteca y asistencia

// Mismo orden que buildMenuForRole (src/auth/roles.js).
export const MENU_SECTIONS = [
    {
        key: 'menu-estudiante',
        label: 'Estudiante',
        roles: ALL,
        intro: 'Lo que cualquier estudiante puede usar.',
        items: [
            { to: '/inicio', title: 'Inicio', text: 'Accesos rápidos para solicitar, registrar o evaluar una asesoría, y los anuncios del momento.' },
            { to: '/maesactivos', title: 'Maes activos', text: 'Qué MAEs están en turno ahora y dónde encontrarlos.' },
            { to: '/solicitudes', title: 'Solicitudes de asesoría', text: 'Pide ayuda en una materia y da seguimiento: aquí ves qué MAE puede apoyarte.' },
            { to: '/horarios', title: 'Horarios', text: 'El horario de cada MAE por materia, para planear cuándo ir.' },
            { to: '/asesoriasGrupales', title: 'Asesorías grupales', text: 'Sesiones para varios estudiantes; puedes pre-registrarte.' },
            { to: '/maeteca', title: 'Maeteca', text: 'Videos, PDFs y kahoots para repasar por tu cuenta.' }
        ]
    },
    {
        key: 'menu-admin',
        label: 'Administrador',
        roles: TECH_ADMIN,
        intro: 'Herramientas para administrar la plataforma.',
        items: [
            { to: '/admin/usuarios', title: 'Usuarios', text: 'Todos los usuarios: rol, asesorías, horas, horario y materias. Se puede exportar a Excel.' },
            { to: '/admin/materias', title: 'Materias', text: 'El catálogo de materias que se ofrecen.' },
            { to: '/admin/sugerencias', title: 'Sugerencias', text: 'Las ideas y fallos que mandan los usuarios, con su issue de GitHub. Aquí les cambias el estado.' },
            { to: '/admin/asesorias', title: 'Asesorías', text: 'Todas las asesorías registradas.', roles: ['admin'] },
            { to: '/admin/funciones', title: 'Funciones', text: 'Tareas de mantenimiento del sistema. Úsalas con cuidado.', roles: ['admin'] },
            { to: '/admin/dashboard', title: 'Dashboard', text: 'Indicadores generales de uso.', roles: ['admin'] },
            { to: '/admin/historialAsistencia', title: 'Historial asistencia', text: 'La asistencia de los MAEs por fecha.', roles: ['admin'] }
        ]
    },
    {
        key: 'menu-mae',
        label: 'MAE',
        roles: MAE_ROLES,
        intro: 'Lo que usas como MAE.',
        items: [
            { tour: 'menu:/mae', title: 'Mi perfil', text: 'Tu foto, horario y materias. Tenlos al día para que te encuentren.' },
            { to: '/leaderboard', title: 'Leaderboard', text: 'La tabla de puntos entre MAEs.' },
            { to: '/misasesorias', title: 'Mis asesorías', text: 'Las asesorías que has dado; puedes filtrarlas por materia, fecha o evaluación.' },
            { to: '/misevaluaciones', title: 'Mis evaluaciones', text: 'Lo que opinan los estudiantes de tus asesorías.' },
            { to: '/asistenciaGrupales', title: 'Asistencia grupales', text: 'Pasa lista en las asesorías grupales.' }
        ]
    },
    {
        key: 'menu-coordi',
        label: 'Coordi',
        roles: COORDI_ROLES,
        intro: 'Herramientas de coordinación.',
        items: [
            { to: '/coordi', title: 'Asistencia', text: 'La asistencia de los MAEs; aquí repones asistencias y agregas horas.' },
            { to: '/gestionAnuncios', title: 'Gestión de anuncios', text: 'Crea los anuncios y asesorías grupales que aparecen en Inicio.' }
        ]
    },
    {
        key: 'menu-publi',
        label: 'Publicidad',
        roles: ['publi'],
        intro: 'Tu espacio para difundir.',
        items: [
            { to: '/gestionAnuncios', title: 'Gestión de anuncios', text: 'Crea los anuncios que aparecen en Inicio.' }
        ]
    }
];

function allows(roles, role) {
    return roles === ALL || roles.includes(role);
}

export const menuSelector = (item) => `[data-tour="${item.tour ?? `menu:${item.to}`}"]`;

// Secciones del menú que le tocan a un rol.
export function sectionsForRole(role) {
    return MENU_SECTIONS.filter((s) => allows(s.roles, role ?? 'user'));
}

// Secciones que todavía no ha visto (según users/{id}.tutorials).
export function pendingMenuKeys(role, seen = {}) {
    const record = seen && typeof seen === 'object' ? seen : {};
    return sectionsForRole(role)
        .map((s) => s.key)
        .filter((key) => Number(record[key] ?? 0) < TUTORIAL_VERSION);
}

// Pasos del recorrido del menú. Con { keys } solo esas secciones; sin keys, todas las del rol.
export function buildMenuSteps(role, { keys = null, firstName = '' } = {}) {
    const effectiveRole = role ?? 'user';
    const sections = sectionsForRole(effectiveRole).filter((s) => !keys || keys.includes(s.key));
    if (!sections.length) return [];

    const firstTime = !keys || sections.some((s) => s.key === 'menu-estudiante');
    const name = String(firstName ?? '').trim();
    const greeting = name ? `¡Hola, ${name}!` : '¡Hola!';
    const steps = [
        {
            popover: firstTime
                ? { title: `${greeting} Te enseñamos MAE`, description: 'Un recorrido rápido por el menú. Puedes saltarlo cuando quieras y repetirlo desde el botón ? de arriba.' }
                : { title: `${greeting} Tienes funciones nuevas`, description: `Ahora puedes usar: ${sections.map((s) => s.label).join(', ')}. Te las enseñamos.` }
        }
    ];

    for (const section of sections) {
        const items = section.items.filter((item) => !item.roles || item.roles.includes(effectiveRole));
        items.forEach((item, index) => {
            steps.push({
                element: menuSelector(item),
                popover: {
                    title: index === 0 ? `${section.label} · ${item.title}` : item.title,
                    description: index === 0 ? `${section.intro} ${item.text}` : item.text,
                    side: 'right',
                    align: 'start'
                }
            });
        });
    }

    steps.push({
        element: '[data-tour="feedback-button"]',
        popover: {
            title: '¿Una idea o algo falla?',
            description: 'Escríbenos desde aquí. Lo leemos y nos ayuda a mejorar MAE.',
            side: 'bottom',
            align: 'end'
        }
    });
    steps.push({
        element: '[data-tour="tutorial-button"]',
        popover: {
            title: '¿Dudas en una página?',
            description: 'Toca este botón para ver la guía de la página en la que estés o repetir este recorrido.',
            side: 'bottom',
            align: 'end'
        }
    });
    return steps;
}

// Guías por página (nombre de la ruta). Cada paso puede limitarse a ciertos roles;
// los pasos cuyo elemento no está en pantalla se omiten al abrir la guía.
export const PAGE_TOURS = {
    inicio: {
        title: 'Inicio',
        steps: [
            { element: '[data-tour="inicio-solicitar"]', title: 'Solicitar asesoría', text: 'Publica que necesitas ayuda en una materia; los MAEs en turno te ven y te ofrecen apoyo.' },
            { element: '[data-tour="inicio-registrar"]', title: 'Registrar asesoría', text: 'Si ya te atendió un MAE, registra la asesoría eligiendo al MAE y la materia.' },
            { element: '[data-tour="inicio-evaluar"]', title: 'Evaluar asesoría', text: 'Califica cómo te fue. Ayuda a mejorar y suma puntos al MAE.' },
            { element: '[data-tour="inicio-turno"]', title: 'Tu turno', text: 'Inicia tu turno al llegar (con tu ubicación) y finalízalo al irte; así cuentan tus horas.', roles: MAE_ROLES },
            { element: '[data-tour="inicio-anuncios"]', title: 'Anuncios', text: 'Avisos y asesorías grupales. Usa las flechas para ver más.' }
        ]
    },
    solicitudAsesoria: {
        title: 'Solicitudes de asesoría',
        steps: [
            { element: '[data-tour="solicitudes-nueva"]', title: 'Nueva solicitud', text: 'Elige la materia y describe el tema. Los MAEs en turno de tu campus reciben el aviso.' },
            { element: '[data-tour="solicitudes-mias"]', title: 'Mis solicitudes', text: 'Tus solicitudes. Ábrelas para ver qué MAE puede apoyarte y dónde está.' },
            { element: '[data-tour="solicitudes-avisos"]', title: 'Avisos recibidos', text: 'Como MAE, aquí llegan las solicitudes de tu campus. Ofrece apoyo indicando dónde estás.', roles: MAE_ROLES },
            { element: '[data-tour="solicitudes-campus"]', title: 'Mi campus', text: 'Como coordi ves todas las solicitudes del campus y puedes elegir al MAE que atiende.', roles: COORDI_ROLES }
        ]
    },
    maeteca: {
        title: 'Maeteca',
        steps: [
            { element: '[data-tour="maeteca-principal"]', title: 'Recurso principal', text: 'Aquí se reproduce el video, PDF o kahoot que elijas.' },
            { element: '[data-tour="maeteca-buscar"]', title: 'Buscar y filtrar', text: 'Busca por nombre o descripción y filtra por tipo de recurso.' },
            { element: '[data-tour="maeteca-tarjetas"]', title: 'Recursos', text: 'Toca una tarjeta para abrirla arriba.' },
            { element: '[data-tour="maeteca-agregar"]', title: 'Agregar recurso', text: 'Sube un video de YouTube, un PDF o un kahoot, con su materia, carrera y etiquetas.', roles: MANAGER_ROLES },
            { element: '[data-tour="maeteca-masa"]', title: 'Carga en masa', text: 'Sube muchos videos a la vez con la plantilla de Excel.', roles: MANAGER_ROLES }
        ]
    },
    misasesorias: {
        title: 'Mis asesorías',
        steps: [
            { element: '[data-tour="asesorias-filtros"]', title: 'Filtros', text: 'Filtra tus asesorías por materia, fecha o evaluación. La flecha junto al título quita los filtros.' },
            { element: '[data-tour="asesorias-lista"]', title: 'Tus asesorías', text: 'Cada tarjeta es una asesoría que diste, con su evaluación.' }
        ]
    },
    coordi: {
        title: 'Asistencia',
        steps: [
            { element: '[data-tour="coordi-reponer"]', title: 'Reponer asistencia', text: 'Corrige la asistencia de un MAE en una fecha pasada.' },
            { element: '[data-tour="coordi-horas"]', title: 'Agregar horas', text: 'Suma horas o registra una sesión a un MAE con su matrícula.' },
            { element: '[data-tour="coordi-tabla"]', title: 'MAEs', text: 'La asistencia de cada MAE. Toca la matrícula para ver su perfil.' }
        ]
    },
    // Solo admin/tec: la página y sus datos (quién envió, issues de GitHub) son de administración.
    adminsugerencias: {
        title: 'Sugerencias',
        roles: TECH_ADMIN,
        steps: [
            { element: '[data-tour="sugerencias-filtros"]', title: 'Filtros', text: 'Elige sugerencias o fallos y el estado. Por defecto ves solo las pendientes (nuevo y en revisión).' },
            { element: '[data-tour="sugerencias-tabla"]', title: 'Mensajes', text: 'Cada fila es un envío. La flecha de la izquierda muestra el texto completo y quién lo mandó (nombre y correo, que no salen en GitHub).' },
            { element: '[data-tour="sugerencias-github"]', title: 'Issue en GitHub', text: 'Liga al issue público que se abrió, sin datos personales. Si sale un ícono naranja, no se pudo abrir: pasa el mouse para ver por qué (por ejemplo, token vencido).' },
            { element: '[data-tour="sugerencias-estado"]', title: 'Estado', text: 'Márcalo en revisión, hecho o descartado. Se guarda al momento y queda quién lo cambió.' }
        ]
    },
    adminusuarios: {
        title: 'Usuarios',
        steps: [
            { element: '[data-tour="usuarios-exportar"]', title: 'Exportar a Excel', text: 'Descarga la lista completa de usuarios.' },
            { element: '[data-tour="usuarios-tabla"]', title: 'Usuarios', text: 'Filtra por matrícula o nombre, ordena por asesorías u horas y cambia el rol de cada quien.' }
        ]
    }
};

export function hasPageTour(routeName) {
    return Object.prototype.hasOwnProperty.call(PAGE_TOURS, routeName ?? '');
}

// Pasos de la guía de una página para un rol (sin revisar todavía si existen en pantalla).
export function buildPageSteps(routeName, role) {
    if (!hasPageTour(routeName)) return [];
    const effectiveRole = role ?? 'user';
    const tour = PAGE_TOURS[routeName];
    if (tour.roles && !tour.roles.includes(effectiveRole)) return [];
    return tour.steps
        .filter((step) => !step.roles || step.roles.includes(effectiveRole))
        .map((step) => ({
            element: step.element,
            popover: { title: step.title, description: step.text, side: 'bottom', align: 'start' }
        }));
}

// Campos a escribir en users/{id} para marcar secciones como vistas.
export function seenUpdate(keys) {
    const update = {};
    for (const key of keys ?? []) update[`tutorials.${key}`] = TUTORIAL_VERSION;
    return update;
}
