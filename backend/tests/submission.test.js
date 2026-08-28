// backend/tests/submission.test.js
// Comprehensive tests for the mock government submission boundary.
//
// Tests the adapter-based submission architecture:
//   - SubmissionGateway interface
//   - MockSubmissionGateway adapter
//   - Service-level readiness gating
//   - API endpoint integration
//   - Security constraints (no networking, token exclusion)
//   - Determinism and idempotency

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { createApp } from '../server.js';
import { SubmissionGateway, MockSubmissionGateway } from '../submission-gateway.js';
import {
  createIncident,
  deriveContradictions,
  calculateReadiness,
} from '../domain.js';
import { assembleReport } from '../report.js';

// ---------------------------------------------------------------------------
// Test infrastructure helpers
// ---------------------------------------------------------------------------

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00]);

async function withServer(fn) {
  const uploadDir = await mkdtemp(join(tmpdir(), 'cybersutra-submit-'));
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

async function createCase(base, description = 'Submission test case') {
  const res = await fetch(`${base}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

function authHeaders(caseToken) {
  return {
    'Content-Type': 'application/json',
    'X-Case-Token': caseToken,
  };
}

async function uploadFile(base, caseId, caseToken) {
  const uniqueBytes = Buffer.concat([PNG_BYTES, Buffer.from(String(Math.random()))]);
  const formData = new FormData();
  formData.append('file', new Blob([uniqueBytes], { type: 'image/png' }), 'test.png');
  const res = await fetch(`${base}/api/cases/${caseId}/evidence`, {
    method: 'POST',
    headers: { 'X-Case-Token': caseToken },
    body: formData,
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  return body.evidence.id;
}

async function addFact(base, caseId, caseToken, params) {
  const res = await fetch(`${base}/api/cases/${caseId}/facts`, {
    method: 'POST',
    headers: authHeaders(caseToken),
    body: JSON.stringify(params),
  });
  assert.equal(res.status, 201);
  return res.json();
}

async function confirmFact(base, caseId, caseToken, factId) {
  const res = await fetch(`${base}/api/cases/${caseId}/facts/${factId}/confirm`, {
    method: 'POST',
    headers: authHeaders(caseToken),
    body: JSON.stringify({ confirmed: true }),
  });
  assert.equal(res.status, 200);
}

/**
 * Build a fully READY case via the API.
 * Returns { caseId, caseToken }.
 */
async function buildReadyCase(base) {
  const { incident, caseToken } = await createCase(base, 'Fraud incident for submission');
  const caseId = incident.id;
  const evId = await uploadFile(base, caseId, caseToken);

  // Add all required facts
  const facts = [
    { field: 'transaction_amount', value: '₹18,500', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'Bank statement', confidence: 0.95 },
    { field: 'transaction_timestamp', value: '2026-08-25T14:08', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'SMS', confidence: 0.9 },
    { field: 'transaction_id', value: 'UTR-482916', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'Receipt', confidence: 0.95 },
    { field: 'payment_institution', value: 'HDFC Bank', provenanceType: 'user_entered' },
  ];
  const factIds = [];
  for (const fp of facts) {
    const body = await addFact(base, caseId, caseToken, fp);
    const addedFact = body.incident.facts[body.incident.facts.length - 1];
    factIds.push(addedFact.id);
  }

  // Confirm evidence-derived facts (first 3)
  for (let i = 0; i < 3; i++) {
    await confirmFact(base, caseId, caseToken, factIds[i]);
  }

  // Verify readiness
  const readRes = await fetch(`${base}/api/cases/${caseId}/readiness`, {
    headers: { 'X-Case-Token': caseToken },
  });
  const { readiness } = await readRes.json();
  assert.equal(readiness.state, 'READY', 'Case must be READY before submission');

  return { caseId, caseToken };
}

// ===========================================================================
// UNIT TESTS — MockSubmissionGateway
// ===========================================================================

test('gateway: abstract SubmissionGateway.submit() throws', () => {
  const gw = new SubmissionGateway();
  assert.throws(() => gw.submit({}), /must be implemented/);
});

test('gateway: abstract SubmissionGateway.getStatus() throws', () => {
  const gw = new SubmissionGateway();
  assert.throws(() => gw.getStatus('ref'), /must be implemented/);
});

test('gateway: MockSubmissionGateway generates synthetic reference', () => {
  const gw = new MockSubmissionGateway();
  const report = { caseId: 'case_test' };
  const ack = gw.submit(report);

  assert.ok(ack.reference.startsWith('MOCK-NCRP-'));
  assert.match(ack.reference, /^MOCK-NCRP-\d{8}-\d{6}$/);
  assert.equal(ack.simulated, true);
  assert.equal(ack.provider, 'MockSubmissionGateway');
  assert.equal(ack.status, 'submitted');
  assert.ok(ack.timestamp);
  assert.ok(ack.note);
});

test('gateway: mock reference is unmistakably non-governmental', () => {
  const gw = new MockSubmissionGateway();
  const ack = gw.submit({ caseId: 'case_test' });

  // Must start with MOCK- to be unmistakable
  assert.ok(ack.reference.startsWith('MOCK-'));
  // Must be marked simulated
  assert.equal(ack.simulated, true);
  // Note must clarify it's not real
  assert.ok(ack.note.includes('simulated'));
});

test('gateway: sequential references have incrementing sequence numbers', () => {
  const gw = new MockSubmissionGateway();
  const r1 = gw.submit({ caseId: 'case_1' });
  const r2 = gw.submit({ caseId: 'case_2' });

  assert.notEqual(r1.reference, r2.reference);
  // Extract sequence numbers
  const seq1 = parseInt(r1.reference.split('-').pop());
  const seq2 = parseInt(r2.reference.split('-').pop());
  assert.equal(seq2, seq1 + 1);
});

test('gateway: getStatus returns not_found for unknown reference', () => {
  const gw = new MockSubmissionGateway();
  const status = gw.getStatus('MOCK-NCRP-00000000-999999');
  assert.equal(status.status, 'not_found');
  assert.equal(status.simulated, true);
});

test('gateway: getStatus returns submitted for known reference', () => {
  const gw = new MockSubmissionGateway();
  const ack = gw.submit({ caseId: 'case_test' });
  const status = gw.getStatus(ack.reference);

  assert.equal(status.status, 'submitted');
  assert.equal(status.reference, ack.reference);
  assert.equal(status.simulated, true);
  assert.equal(status.caseId, 'case_test');
});

test('gateway: submit requires report with caseId', () => {
  const gw = new MockSubmissionGateway();
  assert.throws(() => gw.submit(null), /caseId is required/);
  assert.throws(() => gw.submit({}), /caseId is required/);
});

test('gateway: no networking imports in submission-gateway.js', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', 'submission-gateway.js'),
    'utf-8',
  );
  // Strip comments to avoid false positives from documentation
  const codeLines = source.split('\n')
    .filter(line => !line.trimStart().startsWith('//'))
    .filter(line => !line.trimStart().startsWith('*'))
    .join('\n');
  // Must not contain actual networking imports
  assert.ok(!(/import\s+.*\b(fetch|axios|http|https|node-fetch|got)\b/.test(codeLines)));
  assert.ok(!codeLines.includes("require('http')"));
  assert.ok(!codeLines.includes("require('https')"));
  assert.ok(!codeLines.includes("require('node-fetch')"));
  assert.ok(!codeLines.includes("require('axios')"));
});

// ===========================================================================
// UNIT TESTS — Service-level readiness gating
// ===========================================================================

test('service: submitCase rejects INCOMPLETE case', async () => {
  await withServer(async ({ base, service }) => {
    const { incident } = await createCase(base);
    // Empty case with no facts — INCOMPLETE
    assert.throws(
      () => service.submitCase(incident.id),
      (err) => err.code === 'SUBMISSION_NOT_READY' && err.status === 422,
    );
  });
});

test('service: submitCase rejects NEEDS_REVIEW case (unconfirmed facts)', async () => {
  await withServer(async ({ base, service }) => {
    const { incident, caseToken } = await createCase(base);
    const evId = await uploadFile(base, incident.id, caseToken);

    // Add all required facts but don't confirm evidence-derived ones
    await addFact(base, incident.id, caseToken, { field: 'transaction_amount', value: '₹18,500', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'Receipt', confidence: 0.95 });
    await addFact(base, incident.id, caseToken, { field: 'transaction_timestamp', value: '2026-08-25T14:08', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'SMS', confidence: 0.9 });
    await addFact(base, incident.id, caseToken, { field: 'transaction_id', value: 'UTR-482916', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'Receipt', confidence: 0.95 });
    await addFact(base, incident.id, caseToken, { field: 'payment_institution', value: 'HDFC', provenanceType: 'user_entered' });

    assert.throws(
      () => service.submitCase(incident.id),
      (err) => err.code === 'SUBMISSION_NOT_READY',
    );
  });
});

test('service: submitCase rejects case with critical unresolved contradiction', async () => {
  await withServer(async ({ base, service }) => {
    const { incident, caseToken } = await createCase(base);
    const evId1 = await uploadFile(base, incident.id, caseToken);
    const evId2 = await uploadFile(base, incident.id, caseToken);

    // Conflicting transaction_amount — critical field
    await addFact(base, incident.id, caseToken, { field: 'transaction_amount', value: '₹18,500', provenanceType: 'evidence', evidenceId: evId1, sourceReference: 'R1', confidence: 0.95 });
    await addFact(base, incident.id, caseToken, { field: 'transaction_amount', value: '₹15,500', provenanceType: 'evidence', evidenceId: evId2, sourceReference: 'R2', confidence: 0.95 });
    await addFact(base, incident.id, caseToken, { field: 'transaction_timestamp', value: '2026-08-25T14:08', provenanceType: 'user_entered' });
    await addFact(base, incident.id, caseToken, { field: 'transaction_id', value: 'UTR-482916', provenanceType: 'user_entered' });
    await addFact(base, incident.id, caseToken, { field: 'payment_institution', value: 'HDFC', provenanceType: 'user_entered' });

    assert.throws(
      () => service.submitCase(incident.id),
      (err) => err.code === 'SUBMISSION_NOT_READY' && err.status === 422,
    );
  });
});

test('service: submitCase succeeds for READY case', async () => {
  await withServer(async ({ base, service }) => {
    const { caseId } = await buildReadyCase(base);
    const result = service.submitCase(caseId);

    assert.ok(result.acknowledgement);
    assert.equal(result.alreadySubmitted, false);
    assert.ok(result.acknowledgement.reference.startsWith('MOCK-NCRP-'));
    assert.equal(result.acknowledgement.simulated, true);
    assert.equal(result.acknowledgement.status, 'submitted');
  });
});

test('service: repeated submitCase is idempotent', async () => {
  await withServer(async ({ base, service }) => {
    const { caseId } = await buildReadyCase(base);
    const result1 = service.submitCase(caseId);
    const result2 = service.submitCase(caseId);

    assert.equal(result2.alreadySubmitted, true);
    assert.deepEqual(result2.acknowledgement, result1.acknowledgement);
  });
});

// ===========================================================================
// INTEGRATION TESTS — POST /api/cases/:caseId/submit
// ===========================================================================

test('submit API: missing token rejected', async () => {
  await withServer(async ({ base }) => {
    const { incident } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/submit`, { method: 'POST' });
    assert.equal(res.status, 403);
  });
});

test('submit API: wrong token rejected', async () => {
  await withServer(async ({ base }) => {
    const caseA = await createCase(base, 'Case A');
    const caseB = await createCase(base, 'Case B');
    const res = await fetch(`${base}/api/cases/${caseA.incident.id}/submit`, {
      method: 'POST',
      headers: { 'X-Case-Token': caseB.caseToken },
    });
    assert.equal(res.status, 403);
  });
});

test('submit API: INCOMPLETE case returns 422 with blockers', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/submit`, {
      method: 'POST',
      headers: authHeaders(caseToken),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.code, 'SUBMISSION_NOT_READY');
    assert.ok(body.details);
    assert.equal(body.details.state, 'INCOMPLETE');
    assert.ok(body.details.blockers.length > 0);
  });
});

test('submit API: NEEDS_REVIEW case returns 422', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const evId = await uploadFile(base, incident.id, caseToken);

    // All required facts present but unconfirmed
    await addFact(base, incident.id, caseToken, { field: 'transaction_amount', value: '₹18,500', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'R', confidence: 0.9 });
    await addFact(base, incident.id, caseToken, { field: 'transaction_timestamp', value: '2026-08-25T14:08', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'R', confidence: 0.9 });
    await addFact(base, incident.id, caseToken, { field: 'transaction_id', value: 'UTR-1', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'R', confidence: 0.9 });
    await addFact(base, incident.id, caseToken, { field: 'payment_institution', value: 'Bank', provenanceType: 'user_entered' });

    const res = await fetch(`${base}/api/cases/${incident.id}/submit`, {
      method: 'POST',
      headers: authHeaders(caseToken),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.code, 'SUBMISSION_NOT_READY');
    assert.equal(body.details.state, 'NEEDS_REVIEW');
  });
});

test('submit API: READY case returns 201 with acknowledgement', async () => {
  await withServer(async ({ base }) => {
    const { caseId, caseToken } = await buildReadyCase(base);

    const res = await fetch(`${base}/api/cases/${caseId}/submit`, {
      method: 'POST',
      headers: { 'X-Case-Token': caseToken },
    });
    assert.equal(res.status, 201);
    const body = await res.json();

    assert.ok(body.acknowledgement);
    assert.equal(body.alreadySubmitted, false);
    assert.ok(body.acknowledgement.reference.startsWith('MOCK-NCRP-'));
    assert.match(body.acknowledgement.reference, /^MOCK-NCRP-\d{8}-\d{6}$/);
    assert.equal(body.acknowledgement.simulated, true);
    assert.equal(body.acknowledgement.provider, 'MockSubmissionGateway');
    assert.equal(body.acknowledgement.status, 'submitted');
    assert.ok(body.acknowledgement.timestamp);
    assert.ok(body.acknowledgement.note.includes('simulated'));
  });
});

test('submit API: repeated submission returns 200 with same acknowledgement', async () => {
  await withServer(async ({ base }) => {
    const { caseId, caseToken } = await buildReadyCase(base);

    // First submission
    const res1 = await fetch(`${base}/api/cases/${caseId}/submit`, {
      method: 'POST',
      headers: authHeaders(caseToken),
    });
    assert.equal(res1.status, 201);
    const body1 = await res1.json();

    // Repeated submission
    const res2 = await fetch(`${base}/api/cases/${caseId}/submit`, {
      method: 'POST',
      headers: authHeaders(caseToken),
    });
    assert.equal(res2.status, 200);
    const body2 = await res2.json();

    assert.equal(body2.alreadySubmitted, true);
    assert.deepEqual(body2.acknowledgement, body1.acknowledgement);
  });
});

test('submit API: acknowledgement does not contain caseToken', async () => {
  await withServer(async ({ base }) => {
    const { caseId, caseToken } = await buildReadyCase(base);

    const res = await fetch(`${base}/api/cases/${caseId}/submit`, {
      method: 'POST',
      headers: authHeaders(caseToken),
    });
    const text = await res.text();
    assert.ok(!text.includes('caseToken'));
    assert.ok(!text.includes(caseToken));
  });
});

test('submit API: case state reflects submission', async () => {
  await withServer(async ({ base }) => {
    const { caseId, caseToken } = await buildReadyCase(base);

    // Submit
    await fetch(`${base}/api/cases/${caseId}/submit`, {
      method: 'POST',
      headers: authHeaders(caseToken),
    });

    // Get case
    const caseRes = await fetch(`${base}/api/cases/${caseId}`, {
      headers: { 'X-Case-Token': caseToken },
    });
    const { incident } = await caseRes.json();
    assert.equal(incident.submitted, true);
    assert.ok(incident.acknowledgement);
    assert.ok(incident.acknowledgement.reference.startsWith('MOCK-NCRP-'));
    assert.equal(incident.acknowledgement.simulated, true);
  });
});

test('submit API: report reflects submission after submit', async () => {
  await withServer(async ({ base }) => {
    const { caseId, caseToken } = await buildReadyCase(base);

    // Submit
    await fetch(`${base}/api/cases/${caseId}/submit`, {
      method: 'POST',
      headers: authHeaders(caseToken),
    });

    // Get report
    const reportRes = await fetch(`${base}/api/cases/${caseId}/report`, {
      headers: { 'X-Case-Token': caseToken },
    });
    const { report } = await reportRes.json();
    assert.equal(report.submissionStatus.submitted, true);
    assert.ok(report.submissionStatus.acknowledgement.reference.startsWith('MOCK-NCRP-'));
    assert.equal(report.submissionStatus.acknowledgement.simulated, true);
  });
});

// ===========================================================================
// INTEGRATION TESTS — GET /api/cases/:caseId/submission
// ===========================================================================

test('submission status API: unsubmitted case returns submitted=false', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/submission`, {
      headers: { 'X-Case-Token': caseToken },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.submitted, false);
    assert.equal(body.status, null);
  });
});

test('submission status API: submitted case returns gateway status', async () => {
  await withServer(async ({ base }) => {
    const { caseId, caseToken } = await buildReadyCase(base);

    // Submit
    await fetch(`${base}/api/cases/${caseId}/submit`, {
      method: 'POST',
      headers: authHeaders(caseToken),
    });

    // Query status
    const res = await fetch(`${base}/api/cases/${caseId}/submission`, {
      headers: { 'X-Case-Token': caseToken },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.submitted, true);
    assert.ok(body.status);
    assert.equal(body.status.status, 'submitted');
    assert.equal(body.status.simulated, true);
  });
});

// ===========================================================================
// SECURITY — No external network calls
// ===========================================================================

test('security: submission-gateway.js contains no networking imports', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', 'submission-gateway.js'),
    'utf-8',
  );
  // Strip comments (single-line) so we only check executable code
  const codeLines = source.split('\n')
    .filter(line => !line.trimStart().startsWith('//'))
    .filter(line => !line.trimStart().startsWith('*'))
    .join('\n');

  // Check for actual import/require statements of networking modules
  const forbidden = [
    /import\s+.*\bfetch\b/,
    /import\s+.*\baxios\b/,
    /import\s+.*\bhttp\b/,
    /import\s+.*\bhttps\b/,
    /import\s+.*\bnode-fetch\b/,
    /import\s+.*\bgot\b/,
    /require\s*\(\s*['"]http['"]\s*\)/,
    /require\s*\(\s*['"]https['"]\s*\)/,
    /require\s*\(\s*['"]node-fetch['"]\s*\)/,
    /require\s*\(\s*['"]axios['"]\s*\)/,
    /new\s+XMLHttpRequest/,
    /globalThis\.fetch\s*\(/,
  ];
  for (const pattern of forbidden) {
    assert.ok(
      !pattern.test(codeLines),
      `submission-gateway.js must not contain networking code matching ${pattern}`,
    );
  }
});

test('security: mock reference cannot be mistaken for real NCRP number', async () => {
  await withServer(async ({ base }) => {
    const { caseId, caseToken } = await buildReadyCase(base);
    const res = await fetch(`${base}/api/cases/${caseId}/submit`, {
      method: 'POST',
      headers: authHeaders(caseToken),
    });
    const { acknowledgement } = await res.json();

    // Must start with MOCK-
    assert.ok(acknowledgement.reference.startsWith('MOCK-'));
    // Must be flagged simulated
    assert.equal(acknowledgement.simulated, true);
    // Provider must identify the mock adapter
    assert.equal(acknowledgement.provider, 'MockSubmissionGateway');
    // Note must say simulated
    assert.ok(acknowledgement.note.toLowerCase().includes('simulated'));
  });
});

test('security: forged client canSubmit=true does not bypass readiness gate', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);

    // Try to forge readiness by patching with canSubmit
    await fetch(`${base}/api/cases/${incident.id}`, {
      method: 'PATCH',
      headers: authHeaders(caseToken),
      body: JSON.stringify({ canSubmit: true, readiness: { state: 'READY', canSubmit: true } }),
    });

    // Attempt submission — must still fail
    const res = await fetch(`${base}/api/cases/${incident.id}/submit`, {
      method: 'POST',
      headers: authHeaders(caseToken),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.code, 'SUBMISSION_NOT_READY');
  });
});
