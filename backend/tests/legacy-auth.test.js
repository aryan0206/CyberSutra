// backend/tests/legacy-auth.test.js
// Tests to ensure legacy /api/incidents routes are correctly isolated via X-Case-Token.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

async function withServer(fn) {
  const uploadDir = await mkdtemp(join(tmpdir(), 'cybersutra-legacy-auth-'));
  try {
    const { app, service } = createApp({ uploadDir });
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    try {
      await fn({ base, service });
    } finally {
      server.close();
    }
  } finally {
    await rm(uploadDir, { recursive: true });
  }
}

async function createCase(base, description = 'Test') {
  const res = await fetch(`${base}/api/incidents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  return { incidentId: body.incident.id, caseToken: body.caseToken };
}

test('legacy GET without token rejected', async () => {
  await withServer(async ({ base }) => {
    const { incidentId } = await createCase(base);
    const res = await fetch(`${base}/api/incidents/${incidentId}`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });
});

test('legacy GET with wrong token rejected', async () => {
  await withServer(async ({ base }) => {
    const { incidentId } = await createCase(base);
    const res = await fetch(`${base}/api/incidents/${incidentId}`, {
      headers: { 'X-Case-Token': 'wrong-token' }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });
});

test('legacy GET with correct token succeeds but does not expose caseToken', async () => {
  await withServer(async ({ base }) => {
    const { incidentId, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/incidents/${incidentId}`, {
      headers: { 'X-Case-Token': caseToken }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.incident.id, incidentId);
    assert.equal(body.incident.caseToken, undefined);
  });
});

test('legacy mutation without token rejected', async () => {
  await withServer(async ({ base }) => {
    const { incidentId } = await createCase(base);
    const res = await fetch(`${base}/api/incidents/${incidentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Hacked' })
    });
    assert.equal(res.status, 403);
  });
});

test('legacy mutation with wrong token rejected', async () => {
  await withServer(async ({ base }) => {
    const { incidentId } = await createCase(base);
    const res = await fetch(`${base}/api/incidents/${incidentId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Case-Token': 'wrong-token'
      },
      body: JSON.stringify({ description: 'Hacked' })
    });
    assert.equal(res.status, 403);
  });
});

test('legacy mutation with correct token succeeds', async () => {
  await withServer(async ({ base }) => {
    const { incidentId, caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/incidents/${incidentId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Case-Token': caseToken
      },
      body: JSON.stringify({ description: 'Updated securely' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.incident.description, 'Updated securely');
    assert.equal(body.incident.caseToken, undefined);
  });
});

test('cross-case legacy access rejected', async () => {
  await withServer(async ({ base }) => {
    const caseA = await createCase(base);
    const caseB = await createCase(base);

    const res = await fetch(`${base}/api/incidents/${caseB.incidentId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Case-Token': caseA.caseToken // A's token on B's case
      },
      body: JSON.stringify({ description: 'Hacked' })
    });
    assert.equal(res.status, 403);
  });
});
