// Preview by default. --apply is only meaningful after reconciling the monthly amount.
const path = require('node:path');
const args = process.argv.slice(2);
const project = args.find(value => value.startsWith('--project='))?.slice(10);
const amount = Number(args.find(value => value.startsWith('--amount='))?.slice(9));
async function main() {
    if (!project || !Number.isFinite(amount) || amount <= 0) throw new Error('Required: --project=<id> --amount=<reconciled USD amount>');
    const auth = require(path.join(process.env.APPDATA || '', 'npm/node_modules/firebase-tools/lib/auth'));
    const account = auth.getGlobalDefaultAccount();
    if (!account) throw new Error('Firebase login required');
    const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
    const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };
    async function request(url, options = {}) {
        const response = await fetch(url, { headers, ...options }); const data = await response.json();
        if (!response.ok) throw new Error(`${response.status}: ${data.error?.message || 'Billing request failed'}`);
        return data;
    }
    const [billing, metadata] = await Promise.all([
        request(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`),
        request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`)
    ]);
    if (!billing.billingEnabled || !metadata.projectNumber) throw new Error('Project billing unavailable');
    const cents = Math.round(amount * 100);
    const body = { displayName: `MAEs ${project} monthly budget`, budgetFilter: { projects: [`projects/${metadata.projectNumber}`], calendarPeriod: 'MONTH' },
        amount: { specifiedAmount: { currencyCode: 'USD', units: String(Math.floor(cents / 100)), nanos: (cents % 100) * 10000000 } },
        thresholdRules: [0.5,0.8,1].map(thresholdPercent => ({ thresholdPercent, spendBasis: 'CURRENT_SPEND' })) };
    if (!args.includes('--apply')) { console.log(JSON.stringify({ preview: true, ...body },null,2)); return; }
    const url = `https://billingbudgets.googleapis.com/v1/${billing.billingAccountName}/budgets`;
    const existing = await request(url);
    const matches = (existing.budgets || []).filter(budget => budget.displayName === body.displayName);
    if (matches.length > 1 || existing.nextPageToken) throw new Error('Inspect budget pagination/duplicates before writing');
    if (matches.length) {
        // Preserve existing recipients and notification policy.
        await request(`https://billingbudgets.googleapis.com/v1/${matches[0].name}?updateMask=budgetFilter,amount,thresholdRules`, { method: 'PATCH', body: JSON.stringify(body) });
    } else await request(url, { method: 'POST', body: JSON.stringify(body) });
    console.log(JSON.stringify({ applied: true, project, monthlyUSD: cents/100, thresholds: [50,80,100], autoShutdown: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
