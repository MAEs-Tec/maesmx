import { httpsCallable } from 'firebase/functions';
import { functions } from './client';
import { recordCostOperation } from './diagnostics';
const operations = new Map();
export function operationIdFor(key) {
    if (!operations.has(key)) operations.set(key, crypto.randomUUID());
    return operations.get(key);
}
export function completeOperation(key) { operations.delete(key); }
export async function callCostFunction(name, payload) {
    recordCostOperation(`functions:${name}`);
    const result = await httpsCallable(functions, name)(payload);
    return result.data;
}
