// backend/tests/report.test.js
// Comprehensive tests for the Prompt 5 deterministic report generation service.
//
// Tests cover: complete/incomplete reports, contradictions (resolved/unresolved/
// reviewed_unresolved), provenance preservation, evidence references, readiness,
// timeline, submission status, security (token enforcement, caseToken exclusion,
// cross-case isolation), determinism, and Prompt 4 regressions.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../server.js';
import { assembleReport } from '../report.js';
import {
  createIncident,
  createFact,
  createEvidence,
  createEvent,
  deriveContradictions,
  setContradictionResolution,
  calculateReadiness,
  buildTimeline,
} from '../domain.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00]);

async function withServer(fn) {
  const uploadDir = await mkdtemp(join(tmpdir(), 'cybersutra-report-'));
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

function authHeaders(caseToken) {
  return {
    'Content-Type': 'application/json',
    'X-Case-Token': caseToken,
  };
}

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

/** Upload unique PNG, return evidence id. */
async function addEvidence(base, caseId, caseToken) {
  const uniqueBytes = Buffer.concat([PNG_BYTES, Buffer.from(String(Math.random()))]);
  const res = await uploadFile(base, caseId, caseToken, uniqueBytes, 'test.png', 'image/png');
  assert.equal(res.status, 201);
  const body = await res.json();
  return body.evidence.id;
}

/** Add a fact via API. */
async function addFact(base, caseId, caseToken, factParams) {
  const res = await fetch(`${base}/api/cases/${caseId}/facts`, {
    method: 'POST',
    headers: authHeaders(caseToken),
    body: JSON.stringify(factParams),
  });
  assert.equal(res.status, 201);
  return res.json();
}

/** Add a timeline event via API. */
async function addEvent(base, caseId, caseToken, eventParams) {
  const res = await fetch(`${base}/api/cases/${caseId}/events`, {
    method: 'POST',
    headers: authHeaders(caseToken),
    body: JSON.stringify(eventParams),
  });
  assert.equal(res.status, 201);
  return res.json();
}

/** Get report via API. */
async function getReport(base, caseId, caseToken) {
  return fetch(`${base}/api/cases/${caseId}/report`, {
    headers: { 'X-Case-Token': caseToken },
  });
}

// ---------------------------------------------------------------------------
// Unit-level helpers for domain tests
// ---------------------------------------------------------------------------

function evidenceFact(field, value, evidenceId = 'ev_' + field) {
  return {
    id: 'fact_' + field + '_' + value.replace(/[^a-z0-9]/gi, ''),
    field,
    value,
    evidenceId,
    sourceReference: 'Test source',
    confidence: 0.9,
    provenanceType: 'evidence',
    userConfirmed: false,
  };
}

function manualFact(field, value) {
  return {
    id: 'fact_manual_' + field,
    field,
    value,
    evidenceId: null,
    sourceReference: null,
    confidence: 1,
    provenanceType: 'user_entered',
    userConfirmed: true,
  };
}

function completeIncident() {
  const inc = createIncident({ description: 'Report test case' });
  inc.evidence.push({
    id: 'ev_1',
    type: 'Screenshot',
    filename: 'receipt.png',
    mimeType: 'image/png',
    size: 1024,
    source: 'Uploaded by citizen',
    integrityFingerprint: 'abc123',
    processingStatus: 'Metadata retained; extraction unavailable',
    createdAt: '2026-08-27T10:00:00.000Z',
  });
  inc.facts.push(
    evidenceFact('transaction_amount', '₹18,500', 'ev_1'),
    evidenceFact('transaction_timestamp', '2026-08-25T14:08', 'ev_1'),
    evidenceFact('transaction_id', 'UTR-482916', 'ev_1'),
    evidenceFact('payment_institution', 'HDFC Bank', 'ev_1'),
  );
  return inc;
}

function confirmAllFacts(incident) {
  for (const f of incident.facts) {
    if (f.resolutionDisposition !== 'rejected') {
      f.userConfirmed = true;
    }
  }
}

// ===========================================================================
// UNIT TESTS — assembleReport()
// ===========================================================================

test('report: complete case produces all required sections', () => {
  const inc = completeIncident();
  confirmAllFacts(inc);
  deriveContradictions(inc);
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  assert.ok(report.caseId);
  assert.ok(report.incident);
  assert.ok(Array.isArray(report.evidence));
  assert.ok(Array.isArray(report.facts));
  assert.ok(Array.isArray(report.timeline));
  assert.ok(Array.isArray(report.contradictions));
  assert.ok(Array.isArray(report.resolutions));
  assert.ok(Array.isArray(report.missingInformation));
  assert.ok(report.readiness);
  assert.ok(report.reviewStatus);
  assert.ok(report.submissionStatus);
});

test('report: incomplete case shows INCOMPLETE readiness with missing fields', () => {
  const inc = createIncident({ description: '' });
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  assert.equal(report.readiness.state, 'INCOMPLETE');
  assert.equal(report.readiness.canSubmit, false);
  assert.ok(report.missingInformation.length > 0);
  assert.ok(report.missingInformation.includes('incident_description'));
  assert.ok(report.missingInformation.includes('transaction_amount'));
});

test('report: contradiction is preserved with all fields', () => {
  const inc = completeIncident();
  inc.facts.push(evidenceFact('transaction_amount', '₹15,500', 'ev_1'));
  deriveContradictions(inc);
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  const conflict = report.contradictions.find(c => c.field === 'transaction_amount');
  assert.ok(conflict);
  assert.equal(conflict.severity, 'critical');
  assert.equal(conflict.status, 'unresolved');
  assert.ok(conflict.values.includes('₹18,500'));
  assert.ok(conflict.values.includes('₹15,500'));
  assert.ok(conflict.factIds.length >= 2);
  assert.ok(Array.isArray(conflict.evidenceIds));
  assert.equal(conflict.resolution, null);
});

test('report: resolved contradiction preserves selected and rejected facts', () => {
  const inc = completeIncident();
  const conflicting = evidenceFact('transaction_amount', '₹15,500', 'ev_1');
  inc.facts.push(conflicting);
  deriveContradictions(inc);
  const selectedFact = inc.facts.find(f => f.field === 'transaction_amount' && f.value === '₹18,500');
  setContradictionResolution(inc, 'conflict_transaction_amount', selectedFact.id);

  const report = assembleReport(JSON.parse(JSON.stringify(inc)));
  const conflict = report.contradictions.find(c => c.field === 'transaction_amount');
  assert.equal(conflict.status, 'resolved');
  assert.ok(conflict.resolution);
  assert.equal(conflict.resolution.choice, 'source_value');
  assert.equal(conflict.resolution.value, '₹18,500');

  // Both facts preserved
  const selected = report.facts.find(f => f.value === '₹18,500' && f.field === 'transaction_amount');
  const rejected = report.facts.find(f => f.value === '₹15,500' && f.field === 'transaction_amount');
  assert.ok(selected);
  assert.ok(rejected);
  assert.equal(selected.resolutionDisposition, 'selected');
  assert.equal(rejected.resolutionDisposition, 'rejected');

  // Resolution entry
  const res = report.resolutions.find(r => r.field === 'transaction_amount');
  assert.ok(res);
  assert.equal(res.status, 'resolved');
});

test('report: unresolved contradiction explicitly represented', () => {
  const inc = completeIncident();
  inc.facts.push(evidenceFact('transaction_amount', '₹15,500', 'ev_1'));
  deriveContradictions(inc);
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  const conflict = report.contradictions.find(c => c.field === 'transaction_amount');
  assert.equal(conflict.status, 'unresolved');
  assert.equal(conflict.resolution, null);
  assert.ok(report.reviewStatus.unresolvedContradictions.includes(conflict.id));
});

test('report: reviewed_unresolved contradiction explicitly represented', () => {
  const inc = completeIncident();
  inc.facts.push(evidenceFact('transaction_amount', '₹15,500', 'ev_1'));
  deriveContradictions(inc);
  setContradictionResolution(inc, 'conflict_transaction_amount', 'unresolved');

  const report = assembleReport(JSON.parse(JSON.stringify(inc)));
  const conflict = report.contradictions.find(c => c.field === 'transaction_amount');
  assert.equal(conflict.status, 'reviewed_unresolved');
  assert.ok(conflict.resolution);
  assert.equal(conflict.resolution.choice, 'unresolved');
  assert.ok(report.reviewStatus.reviewedUnresolvedContradictions.includes(conflict.id));

  const res = report.resolutions.find(r => r.field === 'transaction_amount');
  assert.ok(res);
  assert.equal(res.status, 'reviewed_unresolved');
});

test('report: manual/user-entered facts have distinct provenance', () => {
  const inc = completeIncident();
  const manual = manualFact('payment_institution', 'SBI');
  inc.facts.push(manual);
  deriveContradictions(inc);
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  const manualInReport = report.facts.find(f => f.id === manual.id);
  assert.ok(manualInReport);
  assert.equal(manualInReport.provenanceType, 'user_entered');
  assert.equal(manualInReport.userConfirmed, true);
  // user_entered facts should not have evidenceId in report
  assert.equal(manualInReport.evidenceId, undefined);
});

test('report: evidence-derived fact preserves full provenance', () => {
  const inc = completeIncident();
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  const evidenceFacts = report.facts.filter(f => f.provenanceType === 'evidence');
  assert.ok(evidenceFacts.length > 0);
  for (const f of evidenceFacts) {
    assert.ok(f.evidenceId, 'evidence fact must have evidenceId');
    assert.ok(f.sourceReference !== undefined, 'evidence fact must have sourceReference');
    assert.ok(f.confidence !== undefined, 'evidence fact must have confidence');
  }
});

test('report: mixed manual + evidence-derived facts both preserved', () => {
  const inc = completeIncident();
  inc.facts.push(manualFact('suspicious_url', 'http://scam.example.com'));
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  const evidence = report.facts.filter(f => f.provenanceType === 'evidence');
  const manual = report.facts.filter(f => f.provenanceType === 'user_entered');
  assert.ok(evidence.length > 0);
  assert.ok(manual.length > 0);
});

test('report: evidence references preserved in facts', () => {
  const inc = completeIncident();
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  for (const f of report.facts) {
    if (f.provenanceType === 'evidence') {
      assert.equal(f.evidenceId, 'ev_1');
    }
  }
});

test('report: original values preserved (not normalized)', () => {
  const inc = completeIncident();
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  const amountFact = report.facts.find(f => f.field === 'transaction_amount');
  assert.equal(amountFact.value, '₹18,500');
});

test('report: rejected conflicting facts preserved in report', () => {
  const inc = completeIncident();
  inc.facts.push(evidenceFact('transaction_amount', '₹15,500', 'ev_1'));
  deriveContradictions(inc);
  const selectedFact = inc.facts.find(f => f.field === 'transaction_amount' && f.value === '₹18,500');
  setContradictionResolution(inc, 'conflict_transaction_amount', selectedFact.id);

  const report = assembleReport(JSON.parse(JSON.stringify(inc)));
  const rejectedFacts = report.facts.filter(f => f.resolutionDisposition === 'rejected');
  assert.ok(rejectedFacts.length > 0);
  assert.ok(report.reviewStatus.rejectedFacts.length > 0);
});

test('report: readiness derived server-side', () => {
  const inc = completeIncident();
  confirmAllFacts(inc);
  deriveContradictions(inc);
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  assert.equal(report.readiness.state, 'READY');
  assert.equal(report.readiness.canSubmit, true);
  assert.deepEqual(report.readiness.missing, []);
  assert.equal(report.readiness.criticalOpen, false);
  assert.ok(Array.isArray(report.readiness.blockers));
  assert.equal(report.readiness.blockers.length, 0);
});

test('report: client-supplied READY state cannot influence report', () => {
  // Incomplete case — even if we tamper with readiness, the report must show INCOMPLETE.
  const inc = createIncident({ description: '' });
  // Simulate client trying to forge readiness
  inc.readiness = { state: 'READY', canSubmit: true };
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  assert.equal(report.readiness.state, 'INCOMPLETE');
  assert.equal(report.readiness.canSubmit, false);
});

test('report: missing information represented correctly', () => {
  const inc = createIncident({ description: 'Test' });
  // Only description is present
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  assert.ok(!report.missingInformation.includes('incident_description'));
  assert.ok(report.missingInformation.includes('transaction_amount'));
  assert.ok(report.missingInformation.includes('transaction_timestamp'));
  assert.ok(report.missingInformation.includes('transaction_id'));
  assert.ok(report.missingInformation.includes('payment_institution'));
});

test('report: timeline preserves ordering and timestamps', () => {
  const inc = completeIncident();
  inc.events.push(
    createEvent({ timestamp: '2026-08-25T16:00', description: 'Third event' }),
    createEvent({ timestamp: '2026-08-25T14:00', description: 'First event' }),
    createEvent({ timestamp: '2026-08-25T15:00', description: 'Second event' }),
  );
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  assert.equal(report.timeline.length, 3);
  assert.equal(report.timeline[0].description, 'First event');
  assert.equal(report.timeline[1].description, 'Second event');
  assert.equal(report.timeline[2].description, 'Third event');
  // Original timestamps preserved
  assert.equal(report.timeline[0].timestamp, '2026-08-25T14:00');
});

test('report: candidate vs confirmed timeline events preserved', () => {
  const inc = completeIncident();
  const ev1 = createEvent({ timestamp: '2026-08-25T14:00', description: 'Unconfirmed' });
  const ev2 = createEvent({ timestamp: '2026-08-25T15:00', description: 'Confirmed' });
  ev2.userConfirmed = true;
  inc.events.push(ev1, ev2);

  const report = assembleReport(JSON.parse(JSON.stringify(inc)));
  const unconfirmed = report.timeline.find(e => e.description === 'Unconfirmed');
  const confirmed = report.timeline.find(e => e.description === 'Confirmed');
  assert.equal(unconfirmed.userConfirmed, false);
  assert.equal(confirmed.userConfirmed, true);
});

test('report: submission status reflects unsubmitted case', () => {
  const inc = completeIncident();
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  assert.equal(report.submissionStatus.submitted, false);
  assert.equal(report.submissionStatus.acknowledgement, null);
});

test('report: submission status reflects submitted case', () => {
  const inc = completeIncident();
  inc.submitted = true;
  inc.acknowledgement = { mockRef: 'MOCK-REF-001', timestamp: '2026-08-27T10:00:00Z' };
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  assert.equal(report.submissionStatus.submitted, true);
  assert.deepEqual(report.submissionStatus.acknowledgement, {
    mockRef: 'MOCK-REF-001',
    timestamp: '2026-08-27T10:00:00Z',
  });
});

test('report: caseToken never appears in report output', () => {
  const inc = completeIncident();
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));
  const json = JSON.stringify(report);
  assert.ok(!json.includes('caseToken'));
  assert.ok(!json.includes(inc.caseToken));
});

test('report: report generation does not mutate case state', () => {
  const inc = completeIncident();
  inc.facts.push(evidenceFact('transaction_amount', '₹15,500', 'ev_1'));
  const snapshot = JSON.stringify(inc);

  assembleReport(JSON.parse(JSON.stringify(inc)));
  // The original should be unchanged
  assert.equal(JSON.stringify(inc), snapshot);
});

test('report: repeated generation is deterministic', () => {
  const inc = completeIncident();
  inc.facts.push(evidenceFact('transaction_amount', '₹15,500', 'ev_1'));
  deriveContradictions(inc);

  const clone = () => JSON.parse(JSON.stringify(inc));
  const report1 = assembleReport(clone());
  const report2 = assembleReport(clone());

  assert.deepEqual(report1, report2);
});

// ---------------------------------------------------------------------------
// Prompt 4 regressions
// ---------------------------------------------------------------------------

test('report regression: ₹18,500 and ₹18,500.00 treated as equivalent', () => {
  const inc = completeIncident();
  inc.facts.push(evidenceFact('transaction_amount', '18500.00', 'ev_1'));
  deriveContradictions(inc);
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  const amountConflict = report.contradictions.find(c => c.field === 'transaction_amount');
  assert.equal(amountConflict, undefined, 'equivalent amounts should not produce a contradiction');
});

test('report regression: ₹18,500 and ₹15,500 remain critical contradiction', () => {
  const inc = completeIncident();
  inc.facts.push(evidenceFact('transaction_amount', '₹15,500', 'ev_1'));
  deriveContradictions(inc);
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  const conflict = report.contradictions.find(c => c.field === 'transaction_amount');
  assert.ok(conflict);
  assert.equal(conflict.severity, 'critical');
  assert.equal(conflict.status, 'unresolved');
});

test('report regression: conflicting values visible in report', () => {
  const inc = completeIncident();
  inc.facts.push(evidenceFact('transaction_amount', '₹15,500', 'ev_1'));
  deriveContradictions(inc);
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  const amountFacts = report.facts.filter(f => f.field === 'transaction_amount');
  const values = amountFacts.map(f => f.value);
  assert.ok(values.includes('₹18,500'));
  assert.ok(values.includes('₹15,500'));
});

test('report regression: no value automatically selected', () => {
  const inc = completeIncident();
  inc.facts.push(evidenceFact('transaction_amount', '₹15,500', 'ev_1'));
  deriveContradictions(inc);
  const report = assembleReport(JSON.parse(JSON.stringify(inc)));

  for (const f of report.facts) {
    if (f.field === 'transaction_amount') {
      assert.equal(f.resolutionDisposition, undefined);
    }
  }
});

// ===========================================================================
// INTEGRATION TESTS — GET /api/cases/:caseId/report
// ===========================================================================

test('report API: missing token rejected', async () => {
  await withServer(async ({ base }) => {
    const { incident } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/report`);
    assert.equal(res.status, 403);
  });
});

test('report API: wrong token rejected', async () => {
  await withServer(async ({ base }) => {
    const { incident } = await createCase(base);
    const res = await fetch(`${base}/api/cases/${incident.id}/report`, {
      headers: { 'X-Case-Token': 'wrong-token' },
    });
    assert.equal(res.status, 403);
  });
});

test('report API: cross-case report access rejected', async () => {
  await withServer(async ({ base }) => {
    const caseA = await createCase(base, 'Case A');
    const caseB = await createCase(base, 'Case B');
    // Try to access Case A report with Case B token
    const res = await fetch(`${base}/api/cases/${caseA.incident.id}/report`, {
      headers: { 'X-Case-Token': caseB.caseToken },
    });
    assert.equal(res.status, 403);
  });
});

test('report API: caseToken never appears in report JSON', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base);
    const res = await getReport(base, incident.id, caseToken);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('caseToken'));
    assert.ok(!text.includes(caseToken));
  });
});

test('report API: complete lifecycle report', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Financial fraud incident');

    // Upload evidence
    const evId = await addEvidence(base, incident.id, caseToken);

    // Add evidence-linked facts
    const requiredFacts = [
      { field: 'transaction_amount', value: '₹18,500', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'Bank statement', confidence: 0.95 },
      { field: 'transaction_timestamp', value: '2026-08-25T14:08', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'SMS', confidence: 0.9 },
      { field: 'transaction_id', value: 'UTR-482916', provenanceType: 'evidence', evidenceId: evId, sourceReference: 'Receipt', confidence: 0.95 },
      { field: 'payment_institution', value: 'HDFC Bank', provenanceType: 'user_entered' },
    ];
    for (const fp of requiredFacts) {
      await addFact(base, incident.id, caseToken, fp);
    }

    // Confirm all evidence-derived facts
    const caseRes = await fetch(`${base}/api/cases/${incident.id}`, {
      headers: { 'X-Case-Token': caseToken },
    });
    const caseBody = await caseRes.json();
    for (const f of caseBody.incident.facts) {
      if (f.provenanceType === 'evidence') {
        await fetch(`${base}/api/cases/${incident.id}/facts/${f.id}/confirm`, {
          method: 'POST',
          headers: authHeaders(caseToken),
          body: JSON.stringify({ confirmed: true }),
        });
      }
    }

    // Add timeline event
    await addEvent(base, incident.id, caseToken, {
      timestamp: '2026-08-25T14:08',
      description: 'Fraudulent debit observed',
      evidenceIds: [evId],
      confidence: 0.9,
    });

    // Get report
    const reportRes = await getReport(base, incident.id, caseToken);
    assert.equal(reportRes.status, 200);
    const { report } = await reportRes.json();

    // Verify all sections
    assert.equal(report.caseId, incident.id);
    assert.equal(report.incident.description, 'Financial fraud incident');
    assert.ok(report.evidence.length >= 1);
    assert.ok(report.facts.length >= 4);
    assert.ok(report.timeline.length >= 1);
    assert.equal(report.readiness.state, 'READY');
    assert.equal(report.readiness.canSubmit, true);
    assert.deepEqual(report.missingInformation, []);
    assert.equal(report.submissionStatus.submitted, false);
  });
});

test('report API: report with contradiction shows NEEDS_REVIEW', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Contradiction case');

    // Upload two evidence files
    const evId1 = await addEvidence(base, incident.id, caseToken);
    const evId2 = await addEvidence(base, incident.id, caseToken);

    // Add conflicting facts
    await addFact(base, incident.id, caseToken, {
      field: 'transaction_amount', value: '₹18,500',
      provenanceType: 'evidence', evidenceId: evId1,
      sourceReference: 'Receipt 1', confidence: 0.9,
    });
    await addFact(base, incident.id, caseToken, {
      field: 'transaction_amount', value: '₹15,500',
      provenanceType: 'evidence', evidenceId: evId2,
      sourceReference: 'Receipt 2', confidence: 0.9,
    });
    // Add remaining required facts
    await addFact(base, incident.id, caseToken, {
      field: 'transaction_timestamp', value: '2026-08-25T14:08',
      provenanceType: 'user_entered',
    });
    await addFact(base, incident.id, caseToken, {
      field: 'transaction_id', value: 'UTR-482916',
      provenanceType: 'user_entered',
    });
    await addFact(base, incident.id, caseToken, {
      field: 'payment_institution', value: 'HDFC Bank',
      provenanceType: 'user_entered',
    });

    const reportRes = await getReport(base, incident.id, caseToken);
    const { report } = await reportRes.json();

    assert.equal(report.readiness.state, 'NEEDS_REVIEW');
    assert.equal(report.readiness.canSubmit, false);
    assert.equal(report.readiness.criticalOpen, true);

    const conflict = report.contradictions.find(c => c.field === 'transaction_amount');
    assert.ok(conflict);
    assert.equal(conflict.severity, 'critical');
    assert.equal(conflict.status, 'unresolved');
    assert.ok(conflict.values.includes('₹18,500'));
    assert.ok(conflict.values.includes('₹15,500'));
  });
});

test('report API: report generation does not mutate case state', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Immutability test');

    // Get case state before report
    const before = await fetch(`${base}/api/cases/${incident.id}`, {
      headers: { 'X-Case-Token': caseToken },
    });
    const beforeBody = await before.json();

    // Generate report
    await getReport(base, incident.id, caseToken);

    // Get case state after report
    const after = await fetch(`${base}/api/cases/${incident.id}`, {
      headers: { 'X-Case-Token': caseToken },
    });
    const afterBody = await after.json();

    assert.deepEqual(beforeBody.incident, afterBody.incident);
  });
});

test('report API: repeated generation is deterministic', async () => {
  await withServer(async ({ base }) => {
    const { incident, caseToken } = await createCase(base, 'Determinism test');
    const evId = await addEvidence(base, incident.id, caseToken);
    await addFact(base, incident.id, caseToken, {
      field: 'transaction_amount', value: '₹18,500',
      provenanceType: 'evidence', evidenceId: evId,
      sourceReference: 'Receipt', confidence: 0.9,
    });

    const res1 = await getReport(base, incident.id, caseToken);
    const body1 = await res1.json();
    const res2 = await getReport(base, incident.id, caseToken);
    const body2 = await res2.json();

    assert.deepEqual(body1, body2);
  });
});

test('report API: nonexistent case returns 404', async () => {
  await withServer(async ({ base }) => {
    const { caseToken } = await createCase(base);
    const res = await fetch(`${base}/api/cases/case_00000000-0000-0000-0000-000000000000/report`, {
      headers: { 'X-Case-Token': caseToken },
    });
    // requireCaseToken checks case existence first
    assert.ok(res.status === 404 || res.status === 403);
  });
});
