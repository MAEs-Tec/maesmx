// Guarda de deploy: firebase.json la ejecuta como "predeploy" de hosting,
// functions, firestore y storage. Aborta el deploy si no se lanza desde la
// rama permitida o si hay cambios sin commit en archivos rastreados.
//
// Es una guarda LOCAL (vive en el repo): evita descuidos, no es un control de
// acceso. Para saltarla a propósito: ALLOW_DEPLOY_ANY_BRANCH=1.
const { execSync } = require('child_process');

// Producción sale de master. El camino normal es el workflow de GitHub Actions
// (.github/workflows/deploy.yml); un deploy local es solo para emergencias.
const ALLOWED_BRANCH = 'master';

function git(args) {
    return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

function main() {
    if (process.env.ALLOW_DEPLOY_ANY_BRANCH === '1') {
        console.warn('[deploy] ALLOW_DEPLOY_ANY_BRANCH=1: se omite la guarda de rama.');
        return;
    }

    let branch;
    let dirty;
    try {
        // En GitHub Actions el checkout puede quedar en HEAD suelto; la rama real viene en GITHUB_REF_NAME.
        branch = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF_NAME
            ? process.env.GITHUB_REF_NAME
            : git('rev-parse --abbrev-ref HEAD');
        // .firebase/ es la caché que el propio CLI reescribe en cada deploy.
        dirty = git('status --porcelain --untracked-files=no -- . ":(exclude).firebase"');
    } catch (error) {
        console.error('[deploy] No se pudo leer el estado de git; deploy cancelado.');
        process.exit(1);
    }

    if (branch !== ALLOWED_BRANCH) {
        console.error(`[deploy] Cancelado: estás en "${branch}". Solo se despliega desde "${ALLOWED_BRANCH}".`);
        process.exit(1);
    }

    if (dirty) {
        console.error('[deploy] Cancelado: hay cambios sin commit en archivos rastreados:');
        console.error(dirty);
        process.exit(1);
    }

    console.log(`[deploy] Rama "${branch}" @ ${git('rev-parse --short HEAD')}, sin cambios pendientes.`);
}

main();
