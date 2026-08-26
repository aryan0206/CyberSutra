// tests/security/evidence-security.test.js
// Security-focused tests for evidence ingestion.
// Validates protections against hostile input.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../backend/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);

async function withServer(fn) {
  const uploadDir = await mkdtemp(join(tmpdir(), 'cybersutra-sec-'));
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
    body: JSON.stringify({ description: 'Security test' }),
  });
  return (await res.json()).incident;
}

async function uploadFile(base, incidentId, buffer, filename, mimeType) {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  formData.append('file', blob, filename);
  return fetch(`${base}/api/incidents/${incidentId}/evidence`, {
    method: 'POST',
    body: formData,
  });
}

// ===========================================================================
// PATH TRAVERSAL
// ===========================================================================

test('security: path traversal filename is sanitized', async () => {
  await withServer(async ({ base }) => {
    const incident = await createIncident(base);
    const res = await uploadFile(base, incident.id, PNG_BYTES, '../../etc/passwd', 'image/png');
    assert.equal(res.status, 201);
    const body = await res.json();
    // Sanitized filename must not contain path traversal
    assert.ok(!body.evidence.filename.includes('..'));
    assert.ok(!body.evidence.filename.includes('/'));
    assert.ok(!body.evidence.filename.includes('\\'));
  });
});

test('security: control characters in filename result in safe handling', async () => {
  await withServer(async ({ base }) => {
    const incident = await createIncident(base);
    // Null bytes in filenames break multipart parsing at the transport layer.
    // The server must either reject the request (400) or sanitize the filename.
    // Both outcomes are safe — the key invariant is that control characters
    // never appear in persisted evidence metadata.
    const res = await uploadFile(base, incident.id, PNG_BYTES, 'file\x00\x0A\x0D.png', 'image/png');
    if (res.status === 201) {
      const body = await res.json();
      assert.ok(!body.evidence.filename.includes('\x00'));
      assert.ok(!body.evidence.filename.includes('\n'));
      assert.ok(!body.evidence.filename.includes('\r'));
    } else {
      // Transport-level rejection is also safe
      assert.ok(res.status >= 400);
    }
  });
});

test('security: script tags stripped from filename', async () => {
  await withServer(async ({ base }) => {
    const incident = await createIncident(base);
    const res = await uploadFile(base, incident.id, PNG_BYTES, '<script>alert(1)</script>.png', 'image/png');
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(!body.evidence.filename.includes('<'));
    assert.ok(!body.evidence.filename.includes('>'));
  });
});

// ===========================================================================
// MIME TYPE ENFORCEMENT
// ===========================================================================

test('security: executable MIME type rejected', async () => {
  await withServer(async ({ base }) => {
    const incident = await createIncident(base);
    const res = await uploadFile(base, incident.id, Buffer.from('MZ...'), 'virus.exe', 'application/x-executable');
    assert.equal(res.status, 400);
  });
});

test('security: HTML MIME type rejected', async () => {
  await withServer(async ({ base }) => {
    const incident = await createIncident(base);
    const res = await uploadFile(base, incident.id, Buffer.from('<html>'), 'page.html', 'text/html');
    assert.equal(res.status, 400);
  });
});

test('security: JavaScript MIME type rejected', async () => {
  await withServer(async ({ base }) => {
    const incident = await createIncident(base);
    const res = await uploadFile(base, incident.id, Buffer.from('alert(1)'), 'script.js', 'application/javascript');
    assert.equal(res.status, 400);
  });
});

// ===========================================================================
// SECURITY HEADERS
// ===========================================================================

test('security: response includes X-Content-Type-Options: nosniff', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'test' }),
    });
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  });
});

test('security: no X-Powered-By header exposed', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'test' }),
    });
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

// ===========================================================================
// EVIDENCE ISOLATION
// ===========================================================================

test('security: evidence from one case cannot be accessed via another case ID', async () => {
  await withServer(async ({ base }) => {
    const caseA = await createIncident(base);
    const caseB = await createIncident(base);

    const uploadRes = await uploadFile(base, caseA.id, PNG_BYTES, 'secret.png', 'image/png');
    const { evidence } = await uploadRes.json();

    // Try to access case A's evidence through case B's endpoint
    const crossRes = await fetch(`${base}/api/incidents/${caseB.id}/evidence/${evidence.id}`);
    assert.equal(crossRes.status, 404);
  });
});

// ===========================================================================
// MALFORMED INPUT
// ===========================================================================

test('security: malformed JSON body does not crash server', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken":',
    });
    assert.ok(res.status >= 400);
  });
});

test('security: empty upload body returns 400', async () => {
  await withServer(async ({ base }) => {
    const incident = await createIncident(base);
    const res = await fetch(`${base}/api/incidents/${incident.id}/evidence`, {
      method: 'POST',
    });
    assert.equal(res.status, 400);
  });
});
