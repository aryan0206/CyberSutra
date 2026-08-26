// tests/integration/evidence-upload.test.js
// HTTP integration tests for the evidence upload endpoints.
// Tests the full request/response cycle through Express.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { createApp } from '../../backend/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00]);
const PDF_BYTES = Buffer.from('%PDF-1.4 test content');
const TXT_BYTES = Buffer.from('Plain text evidence');

function expectedHash(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function withServer(fn) {
  const uploadDir = await mkdtemp(join(tmpdir(), 'cybersutra-int-'));
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

async function createIncident(base) {
  const res = await fetch(`${base}/api/incidents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'Test' }),
  });
  const body = await res.json();
  return { id: body.incident.id, token: body.caseToken };
}

async function uploadFile(base, incidentId, token, buffer, filename, mimeType) {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  formData.append('file', blob, filename);

  return fetch(`${base}/api/incidents/${incidentId}/evidence`, {
    method: 'POST',
    headers: { 'X-Case-Token': token },
    body: formData,
  });
}

// ===========================================================================
// UPLOAD — valid files
// ===========================================================================

test('integration: upload valid PNG', async () => {
  await withServer(async ({ base }) => {
    const { id: incidentId, token } = await createIncident(base);
    const res = await uploadFile(base, incidentId, token, PNG_BYTES, 'test.png', 'image/png');
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.evidence);
    assert.equal(body.evidence.mimeType, 'image/png');
    assert.equal(body.evidence.type, 'Screenshot');
    assert.equal(body.evidence.integrityFingerprint, expectedHash(PNG_BYTES));
    assert.equal(body.duplicate, null);
  });
});

test('integration: upload valid PDF', async () => {
  await withServer(async ({ base }) => {
    const { id: incidentId, token } = await createIncident(base);
    const res = await uploadFile(base, incidentId, token, PDF_BYTES, 'receipt.pdf', 'application/pdf');
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.evidence.type, 'Document');
  });
});

test('integration: upload valid text file', async () => {
  await withServer(async ({ base }) => {
    const { id: incidentId, token } = await createIncident(base);
    const res = await uploadFile(base, incidentId, token, TXT_BYTES, 'sms.txt', 'text/plain');
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.evidence.type, 'Text message');
  });
});

// ===========================================================================
// UPLOAD — rejections
// ===========================================================================

test('integration: rejects unsupported MIME type', async () => {
  await withServer(async ({ base }) => {
    const { id: incidentId, token } = await createIncident(base);
    const res = await uploadFile(base, incidentId, token, Buffer.from('html'), 'page.html', 'text/html');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok((body.error || body.message || '').includes('not supported'));
  });
});

test('integration: rejects missing file', async () => {
  await withServer(async ({ base }) => {
    const { id: incidentId, token } = await createIncident(base);
    const res = await fetch(`${base}/api/incidents/${incidentId}/evidence`, {
      method: 'POST',
      headers: { 'X-Case-Token': token },
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok((body.error || body.message || '').includes('No file'));
  });
});

test('integration: rejects upload to nonexistent incident', async () => {
  await withServer(async ({ base }) => {
    // Pass a dummy token so it passes auth but fails on ID lookup
    const res = await uploadFile(base, 'nonexistent', 'dummy-token', PNG_BYTES, 'test.png', 'image/png');
    assert.equal(res.status, 404);
  });
});

// ===========================================================================
// DUPLICATE DETECTION
// ===========================================================================

test('integration: duplicate upload returns 409 with relationship info', async () => {
  await withServer(async ({ base }) => {
    const { id: incidentId, token } = await createIncident(base);
    const first = await uploadFile(base, incidentId, token, PNG_BYTES, 'first.png', 'image/png');
    assert.equal(first.status, 201);
    const firstBody = await first.json();

    const second = await uploadFile(base, incidentId, token, PNG_BYTES, 'second.png', 'image/png');
    assert.equal(second.status, 409);
    const secondBody = await second.json();
    assert.ok(secondBody.duplicate);
    assert.equal(secondBody.duplicate.existingEvidenceId, firstBody.evidence.id);
    assert.equal(secondBody.evidence, null);
  });
});

// ===========================================================================
// RETRIEVAL
// ===========================================================================

test('integration: list evidence for incident', async () => {
  await withServer(async ({ base }) => {
    const { id: incidentId, token } = await createIncident(base);
    await uploadFile(base, incidentId, token, PNG_BYTES, 'a.png', 'image/png');
    await uploadFile(base, incidentId, token, PDF_BYTES, 'b.pdf', 'application/pdf');

    const res = await fetch(`${base}/api/incidents/${incidentId}/evidence`, { headers: { 'X-Case-Token': token } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.evidence.length, 2);
  });
});

test('integration: get single evidence by ID', async () => {
  await withServer(async ({ base }) => {
    const { id: incidentId, token } = await createIncident(base);
    const uploadRes = await uploadFile(base, incidentId, token, PNG_BYTES, 'test.png', 'image/png');
    const { evidence } = await uploadRes.json();

    const res = await fetch(`${base}/api/incidents/${incidentId}/evidence/${evidence.id}`, { headers: { 'X-Case-Token': token } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.evidence.id, evidence.id);
  });
});

test('integration: get evidence returns 404 for wrong ID', async () => {
  await withServer(async ({ base }) => {
    const { id: incidentId, token } = await createIncident(base);
    const res = await fetch(`${base}/api/incidents/${incidentId}/evidence/ev_nonexistent`, { headers: { 'X-Case-Token': token } });
    assert.equal(res.status, 404);
  });
});

// ===========================================================================
// DELETION
// ===========================================================================

test('integration: delete evidence removes it', async () => {
  await withServer(async ({ base }) => {
    const { id: incidentId, token } = await createIncident(base);
    const uploadRes = await uploadFile(base, incidentId, token, PNG_BYTES, 'test.png', 'image/png');
    const { evidence } = await uploadRes.json();

    const delRes = await fetch(`${base}/api/incidents/${incidentId}/evidence/${evidence.id}`, {
      method: 'DELETE',
      headers: { 'X-Case-Token': token },
    });
    assert.equal(delRes.status, 200);

    const listRes = await fetch(`${base}/api/incidents/${incidentId}/evidence`, {
      headers: { 'X-Case-Token': token },
    });
    const body = await listRes.json();
    assert.equal(body.evidence.length, 0);
  });
});

// ===========================================================================
// EVIDENCE ISOLATION BETWEEN CASES
// ===========================================================================

test('integration: evidence from case A not visible in case B', async () => {
  await withServer(async ({ base }) => {
    const caseA = await createIncident(base);
    const caseB = await createIncident(base);

    await uploadFile(base, caseA.id, caseA.token, PNG_BYTES, 'a.png', 'image/png');

    const listA = await (await fetch(`${base}/api/incidents/${caseA.id}/evidence`, {
      headers: { 'X-Case-Token': caseA.token },
    })).json();
    const listB = await (await fetch(`${base}/api/incidents/${caseB.id}/evidence`, {
      headers: { 'X-Case-Token': caseB.token },
    })).json();

    assert.equal(listA.evidence.length, 1);
    assert.equal(listB.evidence.length, 0);
  });
});
