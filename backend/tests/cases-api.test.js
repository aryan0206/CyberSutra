// backend/tests/cases-api.test.js
// Integration tests for the complete /api/cases lifecycle.
//
// Tests the full case lifecycle:
//   create → update description → upload evidence → add facts
//   → derive contradictions → resolve contradictions → confirm facts
//   → calculate readiness
//
// Also tests: case-token authorization, cross-case isolation,
// invalid transitions, and input validation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { createApp } from '../server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00]);
const PDF_BYTES = Buffer.from('%PDF-1.4 test content');
const TXT_BYTES = Buffer.from('Synthetic SMS evidence content');

function expectedHash(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function withServer(fn) {
  const uploadDir = await mkdtemp(join(tmpdir(), 'cybersutra-cases-'));
  try {
    const { app, service } = createApp({ uploadDir });
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    try {
      await fn({ base, service, port });
    } finally {
      server.close();
    }
  } finally {
    await rm(uploadDir, { recursive: true });
  }
}

/** Create a case and return { incident, caseToken }. */
async function createCase(base, description = 'Test case') {
  const res = await fetch(`${base}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  return { incident: body.incident, caseToken: body.caseToken };
}

/** Common headers for authenticated requests. */
function authHeaders(caseToken) {
  return {
    'Content-Type': 'application/json',
    'X-Case-Token': caseToken,
  };
}

/** Upload a file to a case. */
async function uploadFile(base, caseId, caseToken, buffer, filename, mimeType) {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  formData.append('file', blob, filename);
  return fetch(`${base}/api/cases/${caseId}/evidence`, {
    method: 'POST',
    headers: { 'X-Case-Token': caseToken },
    body: formData,
  });
}

// ===========================================================================
// CASE CREATION
// ===========================================================================

test('cases: create case returns id, caseToken, and empty state', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'KYC fraud incident');
    assert.ok(incident.id.startsWith('case_'));
    assert.ok(caseToken, 'caseToken must be returned');
    assert.equal(typeof caseToken, 'string');
    assert.equal(incident.description, 'KYC fraud incident');
    assert.deepEqual(incident.evidence, []);
    assert.deepEqual(incident.facts, []);
    assert.deepEqual(incident.events, []);
    assert.deepEqual(incident.contradictions, []);
    assert.equal(incident.submitted, false);
    // caseToken must NOT appear in the incident body
    assert.equal(incident.caseToken, undefined);
  });
});

test('cases: create case without description defaults to empty string', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.incident.description, '');
  });
});

// ===========================================================================
// CASE RETRIEVAL + AUTHORIZATION
// ===========================================================================

test('cases: GET case with valid token returns incident + readiness', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}`, {
      headers: authHeaders(caseToken),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.incident.id, incident.id);
    assert.ok(body.readiness);
    assert.equal(body.readiness.state, 'INCOMPLETE');
    // caseToken not leaked
    assert.equal(body.incident.caseToken, undefined);
  });
});

test('cases: GET case without token returns 403', async () => {
  await withServer(async ({ base }) => {
    const { incident } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });
});

test('cases: GET case with wrong token returns 403', async () => {
  await withServer(async ({ base }) => {
    const { incident } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}`, {
      headers: { 'X-Case-Token': 'wrong-token-value' },
    });
    assert.equal(res.status, 403);
  });
});

test('cases: GET nonexistent case returns 404', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/cases/case_nonexistent`, {
      headers: { 'X-Case-Token': 'whatever' },
    });
    assert.equal(res.status, 404);
  });
});

// ===========================================================================
// CASE UPDATE (PATCH)
// ===========================================================================

test('cases: PATCH description updates and returns readiness', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, '');
    const res = await fetch(`${base}/api/cases/${incident.id}`, {
      method: 'PATCH',
      headers: authHeaders(caseToken),
      body: JSON.stringify({ description: 'Updated: KYC fraud' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.incident.description, 'Updated: KYC fraud');
    assert.ok(body.readiness);
  });
});

// ===========================================================================
// EVIDENCE OPERATIONS
// ===========================================================================

test('cases: upload evidence, list, and delete', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);

    // Upload
    const uploadRes = await uploadFile(base, incident.id, caseToken, PNG_BYTES, 'test.png', 'image/png');
    assert.equal(uploadRes.status, 201);
    const uploadBody = await uploadRes.json();
    assert.ok(uploadBody.evidence.id.startsWith('ev_'));
    assert.equal(uploadBody.evidence.integrityFingerprint, expectedHash(PNG_BYTES));
    assert.equal(uploadBody.duplicate, null);

    // List
    const listRes = await fetch(`${base}/api/cases/${incident.id}/evidence`, {
      headers: authHeaders(caseToken),
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.evidence.length, 1);

    // Delete
    const delRes = await fetch(`${base}/api/cases/${incident.id}/evidence/${uploadBody.evidence.id}`, {
      method: 'DELETE',
      headers: authHeaders(caseToken),
    });
    assert.equal(delRes.status, 200);
    const delBody = await delRes.json();
    assert.equal(delBody.incident.evidence.length, 0);
  });
});

test('cases: duplicate upload returns 409', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    await uploadFile(base, incident.id, caseToken, PNG_BYTES, 'first.png', 'image/png');
    const res = await uploadFile(base, incident.id, caseToken, PNG_BYTES, 'second.png', 'image/png');
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'DUPLICATE_EVIDENCE');
  });
});

test('cases: upload without token returns 403', async () => {
  await withServer(async ({ base }) => {
    const { incident } = await createCase(base);
    const res = await uploadFile(base, incident.id, 'wrong-token', PNG_BYTES, 'test.png', 'image/png');
    assert.equal(res.status, 403);
  });
});

// ===========================================================================
// FACT OPERATIONS
// ===========================================================================

test('cases: add evidence-linked fact and verify contradictions auto-derived', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Fraud case');
    const h = authHeaders(caseToken);

    // Upload evidence first
    const uploadRes = await uploadFile(base, incident.id, caseToken, PNG_BYTES, 'receipt.png', 'image/png');
    const { evidence: ev } = await uploadRes.json();

    // Add first fact
    const fact1Res = await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        field: 'transaction_amount',
        value: '18500',
        evidenceId: ev.id,
        sourceReference: 'Bank receipt / amount',
        provenanceType: 'evidence',
        confidence: 0.99,
      }),
    });
    assert.equal(fact1Res.status, 201);
    const fact1Body = await fact1Res.json();
    assert.equal(fact1Body.incident.facts.length, 1);
    assert.equal(fact1Body.incident.contradictions.length, 0);

    // Upload second evidence
    const upload2Res = await uploadFile(base, incident.id, caseToken, TXT_BYTES, 'sms.txt', 'text/plain');
    const { evidence: ev2 } = await upload2Res.json();

    // Add conflicting fact
    const fact2Res = await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        field: 'transaction_amount',
        value: '15500',
        evidenceId: ev2.id,
        sourceReference: 'SMS / message text',
        provenanceType: 'evidence',
        confidence: 0.82,
      }),
    });
    assert.equal(fact2Res.status, 201);
    const fact2Body = await fact2Res.json();

    // Contradictions must be auto-derived by the backend
    assert.equal(fact2Body.incident.contradictions.length, 1);
    assert.equal(fact2Body.incident.contradictions[0].field, 'transaction_amount');
    assert.equal(fact2Body.incident.contradictions[0].severity, 'critical');
    assert.equal(fact2Body.incident.contradictions[0].status, 'unresolved');

    // Readiness should block submission
    assert.equal(fact2Body.readiness.canSubmit, false);
  });
});

test('cases: add user-entered fact', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST',
      headers: authHeaders(caseToken),
      body: JSON.stringify({
        field: 'phone_number',
        value: '+91 90000 12345',
        provenanceType: 'user_entered',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    const fact = body.incident.facts[0];
    assert.equal(fact.provenanceType, 'user_entered');
    assert.equal(fact.userConfirmed, true);
    assert.equal(fact.evidenceId, null);
  });
});

test('cases: PATCH fact value re-derives contradictions', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Test');
    const h = authHeaders(caseToken);

    // Upload evidence and add two conflicting facts
    const uploadRes = await uploadFile(base, incident.id, caseToken, PNG_BYTES, 'r.png', 'image/png');
    const { evidence: ev } = await uploadRes.json();
    const upload2Res = await uploadFile(base, incident.id, caseToken, TXT_BYTES, 's.txt', 'text/plain');
    const { evidence: ev2 } = await upload2Res.json();

    await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_amount', value: '18500', evidenceId: ev.id, sourceReference: 'r', provenanceType: 'evidence' }),
    });
    const addRes = await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_amount', value: '15500', evidenceId: ev2.id, sourceReference: 's', provenanceType: 'evidence' }),
    });
    const addBody = await addRes.json();
    assert.equal(addBody.incident.contradictions.length, 1);

    // Update the second fact to match the first — contradiction should disappear
    const factId = addBody.incident.facts[1].id;
    const patchRes = await fetch(`${base}/api/cases/${incident.id}/facts/${factId}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ value: '18500' }),
    });
    assert.equal(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.incident.contradictions.length, 0);
  });
});

test('cases: confirm fact', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Test');
    const h = authHeaders(caseToken);
    const uploadRes = await uploadFile(base, incident.id, caseToken, PNG_BYTES, 'r.png', 'image/png');
    const { evidence: ev } = await uploadRes.json();

    const addRes = await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_amount', value: '18500', evidenceId: ev.id, sourceReference: 'r', provenanceType: 'evidence' }),
    });
    const factId = (await addRes.json()).incident.facts[0].id;

    const confirmRes = await fetch(`${base}/api/cases/${incident.id}/facts/${factId}/confirm`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ confirmed: true }),
    });
    assert.equal(confirmRes.status, 200);
    const confirmBody = await confirmRes.json();
    assert.equal(confirmBody.incident.facts[0].userConfirmed, true);
  });
});

// ===========================================================================
// TIMELINE / EVENT OPERATIONS
// ===========================================================================

test('cases: add event and confirm it', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Test');
    const h = authHeaders(caseToken);
    const uploadRes = await uploadFile(base, incident.id, caseToken, PNG_BYTES, 'msg.png', 'image/png');
    const { evidence: ev } = await uploadRes.json();

    const addRes = await fetch(`${base}/api/cases/${incident.id}/events`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        timestamp: '2026-08-25T14:02',
        description: 'Contact initiated KYC conversation.',
        evidenceIds: [ev.id],
        confidence: 0.92,
      }),
    });
    assert.equal(addRes.status, 201);
    const addBody = await addRes.json();
    const eventId = addBody.incident.events[0].id;
    assert.equal(addBody.incident.events[0].userConfirmed, false);

    // Confirm event
    const confirmRes = await fetch(`${base}/api/cases/${incident.id}/events/${eventId}/confirm`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ confirmed: true }),
    });
    assert.equal(confirmRes.status, 200);
    const confirmBody = await confirmRes.json();
    assert.equal(confirmBody.incident.events[0].userConfirmed, true);
  });
});

test('cases: GET timeline returns events sorted by timestamp', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Test');
    const h = authHeaders(caseToken);

    // Add events out of order
    await fetch(`${base}/api/cases/${incident.id}/events`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ timestamp: '2026-08-25T14:08', description: 'Payment confirmed.', evidenceIds: [] }),
    });
    await fetch(`${base}/api/cases/${incident.id}/events`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ timestamp: '2026-08-25T14:02', description: 'Contact initiated.', evidenceIds: [] }),
    });

    const res = await fetch(`${base}/api/cases/${incident.id}/timeline`, { headers: h });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.events.length, 2);
    assert.equal(body.events[0].description, 'Contact initiated.');
    assert.equal(body.events[1].description, 'Payment confirmed.');
  });
});

// ===========================================================================
// CONTRADICTION OPERATIONS
// ===========================================================================

test('cases: GET contradictions returns server-derived state', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Test');
    const h = authHeaders(caseToken);
    const uploadRes = await uploadFile(base, incident.id, caseToken, PNG_BYTES, 'r.png', 'image/png');
    const { evidence: ev } = await uploadRes.json();
    const upload2Res = await uploadFile(base, incident.id, caseToken, TXT_BYTES, 's.txt', 'text/plain');
    const { evidence: ev2 } = await upload2Res.json();

    await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_amount', value: '18500', evidenceId: ev.id, sourceReference: 'r', provenanceType: 'evidence' }),
    });
    await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_amount', value: '15500', evidenceId: ev2.id, sourceReference: 's', provenanceType: 'evidence' }),
    });

    const res = await fetch(`${base}/api/cases/${incident.id}/contradictions`, { headers: h });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.contradictions.length, 1);
    assert.equal(body.contradictions[0].field, 'transaction_amount');
    assert.equal(body.contradictions[0].severity, 'critical');
  });
});

test('cases: resolve contradiction by selecting a fact', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Test');
    const h = authHeaders(caseToken);
    const uploadRes = await uploadFile(base, incident.id, caseToken, PNG_BYTES, 'r.png', 'image/png');
    const { evidence: ev } = await uploadRes.json();
    const upload2Res = await uploadFile(base, incident.id, caseToken, TXT_BYTES, 's.txt', 'text/plain');
    const { evidence: ev2 } = await upload2Res.json();

    await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_amount', value: '18500', evidenceId: ev.id, sourceReference: 'r', provenanceType: 'evidence' }),
    });
    const addRes = await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_amount', value: '15500', evidenceId: ev2.id, sourceReference: 's', provenanceType: 'evidence' }),
    });
    const addBody = await addRes.json();
    const contradictionId = addBody.incident.contradictions[0].id;
    const chosenFactId = addBody.incident.contradictions[0].factIds[0]; // select first (18500)

    const resolveRes = await fetch(`${base}/api/cases/${incident.id}/contradictions/${contradictionId}/resolve`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ choice: chosenFactId }),
    });
    assert.equal(resolveRes.status, 200);
    const resolveBody = await resolveRes.json();
    assert.equal(resolveBody.incident.contradictions[0].status, 'resolved');

    // The selected fact is confirmed, the other is rejected
    const selected = resolveBody.incident.facts.find(f => f.value === '18500');
    const rejected = resolveBody.incident.facts.find(f => f.value === '15500');
    assert.equal(selected.resolutionDisposition, 'selected');
    assert.equal(selected.userConfirmed, true);
    assert.equal(rejected.resolutionDisposition, 'rejected');
  });
});

test('cases: resolve contradiction as unresolved', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Test');
    const h = authHeaders(caseToken);
    const uploadRes = await uploadFile(base, incident.id, caseToken, PNG_BYTES, 'r.png', 'image/png');
    const { evidence: ev } = await uploadRes.json();
    const upload2Res = await uploadFile(base, incident.id, caseToken, TXT_BYTES, 's.txt', 'text/plain');
    const { evidence: ev2 } = await upload2Res.json();

    await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_amount', value: '18500', evidenceId: ev.id, sourceReference: 'r', provenanceType: 'evidence' }),
    });
    const addRes = await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_amount', value: '15500', evidenceId: ev2.id, sourceReference: 's', provenanceType: 'evidence' }),
    });
    const addBody = await addRes.json();

    const resolveRes = await fetch(`${base}/api/cases/${incident.id}/contradictions/${addBody.incident.contradictions[0].id}/resolve`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ choice: 'unresolved' }),
    });
    assert.equal(resolveRes.status, 200);
    const resolveBody = await resolveRes.json();
    assert.equal(resolveBody.incident.contradictions[0].status, 'reviewed_unresolved');
    assert.equal(resolveBody.readiness.canSubmit, false);
  });
});

// ===========================================================================
// READINESS
// ===========================================================================

test('cases: GET readiness is always computed server-side', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, '');
    const h = authHeaders(caseToken);

    // Empty case → INCOMPLETE
    const res1 = await fetch(`${base}/api/cases/${incident.id}/readiness`, { headers: h });
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.readiness.state, 'INCOMPLETE');
    assert.ok(body1.readiness.missing.includes('incident_description'));
  });
});

// ===========================================================================
// FULL LIFECYCLE
// ===========================================================================

test('cases: complete lifecycle → create → describe → evidence → facts → contradiction → resolve → confirm → READY', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, '');
    const h = authHeaders(caseToken);
    const caseId = incident.id;

    // 1. Update description
    await fetch(`${base}/api/cases/${caseId}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ description: 'I was tricked into paying a KYC fee.' }),
    });

    // 2. Upload evidence
    const ev1Res = await uploadFile(base, caseId, caseToken, PNG_BYTES, 'receipt.png', 'image/png');
    const { evidence: ev1 } = await ev1Res.json();
    const ev2Res = await uploadFile(base, caseId, caseToken, TXT_BYTES, 'sms.txt', 'text/plain');
    const { evidence: ev2 } = await ev2Res.json();

    // 3. Add facts (with intentional contradiction on transaction_amount)
    await fetch(`${base}/api/cases/${caseId}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_amount', value: '18500', evidenceId: ev1.id, sourceReference: 'receipt / amount', provenanceType: 'evidence', confidence: 0.99 }),
    });
    await fetch(`${base}/api/cases/${caseId}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_timestamp', value: '2026-08-25T14:08', evidenceId: ev1.id, sourceReference: 'receipt / time', provenanceType: 'evidence', confidence: 0.98 }),
    });
    await fetch(`${base}/api/cases/${caseId}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_id', value: 'DEMO-UTR-482916', evidenceId: ev1.id, sourceReference: 'receipt / ref', provenanceType: 'evidence', confidence: 0.99 }),
    });
    await fetch(`${base}/api/cases/${caseId}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'payment_institution', value: 'Demo Bank', evidenceId: ev1.id, sourceReference: 'receipt / bank', provenanceType: 'evidence', confidence: 0.97 }),
    });
    const conflictRes = await fetch(`${base}/api/cases/${caseId}/facts`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ field: 'transaction_amount', value: '15500', evidenceId: ev2.id, sourceReference: 'sms / text', provenanceType: 'evidence', confidence: 0.82 }),
    });
    const conflictBody = await conflictRes.json();

    // 4. Verify contradictions auto-derived
    assert.equal(conflictBody.incident.contradictions.length, 1);
    assert.equal(conflictBody.incident.contradictions[0].severity, 'critical');
    assert.equal(conflictBody.readiness.state, 'NEEDS_REVIEW');
    assert.equal(conflictBody.readiness.canSubmit, false);

    // 5. Resolve contradiction — select ₹18,500
    const contradiction = conflictBody.incident.contradictions[0];
    const chosenFactId = contradiction.factIds[0];
    await fetch(`${base}/api/cases/${caseId}/contradictions/${contradiction.id}/resolve`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ choice: chosenFactId }),
    });

    // 6. Confirm all required evidence-derived facts
    const caseState = await (await fetch(`${base}/api/cases/${caseId}`, { headers: h })).json();
    for (const fact of caseState.incident.facts) {
      if (fact.provenanceType === 'evidence' && !fact.userConfirmed && fact.resolutionDisposition !== 'rejected') {
        await fetch(`${base}/api/cases/${caseId}/facts/${fact.id}/confirm`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ confirmed: true }),
        });
      }
    }

    // 7. Check readiness → should be READY
    const readinessRes = await fetch(`${base}/api/cases/${caseId}/readiness`, { headers: h });
    const readinessBody = await readinessRes.json();
    assert.equal(readinessBody.readiness.state, 'READY');
    assert.equal(readinessBody.readiness.canSubmit, true);
    assert.equal(readinessBody.readiness.missing.length, 0);
    assert.equal(readinessBody.readiness.criticalOpen, false);
    assert.equal(readinessBody.readiness.unconfirmedRequired, false);
  });
});

// ===========================================================================
// CROSS-CASE ISOLATION
// ===========================================================================

test('cases: evidence from case A cannot be referenced in case B fact', async () => {
  await withServer(async ({ base }) => {
    const caseA = await createCase(base, 'Case A');
    const caseB = await createCase(base, 'Case B');

    // Upload evidence to case A
    const uploadRes = await uploadFile(base, caseA.incident.id, caseA.caseToken, PNG_BYTES, 'a.png', 'image/png');
    const { evidence: evA } = await uploadRes.json();

    // Try to add a fact to case B referencing case A's evidence
    const res = await fetch(`${base}/api/cases/${caseB.incident.id}/facts`, {
      method: 'POST',
      headers: authHeaders(caseB.caseToken),
      body: JSON.stringify({
        field: 'transaction_amount',
        value: '18500',
        evidenceId: evA.id,
        sourceReference: 'cross-case',
        provenanceType: 'evidence',
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'CROSS_CASE_REFERENCE');
  });
});

test('cases: case A token cannot access case B', async () => {
  await withServer(async ({ base }) => {
    const caseA = await createCase(base, 'A');
    const caseB = await createCase(base, 'B');

    const res = await fetch(`${base}/api/cases/${caseB.incident.id}`, {
      headers: authHeaders(caseA.caseToken),
    });
    assert.equal(res.status, 403);
  });
});

// ===========================================================================
// INPUT VALIDATION
// ===========================================================================

test('cases: add fact with invalid provenanceType returns 400', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST',
      headers: authHeaders(caseToken),
      body: JSON.stringify({ field: 'x', value: '1', provenanceType: 'ai_hallucinated' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'VALIDATION_ERROR');
  });
});

test('cases: add fact with empty value returns 400', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/facts`, {
      method: 'POST',
      headers: authHeaders(caseToken),
      body: JSON.stringify({ field: 'x', value: '', provenanceType: 'user_entered' }),
    });
    assert.equal(res.status, 400);
  });
});

test('cases: add event with invalid timestamp returns 400', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/events`, {
      method: 'POST',
      headers: authHeaders(caseToken),
      body: JSON.stringify({ timestamp: 'not-a-date', description: 'Test' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'VALIDATION_ERROR');
  });
});

test('cases: confirm fact with non-boolean returns 400', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/facts/fact_fake/confirm`, {
      method: 'POST',
      headers: authHeaders(caseToken),
      body: JSON.stringify({ confirmed: 'yes' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'VALIDATION_ERROR');
  });
});

test('cases: resolve nonexistent contradiction returns error', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/contradictions/conflict_fake/resolve`, {
      method: 'POST',
      headers: authHeaders(caseToken),
      body: JSON.stringify({ choice: 'unresolved' }),
    });
    // Should return 400 or 404 (not found is thrown by domain)
    assert.ok(res.status >= 400);
  });
});

test('cases: add event with cross-case evidence ID returns 400', async () => {
  await withServer(async ({ base }) => {
    const caseA = await createCase(base, 'A');
    const caseB = await createCase(base, 'B');

    const uploadRes = await uploadFile(base, caseA.incident.id, caseA.caseToken, PNG_BYTES, 'a.png', 'image/png');
    const { evidence: evA } = await uploadRes.json();

    const res = await fetch(`${base}/api/cases/${caseB.incident.id}/events`, {
      method: 'POST',
      headers: authHeaders(caseB.caseToken),
      body: JSON.stringify({
        timestamp: '2026-08-25T14:02',
        description: 'Test',
        evidenceIds: [evA.id],
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'CROSS_CASE_REFERENCE');
  });
});

test('cases: PATCH nonexistent fact returns 404', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/facts/fact_nonexistent`, {
      method: 'PATCH',
      headers: authHeaders(caseToken),
      body: JSON.stringify({ value: '99999' }),
    });
    assert.equal(res.status, 404);
  });
});

test('cases: confirm nonexistent event returns 404', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/events/event_nonexistent/confirm`, {
      method: 'POST',
      headers: authHeaders(caseToken),
      body: JSON.stringify({ confirmed: true }),
    });
    assert.equal(res.status, 404);
  });
});
