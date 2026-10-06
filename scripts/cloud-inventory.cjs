// Read-only inventory using the account already authorized in Firebase CLI.
// Never prints access tokens, environment variables, or resource contents.
const path = require('node:path');
const fs = require('node:fs');
const root = process.env.FIREBASE_TOOLS_ROOT || path.join(process.env.APPDATA || '', 'npm/node_modules/firebase-tools/lib');
const auth = require(path.join(root, 'auth'));
async function main() {
    const account = auth.getGlobalDefaultAccount();
    if (!account) throw new Error('Sign in with firebase login first');
    const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
    const project = process.argv[2] || 'peer-teaching';
    const endpoints = {
        billing: `https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`,
        firestore: `https://firestore.googleapis.com/v1/projects/${project}/databases`,
        datasets: `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets`,
        scheduler: `https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/us-central1/jobs`,
        run: `https://run.googleapis.com/v2/projects/${project}/locations/us-central1/services`,
        buckets: `https://storage.googleapis.com/storage/v1/b?project=${project}`,
        artifacts: `https://artifactregistry.googleapis.com/v1/projects/${project}/locations/us-central1/repositories`
    };
    const inventory = {};
    for (const [service, url] of Object.entries(endpoints)) {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
        const data = await response.json();
        inventory[service] = response.ok ? data : { status: response.status, reason: data.error?.message };
        if (service === 'scheduler' && data.jobs) inventory[service] = data.jobs.map(({ name, schedule, state }) => ({ name, schedule, state }));
        if (service === 'run' && data.services) inventory[service] = data.services.map(({ name, uri }) => ({ name, uri }));
        if (service === 'buckets' && data.items) inventory[service] = data.items.map(({ name, location, storageClass }) => ({ name, location, storageClass }));
    }
    fs.mkdirSync('docs', { recursive: true });
    fs.writeFileSync('docs/cloud-inventory.json', JSON.stringify(inventory, null, 2));
    console.log(JSON.stringify(inventory, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
