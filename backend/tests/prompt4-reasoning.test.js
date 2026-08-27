// backend/tests/prompt4-reasoning.test.js
// Exhaustive tests for the deterministic evidence reasoning engine (Prompt 4).
//
// Covers:
//   - Field-type-aware value normalization
//   - Monetary equivalence and conflict detection
//   - Timestamp equivalence and conflict detection
//   - Transaction ID normalization
//   - Institution name formatting
//   - Phone number normalization
//   - Duplicate values across evidence sources
//   - Mixed manual/evidence-derived facts
//   - Contradiction resolution states
//   - Missing information detection
//   - Readiness state transitions and blockers
//   - Timeline construction with invalid timestamps
//   - ₹18,500 vs ₹15,500 regression

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeForComparison,
  buildTimeline,
  deriveContradictions,
  setContradictionResolution,
  calculateReadiness,
  createFact,
  createEvent,
  createIncident,
  REQUIRED_FIELDS,
  CRITICAL_CONFLICT_FIELDS,
} from '../domain.js';

// ---------------------------------------------------------------------------
// Test helpers
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

const manualFact = (field, value, id = `manual_${field}`) => ({
  id,
  field,
  value,
  evidenceId: null,
  sourceReference: null,
  provenanceType: 'user_entered',
  userConfirmed: true,
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
    if (fact.resolutionDisposition !== 'rejected') {
      fact.userConfirmed = true;
    }
  });

// ===========================================================================
// NORMALIZATION — MONETARY VALUES
// ===========================================================================

test('normalize: ₹18,500 and 18500 are equivalent monetary values', () => {
  const a = normalizeForComparison('transaction_amount', '₹18,500');
  const b = normalizeForComparison('transaction_amount', '18500');
  assert.equal(a, b);
});

test('normalize: 18500.00 and 18500 are equivalent monetary values', () => {
  const a = normalizeForComparison('transaction_amount', '18500.00');
  const b = normalizeForComparison('transaction_amount', '18500');
  assert.equal(a, b);
});

test('normalize: Rs 18,500 and ₹18500 are equivalent monetary values', () => {
  const a = normalizeForComparison('transaction_amount', 'Rs 18,500');
  const b = normalizeForComparison('transaction_amount', '₹18500');
  assert.equal(a, b);
});

test('normalize: INR 18500 and 18500 are equivalent monetary values', () => {
  const a = normalizeForComparison('transaction_amount', 'INR 18500');
  const b = normalizeForComparison('transaction_amount', '18500');
  assert.equal(a, b);
});

test('normalize: 18500 and 15500 are different monetary values', () => {
  const a = normalizeForComparison('transaction_amount', '18500');
  const b = normalizeForComparison('transaction_amount', '15500');
  assert.notEqual(a, b);
});

test('contradiction: equivalent monetary representations do not conflict', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '₹18,500', 'amount_formatted'));
  deriveContradictions(incident);
  const amountConflict = incident.contradictions.find(c => c.field === 'transaction_amount');
  assert.equal(amountConflict, undefined);
});

test('contradiction: genuinely different monetary values conflict', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);
  const conflict = incident.contradictions.find(c => c.field === 'transaction_amount');
  assert.ok(conflict);
  assert.equal(conflict.severity, 'critical');
  assert.equal(conflict.status, 'unresolved');
});

// ===========================================================================
// NORMALIZATION — TIMESTAMPS
// ===========================================================================

test('normalize: 2026-08-25T14:08 and 2026-08-25T14:08:00 are equivalent timestamps', () => {
  const a = normalizeForComparison('transaction_timestamp', '2026-08-25T14:08');
  const b = normalizeForComparison('transaction_timestamp', '2026-08-25T14:08:00');
  assert.equal(a, b);
});

test('normalize: different timestamps are not equivalent', () => {
  const a = normalizeForComparison('transaction_timestamp', '2026-08-25T14:08');
  const b = normalizeForComparison('transaction_timestamp', '2026-08-25T15:30');
  assert.notEqual(a, b);
});

test('contradiction: equivalent timestamps do not conflict', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_timestamp', '2026-08-25T14:08:00', 'ts_two'));
  deriveContradictions(incident);
  const tsConflict = incident.contradictions.find(c => c.field === 'transaction_timestamp');
  assert.equal(tsConflict, undefined);
});

test('contradiction: genuinely different timestamps conflict', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_timestamp', '2026-08-25T15:30', 'ts_two'));
  deriveContradictions(incident);
  const conflict = incident.contradictions.find(c => c.field === 'transaction_timestamp');
  assert.ok(conflict);
  assert.equal(conflict.severity, 'critical');
});

// ===========================================================================
// NORMALIZATION — TRANSACTION IDS
// ===========================================================================

test('normalize: DEMO-UTR-482916 and DEMO UTR 482916 are equivalent transaction IDs', () => {
  const a = normalizeForComparison('transaction_id', 'DEMO-UTR-482916');
  const b = normalizeForComparison('transaction_id', 'DEMO UTR 482916');
  assert.equal(a, b);
});

test('normalize: transaction IDs are case-insensitive', () => {
  const a = normalizeForComparison('transaction_id', 'demo-utr-482916');
  const b = normalizeForComparison('transaction_id', 'DEMO-UTR-482916');
  assert.equal(a, b);
});

test('contradiction: genuinely different transaction IDs conflict', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_id', 'DIFFERENT-UTR-999', 'txid_two'));
  deriveContradictions(incident);
  const conflict = incident.contradictions.find(c => c.field === 'transaction_id');
  assert.ok(conflict);
  assert.equal(conflict.severity, 'critical');
});

test('contradiction: equivalent transaction IDs (formatting only) do not conflict', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_id', 'DEMO UTR 1', 'txid_two'));
  deriveContradictions(incident);
  const conflict = incident.contradictions.find(c => c.field === 'transaction_id');
  assert.equal(conflict, undefined);
});

// ===========================================================================
// NORMALIZATION — INSTITUTION NAMES
// ===========================================================================

test('normalize: institution name with extra whitespace and different case are equivalent', () => {
  const a = normalizeForComparison('payment_institution', '  Demo  Bank  ');
  const b = normalizeForComparison('payment_institution', 'demo bank');
  assert.equal(a, b);
});

test('contradiction: institution names with only formatting differences do not conflict', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('payment_institution', '  demo  bank  ', 'bank_two'));
  deriveContradictions(incident);
  const bankConflict = incident.contradictions.find(c => c.field === 'payment_institution');
  assert.equal(bankConflict, undefined);
});

// ===========================================================================
// NORMALIZATION — PHONE NUMBERS
// ===========================================================================

test('normalize: +91 90000 12345 and +919000012345 are equivalent phone numbers', () => {
  const a = normalizeForComparison('phone_number', '+91 90000 12345');
  const b = normalizeForComparison('phone_number', '+919000012345');
  assert.equal(a, b);
});

test('contradiction: equivalent phone numbers do not conflict', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('phone_number', '+91 90000 12345', 'phone_a'));
  incident.facts.push(evidenceFact('phone_number', '+919000012345', 'phone_b'));
  deriveContradictions(incident);
  const phoneConflict = incident.contradictions.find(c => c.field === 'phone_number');
  assert.equal(phoneConflict, undefined);
});

test('contradiction: genuinely different phone numbers conflict', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('phone_number', '+91 90000 12345', 'phone_a'));
  incident.facts.push(evidenceFact('phone_number', '+91 80000 99999', 'phone_b'));
  deriveContradictions(incident);
  const conflict = incident.contradictions.find(c => c.field === 'phone_number');
  assert.ok(conflict);
  assert.equal(conflict.severity, 'important');
});

// ===========================================================================
// DUPLICATE VALUES — same value from different evidence
// ===========================================================================

test('no contradiction when same value appears in multiple evidence sources', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '18500', 'amount_second_source'));
  deriveContradictions(incident);
  const conflict = incident.contradictions.find(c => c.field === 'transaction_amount');
  assert.equal(conflict, undefined);
});

// ===========================================================================
// MIXED MANUAL AND EVIDENCE-DERIVED FACTS
// ===========================================================================

test('no contradiction when manual and evidence facts have same normalized value', () => {
  const incident = completeIncident();
  incident.facts.push(manualFact('transaction_amount', '₹18,500', 'manual_amount'));
  deriveContradictions(incident);
  const conflict = incident.contradictions.find(c => c.field === 'transaction_amount');
  assert.equal(conflict, undefined);
});

test('contradiction when manual and evidence facts have different values', () => {
  const incident = completeIncident();
  incident.facts.push(manualFact('transaction_amount', '15500', 'manual_amount'));
  deriveContradictions(incident);
  const conflict = incident.contradictions.find(c => c.field === 'transaction_amount');
  assert.ok(conflict);
  assert.equal(conflict.severity, 'critical');
});

// ===========================================================================
// CONTRADICTION RESOLUTION STATES
// ===========================================================================

test('resolved contradiction: selected fact has disposition selected, others rejected', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);

  const conflict = incident.contradictions[0];
  setContradictionResolution(incident, conflict.id, conflict.factIds[0]);

  const selected = incident.facts.find(f => f.value === '18500');
  const rejected = incident.facts.find(f => f.value === '15500');
  assert.equal(selected.resolutionDisposition, 'selected');
  assert.equal(selected.userConfirmed, true);
  assert.equal(rejected.resolutionDisposition, 'rejected');
  assert.equal(conflict.status, 'resolved');
});

test('reviewed_unresolved: preserves conflicting values and provenance', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);

  const conflict = incident.contradictions[0];
  setContradictionResolution(incident, conflict.id, 'unresolved');

  assert.equal(conflict.status, 'reviewed_unresolved');
  // Both facts still exist with their values and provenance
  assert.equal(incident.facts.find(f => f.value === '18500').evidenceId, 'ev_transaction_amount');
  assert.equal(incident.facts.find(f => f.value === '15500').evidenceId, 'ev_amount_two');
  // Neither has resolutionDisposition
  assert.equal(incident.facts.find(f => f.value === '18500').resolutionDisposition, undefined);
  assert.equal(incident.facts.find(f => f.value === '15500').resolutionDisposition, undefined);
});

test('rejected facts are excluded from readiness field coverage', () => {
  const incident = completeIncident();
  // Only one transaction_amount fact, mark it rejected
  incident.facts[0].resolutionDisposition = 'rejected';
  const result = calculateReadiness(incident);
  assert.equal(result.state, 'INCOMPLETE');
  assert.ok(result.missing.includes('transaction_amount'));
});

// ===========================================================================
// CONFIRMED EVIDENCE-DERIVED FACTS
// ===========================================================================

test('confirmed evidence facts transition from NEEDS_REVIEW to READY', () => {
  const incident = completeIncident();
  // Initially all unconfirmed → NEEDS_REVIEW
  assert.equal(calculateReadiness(incident).state, 'NEEDS_REVIEW');

  // Confirm all → READY
  confirmRequired(incident);
  assert.equal(calculateReadiness(incident).state, 'READY');
  assert.equal(calculateReadiness(incident).canSubmit, true);
});

// ===========================================================================
// MISSING REQUIRED INFORMATION
// ===========================================================================

test('missing information: all 5 required fields detected when absent', () => {
  const incident = { description: '', facts: [], contradictions: [] };
  const result = calculateReadiness(incident);
  assert.equal(result.state, 'INCOMPLETE');
  assert.ok(result.missing.includes('incident_description'));
  assert.ok(result.missing.includes('transaction_amount'));
  assert.ok(result.missing.includes('transaction_timestamp'));
  assert.ok(result.missing.includes('transaction_id'));
  assert.ok(result.missing.includes('payment_institution'));
});

test('missing information: description alone triggers INCOMPLETE', () => {
  const incident = completeIncident();
  incident.description = '';
  const result = calculateReadiness(incident);
  assert.equal(result.state, 'INCOMPLETE');
  assert.ok(result.missing.includes('incident_description'));
});

test('missing information: single missing fact field triggers INCOMPLETE', () => {
  const incident = completeIncident();
  // Remove the payment_institution fact
  incident.facts = incident.facts.filter(f => f.field !== 'payment_institution');
  const result = calculateReadiness(incident);
  assert.equal(result.state, 'INCOMPLETE');
  assert.ok(result.missing.includes('payment_institution'));
});

// ===========================================================================
// READINESS STATE TRANSITIONS
// ===========================================================================

test('readiness lifecycle: INCOMPLETE → NEEDS_REVIEW → READY', () => {
  // Start empty → INCOMPLETE
  const incident = createIncident();
  assert.equal(calculateReadiness(incident).state, 'INCOMPLETE');

  // Add description + all required facts (unconfirmed) → NEEDS_REVIEW
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

// ===========================================================================
// READINESS — BLOCKERS
// ===========================================================================

test('readiness blockers: INCOMPLETE lists missing fields', () => {
  const incident = { description: '', facts: [], contradictions: [] };
  const result = calculateReadiness(incident);
  assert.ok(Array.isArray(result.blockers));
  assert.ok(result.blockers.length > 0);
  assert.ok(result.blockers[0].includes('Missing required information'));
});

test('readiness blockers: NEEDS_REVIEW lists critical contradictions', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);
  confirmRequired(incident);
  const result = calculateReadiness(incident);
  assert.equal(result.state, 'NEEDS_REVIEW');
  assert.ok(result.blockers.some(b => b.includes('Critical contradiction on transaction_amount')));
});

test('readiness blockers: NEEDS_REVIEW lists unconfirmed evidence facts', () => {
  const incident = completeIncident();
  // All unconfirmed
  const result = calculateReadiness(incident);
  assert.equal(result.state, 'NEEDS_REVIEW');
  assert.ok(result.blockers.some(b => b.includes('requires user confirmation')));
});

test('readiness blockers: READY has empty blockers', () => {
  const incident = completeIncident();
  confirmRequired(incident);
  const result = calculateReadiness(incident);
  assert.equal(result.state, 'READY');
  assert.deepEqual(result.blockers, []);
});

// ===========================================================================
// REGRESSION — ₹18,500 vs ₹15,500
// ===========================================================================

test('REGRESSION: ₹18,500 vs ₹15,500 produces critical contradiction', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);

  assert.equal(incident.contradictions.length, 1);
  assert.equal(incident.contradictions[0].field, 'transaction_amount');
  assert.equal(incident.contradictions[0].severity, 'critical');
  assert.equal(incident.contradictions[0].status, 'unresolved');
});

test('REGRESSION: ₹18,500 vs ₹15,500 blocks READY/submission', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);
  const result = calculateReadiness(incident);
  assert.equal(result.canSubmit, false);
  assert.equal(result.criticalOpen, true);
});

test('REGRESSION: backend never auto-selects between ₹18,500 and ₹15,500', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);

  // After derivation, both facts are still present with no disposition
  const amount18 = incident.facts.find(f => f.value === '18500');
  const amount15 = incident.facts.find(f => f.value === '15500');
  assert.equal(amount18.resolutionDisposition, undefined);
  assert.equal(amount15.resolutionDisposition, undefined);

  // The contradiction is unresolved
  assert.equal(incident.contradictions[0].status, 'unresolved');
  assert.equal(incident.contradictions[0].resolution, null);
});

test('REGRESSION: ₹18,500 vs ₹15,500 resolution persists through serialization', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);
  confirmRequired(incident);

  // Resolve by selecting 18500
  const conflict = incident.contradictions[0];
  setContradictionResolution(incident, conflict.id, conflict.factIds[0]);

  // Serialize and restore
  const restored = JSON.parse(JSON.stringify(incident));
  deriveContradictions(restored);

  assert.equal(restored.contradictions[0].status, 'resolved');
  assert.equal(calculateReadiness(restored).state, 'READY');
  assert.equal(calculateReadiness(restored).canSubmit, true);
});

// ===========================================================================
// TIMELINE — buildTimeline
// ===========================================================================

test('buildTimeline sorts events chronologically', () => {
  const incident = {
    events: [
      { id: 'e2', timestamp: '2026-08-25T15:00', description: 'Later', evidenceIds: [], confidence: 0.9, userConfirmed: false },
      { id: 'e1', timestamp: '2026-08-25T14:00', description: 'Earlier', evidenceIds: [], confidence: 0.9, userConfirmed: false },
    ],
  };
  const timeline = buildTimeline(incident);
  assert.equal(timeline[0].id, 'e1');
  assert.equal(timeline[1].id, 'e2');
});

test('buildTimeline preserves evidence references and confidence', () => {
  const incident = {
    events: [
      { id: 'e1', timestamp: '2026-08-25T14:08', description: 'Payment', evidenceIds: ['ev_1', 'ev_2'], confidence: 0.98, userConfirmed: true },
    ],
  };
  const timeline = buildTimeline(incident);
  assert.deepEqual(timeline[0].evidenceIds, ['ev_1', 'ev_2']);
  assert.equal(timeline[0].confidence, 0.98);
  assert.equal(timeline[0].userConfirmed, true);
});

test('buildTimeline places invalid timestamps at the end without fabricating order', () => {
  const incident = {
    events: [
      { id: 'invalid1', timestamp: 'not-a-date', description: 'Bad timestamp', evidenceIds: [], confidence: 0.5, userConfirmed: false },
      { id: 'e1', timestamp: '2026-08-25T14:00', description: 'Good', evidenceIds: [], confidence: 0.9, userConfirmed: false },
      { id: 'invalid2', timestamp: 'also-not-a-date', description: 'Another bad', evidenceIds: [], confidence: 0.5, userConfirmed: false },
    ],
  };
  const timeline = buildTimeline(incident);
  // Valid first
  assert.equal(timeline[0].id, 'e1');
  // Invalid in insertion order at the end
  assert.equal(timeline[1].id, 'invalid1');
  assert.equal(timeline[2].id, 'invalid2');
  // Original timestamps preserved (not fabricated)
  assert.equal(timeline[1].timestamp, 'not-a-date');
  assert.equal(timeline[2].timestamp, 'also-not-a-date');
});

test('buildTimeline does not mutate the incident', () => {
  const events = [
    { id: 'e2', timestamp: '2026-08-25T15:00', description: 'B', evidenceIds: [], confidence: 0.9, userConfirmed: false },
    { id: 'e1', timestamp: '2026-08-25T14:00', description: 'A', evidenceIds: [], confidence: 0.9, userConfirmed: false },
  ];
  const incident = { events: [...events] };
  buildTimeline(incident);
  // Original order preserved
  assert.equal(incident.events[0].id, 'e2');
  assert.equal(incident.events[1].id, 'e1');
});

test('buildTimeline handles empty events array', () => {
  const incident = { events: [] };
  const timeline = buildTimeline(incident);
  assert.deepEqual(timeline, []);
});

test('buildTimeline distinguishes candidate vs confirmed events', () => {
  const incident = {
    events: [
      { id: 'e1', timestamp: '2026-08-25T14:08', description: 'Confirmed', evidenceIds: [], confidence: 0.98, userConfirmed: true },
      { id: 'e2', timestamp: '2026-08-25T14:10', description: 'Candidate', evidenceIds: [], confidence: 0.7, userConfirmed: false },
    ],
  };
  const timeline = buildTimeline(incident);
  assert.equal(timeline[0].userConfirmed, true);
  assert.equal(timeline[1].userConfirmed, false);
});

// ===========================================================================
// NORMALIZATION — URL FIELDS
// ===========================================================================

test('normalize: URLs are case-insensitive and trailing slash stripped', () => {
  const a = normalizeForComparison('suspicious_url', 'https://Verify-KYC.Example/Secure/');
  const b = normalizeForComparison('suspicious_url', 'https://verify-kyc.example/secure');
  assert.equal(a, b);
});

// ===========================================================================
// NORMALIZATION — preserves original values
// ===========================================================================

test('deriveContradictions preserves original fact values in contradiction record', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);
  const conflict = incident.contradictions[0];
  // Original values preserved, not normalized
  assert.ok(conflict.values.includes('18500'));
  assert.ok(conflict.values.includes('15500'));
});

test('deriveContradictions preserves originating evidence references', () => {
  const incident = completeIncident();
  incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two'));
  deriveContradictions(incident);
  const conflict = incident.contradictions[0];
  assert.ok(conflict.evidenceIds.includes('ev_transaction_amount'));
  assert.ok(conflict.evidenceIds.includes('ev_amount_two'));
});
