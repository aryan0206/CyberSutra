import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../backend/server.js';
import { InMemoryCaseRepository } from '../../backend/repository.js';
import { EvidenceFileStore } from '../../backend/evidence-store.js';
import { MockSubmissionGateway } from '../../backend/submission-gateway.js';

async function withServer(fn) {
  const uploadDir = await mkdtemp(join(tmpdir(), 'cybersutra-int-'));
  try {
    const repository = new InMemoryCaseRepository();
    const evidenceStore = new EvidenceFileStore(uploadDir);
    const submissionGateway = new MockSubmissionGateway();
    submissionGateway.logger = { info: () => {} }; // disable logging

    const { app, service } = createApp({ uploadDir, repository, evidenceStore, submissionGateway });
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    try {
      await fn({ base, uploadDir });
    } finally {
      server.close();
    }
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
}

test('Full incident lifecycle through V2 API', async () => {
  await withServer(async ({ base, uploadDir }) => {
    // 1. Create a new case
    const createRes = await fetch(`${base}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Testing the full flow' }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    const caseId = createBody.incident.id;
    const token = createBody.caseToken;
    assert.ok(caseId);
    assert.ok(token);

    // 2. Upload evidence
    const testFile = join(uploadDir, 'test.txt');
    await writeFile(testFile, 'Plain text evidence'); // Must be valid text
    const formData = new FormData();
    formData.append('file', new Blob(['Plain text evidence'], { type: 'text/plain' }), 'test.txt');
    
    const uploadRes = await fetch(`${base}/api/cases/${caseId}/evidence`, {
      method: 'POST',
      headers: { 'X-Case-Token': token },
      body: formData,
    });
    assert.equal(uploadRes.status, 201);
    const uploadBody = await uploadRes.json();
    const evId = uploadBody.evidence.id;
    assert.ok(evId);

    // 3. Add facts
    const addFact1 = await fetch(`${base}/api/cases/${caseId}/facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Case-Token': token },
      body: JSON.stringify({
        field: 'transaction_amount',
        value: '5000',
        provenanceType: 'evidence',
        evidenceId: evId,
        sourceReference: 'Test doc',
        confidence: 0.9
      })
    });
    assert.equal(addFact1.status, 201);

    const addFact2 = await fetch(`${base}/api/cases/${caseId}/facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Case-Token': token },
      body: JSON.stringify({
        field: 'payment_institution',
        value: 'Test Bank',
        provenanceType: 'user_entered'
      })
    });
    assert.equal(addFact2.status, 201);

    // 4. Add contradiction
    const addFact3 = await fetch(`${base}/api/cases/${caseId}/facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Case-Token': token },
      body: JSON.stringify({
        field: 'transaction_amount',
        value: '6000',
        provenanceType: 'evidence',
        evidenceId: evId,
        sourceReference: 'Test doc 2',
        confidence: 0.9
      })
    });
    assert.equal(addFact3.status, 201);

    // 5. Get contradictions and resolve
    const getRes = await fetch(`${base}/api/cases/${caseId}`, {
      headers: { 'X-Case-Token': token },
    });
    const getBody = await getRes.json();
    assert.equal(getBody.incident.contradictions.length, 1);
    const conflictId = getBody.incident.contradictions[0].id;
    const factIdToChoose = getBody.incident.contradictions[0].factIds[0];
    
    const resolveRes = await fetch(`${base}/api/cases/${caseId}/contradictions/${conflictId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Case-Token': token },
      body: JSON.stringify({ choice: factIdToChoose })
    });
    assert.equal(resolveRes.status, 200);

    // 6. Complete remaining required facts
    await fetch(`${base}/api/cases/${caseId}/facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Case-Token': token },
      body: JSON.stringify({
        field: 'transaction_timestamp',
        value: '2026-08-25T14:00',
        provenanceType: 'user_entered'
      })
    });

    await fetch(`${base}/api/cases/${caseId}/facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Case-Token': token },
      body: JSON.stringify({
        field: 'transaction_id',
        value: 'TEST-123',
        provenanceType: 'user_entered'
      })
    });
    
    // 7. Check readiness
    const readRes = await fetch(`${base}/api/cases/${caseId}/readiness`, {
      headers: { 'X-Case-Token': token },
    });
    assert.equal(readRes.status, 200);
    const readBody = await readRes.json();
    assert.equal(readBody.readiness.state, 'READY');

    // 8. Submit
    const subRes = await fetch(`${base}/api/cases/${caseId}/submit`, {
      method: 'POST',
      headers: { 'X-Case-Token': token },
    });
    assert.equal(subRes.status, 201);
    const subBody = await subRes.json();
    assert.ok(subBody.acknowledgement);
    assert.equal(subBody.acknowledgement.simulated, true);
  });
});

test('Demo case initialization endpoint', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/cases/demo`, { method: 'POST' });
    assert.equal(res.status, 201);
    const body = await res.json();
      
    assert.ok(body.incident.id);
    assert.equal(body.incident.evidence.length, 3);
    assert.equal(body.incident.facts.length, 7);
    assert.equal(body.incident.events.length, 3);
    
    // Should have a critical contradiction open
    assert.equal(body.incident.contradictions.length, 1);
    assert.equal(body.incident.contradictions[0].severity, 'critical');
    assert.equal(body.incident.contradictions[0].status, 'unresolved');
    
    // Readiness should be NEEDS_REVIEW
    assert.equal(body.readiness.state, 'NEEDS_REVIEW');
  });
});
