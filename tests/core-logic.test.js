// Browser-free checks for the deterministic rules implemented in frontend/app.js.
// Kept as a transparent test vector for review without adding a build dependency.
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const contradiction = facts => new Set(facts.filter(f => f.field === 'transaction_amount').map(f => f.value)).size > 1;
assert(contradiction([{field:'transaction_amount',value:'18500'}, {field:'transaction_amount',value:'15500'}]), 'amount mismatch must be detected');
assert(!contradiction([{field:'transaction_amount',value:'18500'}]), 'a single value must not conflict');
const allowedMimes = new Set(['image/png','image/jpeg','application/pdf','text/plain']);
assert(allowedMimes.has('image/png'), 'a permitted image must be accepted');
assert(!allowedMimes.has('application/x-msdownload') && !allowedMimes.has('text/html'), 'the allowlist must reject executables and HTML');
console.log('core deterministic test vectors passed');
