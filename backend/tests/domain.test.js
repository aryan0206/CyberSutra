// backend/tests/domain.test.js
// Comprehensive tests for the CyberSutra backend domain layer.
//
// These tests verify that the backend domain logic produces identical results
// to the frontend domain logic (frontend/core.js) for every scenario covered
// by the existing test suite (tests/unit/core-logic.test.js), plus additional
// backend-specific validation rules.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_BYTES,
  ACCEPTED_MIME_TYPES,
  REQUIRED_FIELDS,
  CRITICAL_CONFLICT_FIELDS,
  PROVENANCE_TYPES,
  CONTRADICTION_STATUSES,
  READINESS_STATES,
  generateId,
  sanitizeFilename,
  validateUpload,
  deriveEvidenceType,
  findDuplicateEvidence,
  createEvidence,
  createFact,
  createEvent,
  createIncident,
  deriveContradictions,
  setContradictionResolution,
  calculateReadiness,
  isManualFact,
} from '../domain.js';

import { InMemoryCaseRepository } from '../repository.js';
import { IncidentService } from '../service.js';

// ---------------------------------------------------------------------------
// Test helpers — mirror the helpers in tests/unit/core-logic.test.js
// ---------------------------------------------------------------------------

const evidenceFact = (field, value, id = field) => ({
  id,
  field,
  value,
  evidenceId: `ev_${id}`,
  sourceReference: 'synthetic source',
  provenanceType: 'evidence',
  userConfirmed: false,
});

const completeIncident = () => ({
  description: 'Synthetic incident',
  facts: [
    evidenceFact('transaction_amount', '18500'),
    evidenceFact('transaction_timestamp', '2026-08-25T14:08'),
    evidenceFact('transaction_id', 'DEMO-UTR-1'),
    evidenceFact('payment_institution', 'Demo Bank'),
  ],
  contradictions: [],
});

const confirmRequired = incident =>
  incident.facts.forEach(fact => {
    if (fact.field !== 'transaction_amount' || fact.resolutionDisposition !== 'rejected') {
      fact.userConfirmed = true;
    }
  });

// ===========================================================================
// CONSTANTS
// ===========================================================================

test('constants match frontend values', () => {
  assert.equal(MAX_BYTES, 5 * 1024 * 1024);
  assert.deepEqual([...ACCEPTED_MIME_TYPES].sort(), ['application/pdf', 'image/jpeg', 'image/png', 'text/plain']);
  assert.deepEqual(REQUIRED_FIELDS, ['incident_description', 'transaction_amount', 'transaction_timestamp', 'transaction_id', 'payment_institution']);
  assert.deepEqual([...CRITICAL_CONFLICT_FIELDS].sort(), ['transaction_amount', 'transaction_id', 'transaction_timestamp']);
});

// ===========================================================================
// ID GENERATION
// ===========================================================================

test('generateId produces prefixed unique IDs', () => {
  const a = generateId('case');
  const b = generateId('case');
  assert.ok(a.startsWith('case_'));
  assert.ok(b.startsWith('case_'));
  assert.notEqual(a, b);
});

// ===========================================================================
// EVIDENCE VALIDATION — matches frontend tests
// ===========================================================================

test('upload allowlist, size limit, and filename sanitization are deterministic', () => {
  assert.equal(validateUpload({ type: 'image/png', size: MAX_BYTES }).ok, true);
  assert.equal(validateUpload({ type: 'text/html', size: 1 }).ok, false);
  assert.equal(validateUpload({ type: 'image/png', size: MAX_BYTES + 1 }).ok, false);
  assert.equal(sanitizeFilename('../../bad<script>.png'), '____bad_script_.png');
});

test('validateUpload rejects non-finite sizes', () => {
  assert.equal(validateUpload({ type: 'image/png', size: NaN }).ok, false);
  assert.equal(validateUpload({ type: 'image/png', size: Infinity }).ok, false);
  assert.equal(validateUpload({ type: 'image/png', size: -1 }).ok, false);
});

// ===========================================================================
// INCIDENT CREATION
// ===========================================================================

test('valid incident creation produces correct structure', () => {
  const incident = createIncident({ description: 'Test incident' });
  assert.ok(incident.id.startsWith('case_'));
  assert.equal(incident.description, 'Test incident');
  assert.deepEqual(incident.evidence, []);
  assert.deepEqual(incident.facts, []);
  assert.deepEqual(incident.events, []);
  assert.deepEqual(incident.contradictions, []);
  assert.equal(incident.submitted, false);
  assert.equal(incident.acknowledgement, null);
});

test('incident creation with no arguments produces empty description', () => {
  const incident = createIncident();
  assert.equal(incident.description, '');
});

// ===========================================================================
// FACT CREATION & VALIDATION
// ===========================================================================

test('evidence-linked fact retains provenance', () => {
  const fact = createFact({
    field: 'transaction_amount',
    value: '18500',
    evidenceId: 'ev_receipt',
    sourceReference: 'Bank receipt / amount',
    confidence: 0.99,
    provenanceType: 'evidence',
  });
  assert.ok(fact.id.startsWith('fact_'));
  assert.equal(fact.field, 'transaction_amount');
  assert.equal(fact.value, '18500');
  assert.equal(fact.evidenceId, 'ev_receipt');
  assert.equal(fact.sourceReference, 'Bank receipt / amount');
  assert.equal(fact.confidence, 0.99);
  assert.equal(fact.provenanceType, 'evidence');
  assert.equal(fact.userConfirmed, false);
});

test('manual fact is auto-confirmed and has no evidence source', () => {
  const fact = createFact({
    field: 'phone_number',
    value: '9000012345',
    provenanceType: 'user_entered',
  });
  assert.equal(fact.provenanceType, 'user_entered');
  assert.equal(fact.userConfirmed, true);
  assert.equal(fact.evidenceId, null);
  assert.equal(isManualFact(fact), true);
});

test('createFact rejects empty field', () => {
  assert.throws(
    () => createFact({ field: '', value: '123', provenanceType: 'user_entered' }),
    { message: /field is required/ }
  );
});

test('createFact rejects empty value (unknown values should be omitted)', () => {
  assert.throws(
    () => createFact({ field: 'transaction_amount', value: '', provenanceType: 'user_entered' }),
    { message: /must not be empty/ }
  );
});

test('createFact rejects invalid provenanceType', () => {
  assert.throws(
    () => createFact({ field: 'x', value: '1', provenanceType: 'ai_hallucinated' }),
    { message: /Invalid provenanceType/ }
  );
});

test('createFact rejects user_entered fact with evidenceId', () => {
  assert.throws(
    () => createFact({ field: 'x', value: '1', evidenceId: 'ev_1', provenanceType: 'user_entered' }),
    { message: /must not claim an evidence source/ }
  );
});

test('createFact rejects evidence fact without evidenceId', () => {
  assert.throws(
    () => createFact({ field: 'x', value: '1', provenanceType: 'evidence' }),
    { message: /must reference an evidenceId/ }
  );
});

test('createFact rejects out-of-range confidence', () => {
  assert.throws(
    () => createFact({ field: 'x', value: '1', evidenceId: 'ev_1', provenanceType: 'evidence', confidence: 1.5 }),
    { message: /Confidence must be/ }
  );
});

// ===========================================================================
// EVENT CREATION
// ===========================================================================

test('event creation produces candidate (unconfirmed) event', () => {
  const event = createEvent({
    timestamp: '2026-08-25T14:08',
    description: 'Payment recorded',
    evidenceIds: ['ev_receipt'],
    confidence: 0.98,
  });
  assert.ok(event.id.startsWith('event_'));
  assert.equal(event.userConfirmed, false);
  assert.deepEqual(event.evidenceIds, ['ev_receipt']);
});

test('event creation rejects missing timestamp', () => {
  assert.throws(
    () => createEvent({ description: 'Test' }),
    { message: /timestamp is required/ }
  );
});

// ===========================================================================
// EVIDENCE CREATION
// ===========================================================================

test('evidence creation validates and sanitizes', () => {
  const ev = createEvidence({
    type: 'Screenshot',
    filename: '../../malicious<file>.png',
    mimeType: 'image/png',
    size: 1000,
    source: 'Uploaded by citizen',
  });
  assert.ok(ev.id.startsWith('ev_'));
  assert.equal(ev.filename, '____malicious_file_.png');
  assert.equal(ev.mimeType, 'image/png');
  assert.equal(ev.integrityFingerprint, null);
  assert.ok(ev.createdAt); // must include creation timestamp
});

test('evidence creation rejects invalid MIME type', () => {
  assert.throws(
    () => createEvidence({ type: 'Screenshot', filename: 'a.exe', mimeType: 'application/x-executable', size: 100, source: 'test' }),
    { message: /not supported/ }
  );
});

test('evidence creation rejects oversized file', () => {
  assert.throws(
    () => createEvidence({ type: 'Screenshot', filename: 'big.png', mimeType: 'image/png', size: MAX_BYTES + 1, source: 'test' }),
    { message: /5 MB/ }
  );
});

// ===========================================================================
// CONTRADICTION DETECTION — matches frontend tests
// ===========================================================================

test('missing required fields produces INCOMPLETE', () => {
  const incident = { description: '', facts: [], contradictions: [] };
  assert.equal(calculateReadiness(incident).state, 'INCOMPLETE');
});

test('complete but unconfirmed evidence produces NEEDS_REVIEW', () => {
  const incident = completeIncident();
  incident.facts[0].userConfirmed = false;
  assert.equal(calculateReadiness(incident).state, 'NEEDS_REVIEW');
});

test('canonical ₹18,500 vs ₹15,500 demo starts NEEDS_REVIEW and blocks submission', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);
  const result = calculateReadiness(incident);
  assert.equal(result.state, 'NEEDS_REVIEW');
  assert.equal(result.canSubmit, false);
});

test('contradiction on transaction_amount has critical severity', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);
  assert.equal(incident.contradictions.length, 1);
  assert.equal(incident.contradictions[0].severity, 'critical');
  assert.equal(incident.contradictions[0].field, 'transaction_amount');
  assert.equal(incident.contradictions[0].status, 'unresolved');
});

test('contradiction on non-critical field has important severity', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('phone_number', '+91 90000 12345', 'phone_a'));
  incident.facts.push(evidenceFact('phone_number', '+91 80000 99999', 'phone_b'));
  deriveContradictions(incident);
  const phoneConflict = incident.contradictions.find(c => c.field === 'phone_number');
  assert.ok(phoneConflict);
  assert.equal(phoneConflict.severity, 'important');
});

test('no contradiction when values normalize to the same string', () => {
  const incident = completeIncident();
  // Same value different case — should not produce a contradiction
  incident.facts.push({ ...evidenceFact('payment_institution', 'demo bank', 'bank_two') });
  deriveContradictions(incident);
  const bankConflict = incident.contradictions.find(c => c.field === 'payment_institution');
  assert.equal(bankConflict, undefined);
});

// ===========================================================================
// CONTRADICTION RESOLUTION — matches frontend tests
// ===========================================================================

test('selecting ₹18,500 rejects ₹15,500 historically and becomes READY after required confirmations', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);

  const conflict = incident.contradictions[0];
  setContradictionResolution(incident, conflict.id, conflict.factIds[0]);
  confirmRequired(incident);

  assert.equal(incident.facts.find(f => f.value === '15500').resolutionDisposition, 'rejected');
  assert.equal(incident.facts.find(f => f.value === '18500').resolutionDisposition, 'selected');
  assert.equal(calculateReadiness(incident).state, 'READY');
});

test('reviewed but unresolved contradiction remains NEEDS_REVIEW and survives JSON persistence', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);
  confirmRequired(incident);
  setContradictionResolution(incident, incident.contradictions[0].id, 'unresolved');

  const restored = JSON.parse(JSON.stringify(incident));
  deriveContradictions(restored);

  assert.equal(restored.contradictions[0].status, 'reviewed_unresolved');
  assert.equal(calculateReadiness(restored).canSubmit, false);
});

test('setContradictionResolution throws for unknown contradiction', () => {
  const incident = completeIncident();
  incident.contradictions = [];
  assert.throws(
    () => setContradictionResolution(incident, 'conflict_nonexistent', 'unresolved'),
    { message: /not found/ }
  );
});

test('setContradictionResolution throws for invalid fact choice', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);
  assert.throws(
    () => setContradictionResolution(incident, incident.contradictions[0].id, 'nonexistent_fact_id'),
    { message: /Choose one/ }
  );
});

// ===========================================================================
// READINESS TRANSITIONS
// ===========================================================================

test('readiness: INCOMPLETE → NEEDS_REVIEW → READY lifecycle', () => {
  // Start empty → INCOMPLETE
  const incident = createIncident();
  assert.equal(calculateReadiness(incident).state, 'INCOMPLETE');

  // Add description and all required facts (unconfirmed evidence) → NEEDS_REVIEW
  incident.description = 'Incident description';
  incident.facts = [
    evidenceFact('transaction_amount', '18500'),
    evidenceFact('transaction_timestamp', '2026-08-25T14:08'),
    evidenceFact('transaction_id', 'DEMO-UTR-1'),
    evidenceFact('payment_institution', 'Demo Bank'),
  ];
  assert.equal(calculateReadiness(incident).state, 'NEEDS_REVIEW');

  // Confirm all required facts → READY
  incident.facts.forEach(f => { f.userConfirmed = true; });
  assert.equal(calculateReadiness(incident).state, 'READY');
  assert.equal(calculateReadiness(incident).canSubmit, true);
});

test('readiness: missing description alone is INCOMPLETE', () => {
  const incident = completeIncident();
  incident.description = '';
  const result = calculateReadiness(incident);
  assert.equal(result.state, 'INCOMPLETE');
  assert.ok(result.missing.includes('incident_description'));
});

test('readiness: rejected facts are excluded from field coverage', () => {
  // Only one transaction_amount fact, but it's rejected → missing
  const incident = completeIncident();
  incident.facts[0].resolutionDisposition = 'rejected';
  const result = calculateReadiness(incident);
  assert.equal(result.state, 'INCOMPLETE');
  assert.ok(result.missing.includes('transaction_amount'));
});

// ===========================================================================
// MANUAL FACT DETECTION — matches frontend test
// ===========================================================================

test('manual facts are explicitly user-entered and have no fabricated fingerprint', () => {
  const manual = {
    field: 'phone_number',
    value: '9000012345',
    provenanceType: 'user_entered',
    evidenceId: null,
    integrityFingerprint: null,
  };
  assert.equal(isManualFact(manual), true);
  assert.equal(manual.integrityFingerprint, null);
});

// ===========================================================================
// REPOSITORY
// ===========================================================================

test('repository: save and get returns deep copy', () => {
  const repo = new InMemoryCaseRepository();
  const incident = createIncident({ description: 'Test' });
  repo.save(incident);

  const retrieved = repo.get(incident.id);
  assert.deepEqual(retrieved, incident);

  // Mutating the retrieved copy must not affect the stored copy
  retrieved.description = 'Mutated';
  const fresh = repo.get(incident.id);
  assert.equal(fresh.description, 'Test');
});

test('repository: get returns null for unknown ID', () => {
  const repo = new InMemoryCaseRepository();
  assert.equal(repo.get('nonexistent'), null);
});

test('repository: delete removes incident', () => {
  const repo = new InMemoryCaseRepository();
  const incident = createIncident();
  repo.save(incident);
  assert.equal(repo.delete(incident.id), true);
  assert.equal(repo.get(incident.id), null);
  assert.equal(repo.delete(incident.id), false);
});

test('repository: list returns all incidents', () => {
  const repo = new InMemoryCaseRepository();
  const a = createIncident({ description: 'A' });
  const b = createIncident({ description: 'B' });
  repo.save(a);
  repo.save(b);
  assert.equal(repo.list().length, 2);
  assert.equal(repo.size, 2);
});

test('repository: save rejects incident without id', () => {
  const repo = new InMemoryCaseRepository();
  assert.throws(() => repo.save({}), { message: /without an id/ });
});

// ===========================================================================
// SERVICE LAYER
// ===========================================================================

test('service: create and retrieve incident', () => {
  const repo = new InMemoryCaseRepository();
  const svc = new IncidentService({ repository: repo });

  const incident = svc.createIncident({ description: 'Test' });
  assert.ok(incident.id);
  assert.equal(incident.description, 'Test');

  const retrieved = svc.getIncident(incident.id);
  assert.deepEqual(retrieved, incident);
});

test('service: update description', () => {
  const repo = new InMemoryCaseRepository();
  const svc = new IncidentService({ repository: repo });
  const incident = svc.createIncident();

  const updated = svc.updateDescription(incident.id, 'New description');
  assert.equal(updated.description, 'New description');
});

test('service: add fact re-derives contradictions', () => {
  const repo = new InMemoryCaseRepository();
  const svc = new IncidentService({ repository: repo });
  const incident = svc.createIncident({ description: 'Test' });

  svc.addFact(incident.id, {
    field: 'transaction_amount',
    value: '18500',
    evidenceId: 'ev_1',
    sourceReference: 'receipt',
    provenanceType: 'evidence',
  });

  svc.addFact(incident.id, {
    field: 'transaction_amount',
    value: '15500',
    evidenceId: 'ev_2',
    sourceReference: 'sms',
    provenanceType: 'evidence',
  });

  const current = svc.getIncident(incident.id);
  assert.equal(current.contradictions.length, 1);
  assert.equal(current.contradictions[0].severity, 'critical');
});

test('service: resolve contradiction persists resolution', () => {
  const repo = new InMemoryCaseRepository();
  const svc = new IncidentService({ repository: repo });
  const incident = svc.createIncident({ description: 'Test' });

  svc.addFact(incident.id, { field: 'transaction_amount', value: '18500', evidenceId: 'ev_1', sourceReference: 'r', provenanceType: 'evidence' });
  svc.addFact(incident.id, { field: 'transaction_amount', value: '15500', evidenceId: 'ev_2', sourceReference: 's', provenanceType: 'evidence' });

  let current = svc.getIncident(incident.id);
  const conflict = current.contradictions[0];
  const chosenFactId = conflict.factIds[0];

  const resolved = svc.resolveContradiction(incident.id, conflict.id, chosenFactId);
  assert.equal(resolved.contradictions[0].status, 'resolved');

  // The selected fact is confirmed, the other is rejected
  const selectedFact = resolved.facts.find(f => f.id === chosenFactId);
  const rejectedFact = resolved.facts.find(f => f.id !== chosenFactId && f.field === 'transaction_amount');
  assert.equal(selectedFact.resolutionDisposition, 'selected');
  assert.equal(selectedFact.userConfirmed, true);
  assert.equal(rejectedFact.resolutionDisposition, 'rejected');
});

test('service: submitted incident cannot be modified', () => {
  const repo = new InMemoryCaseRepository();
  const svc = new IncidentService({ repository: repo });
  const incident = svc.createIncident({ description: 'Test' });

  // Manually mark as submitted in the repo
  const stored = repo.get(incident.id);
  stored.submitted = true;
  repo.save(stored);

  assert.throws(
    () => svc.updateDescription(incident.id, 'Changed'),
    { message: /submitted/ }
  );
});

test('service: getIncident returns null for nonexistent', () => {
  const repo = new InMemoryCaseRepository();
  const svc = new IncidentService({ repository: repo });
  assert.equal(svc.getIncident('nonexistent'), null);
});

test('service: calculateReadiness uses domain rules', () => {
  const repo = new InMemoryCaseRepository();
  const svc = new IncidentService({ repository: repo });
  const incident = svc.createIncident();

  const readiness = svc.calculateReadiness(incident.id);
  assert.equal(readiness.state, 'INCOMPLETE');
  assert.ok(readiness.missing.includes('incident_description'));
});

test('service: add and confirm event', () => {
  const repo = new InMemoryCaseRepository();
  const svc = new IncidentService({ repository: repo });
  const incident = svc.createIncident();

  svc.addEvent(incident.id, {
    timestamp: '2026-08-25T14:08',
    description: 'Payment recorded',
    evidenceIds: ['ev_1'],
    confidence: 0.98,
  });

  let current = svc.getIncident(incident.id);
  assert.equal(current.events.length, 1);
  assert.equal(current.events[0].userConfirmed, false);

  svc.confirmEvent(incident.id, current.events[0].id, true);
  current = svc.getIncident(incident.id);
  assert.equal(current.events[0].userConfirmed, true);
});

test('service: add evidence and remove cascades fact cleanup', async () => {
  const repo = new InMemoryCaseRepository();
  const svc = new IncidentService({ repository: repo });
  const incident = svc.createIncident();

  const withEvidence = svc.addEvidence(incident.id, {
    type: 'Screenshot',
    filename: 'test.png',
    mimeType: 'image/png',
    size: 1000,
    source: 'Uploaded by citizen',
  });
  const evId = withEvidence.evidence[0].id;

  svc.addFact(incident.id, {
    field: 'transaction_amount',
    value: '18500',
    evidenceId: evId,
    sourceReference: 'test',
    provenanceType: 'evidence',
  });

  let current = svc.getIncident(incident.id);
  assert.equal(current.facts.length, 1);

  await svc.removeEvidence(incident.id, evId);
  current = svc.getIncident(incident.id);
  assert.equal(current.evidence.length, 0);
  assert.equal(current.facts.length, 0);
});

// ===========================================================================
// NEW DOMAIN FUNCTIONS
// ===========================================================================

test('deriveEvidenceType maps MIME types to frontend labels', () => {
  assert.equal(deriveEvidenceType('application/pdf'), 'Document');
  assert.equal(deriveEvidenceType('text/plain'), 'Text message');
  assert.equal(deriveEvidenceType('image/png'), 'Screenshot');
  assert.equal(deriveEvidenceType('image/jpeg'), 'Screenshot');
});

test('findDuplicateEvidence returns matching record by fingerprint', () => {
  const incident = {
    evidence: [
      { id: 'ev_1', integrityFingerprint: 'abc123' },
      { id: 'ev_2', integrityFingerprint: 'def456' },
    ],
  };
  const dup = findDuplicateEvidence(incident, 'abc123');
  assert.equal(dup.id, 'ev_1');
});

test('findDuplicateEvidence returns null for no match', () => {
  const incident = { evidence: [{ id: 'ev_1', integrityFingerprint: 'abc123' }] };
  assert.equal(findDuplicateEvidence(incident, 'zzz999'), null);
});

test('findDuplicateEvidence returns null for null fingerprint', () => {
  const incident = { evidence: [{ id: 'ev_1', integrityFingerprint: 'abc123' }] };
  assert.equal(findDuplicateEvidence(incident, null), null);
});
