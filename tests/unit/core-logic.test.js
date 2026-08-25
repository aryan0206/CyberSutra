import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BYTES, calculateReadiness, deriveContradictions, isManualFact, restoreIncident, sanitizeFilename, serializeIncident, setContradictionResolution, sha256Hex, validateUpload } from '../../frontend/core.js';

const evidenceFact = (field, value, id = field) => ({ id, field, value, evidenceId: `ev_${id}`, sourceReference: 'synthetic source', provenanceType: 'evidence', userConfirmed: false });
const completeIncident = () => ({ description: 'Synthetic incident', facts: [evidenceFact('transaction_amount', '18500'), evidenceFact('transaction_timestamp', '2026-08-25T14:08'), evidenceFact('transaction_id', 'DEMO-UTR-1'), evidenceFact('payment_institution', 'Demo Bank')], contradictions: [] });
const confirmRequired = incident => incident.facts.forEach(fact => { if (fact.field !== 'transaction_amount' || fact.resolutionDisposition !== 'rejected') fact.userConfirmed = true; });

test('missing required fields produces INCOMPLETE', () => {
  const incident = { description: '', facts: [], contradictions: [] };
  assert.equal(calculateReadiness(incident).state, 'INCOMPLETE');
});
test('complete but unconfirmed evidence produces NEEDS_REVIEW', () => {
  const incident = completeIncident(); incident.facts[0].userConfirmed = false;
  assert.equal(calculateReadiness(incident).state, 'NEEDS_REVIEW');
});
test('canonical ₹18,500 vs ₹15,500 demo starts NEEDS_REVIEW and blocks submission', () => {
  const incident = completeIncident(); incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two')); deriveContradictions(incident);
  const result = calculateReadiness(incident); assert.equal(result.state, 'NEEDS_REVIEW'); assert.equal(result.canSubmit, false);
});
test('selecting ₹18,500 rejects ₹15,500 historically and becomes READY after required confirmations', () => {
  const incident = completeIncident(); incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two')); deriveContradictions(incident);
  const conflict = incident.contradictions[0]; setContradictionResolution(incident, conflict.id, conflict.factIds[0]);
  confirmRequired(incident);
  assert.equal(incident.facts.find(fact => fact.value === '15500').resolutionDisposition, 'rejected');
  assert.equal(incident.facts.find(fact => fact.value === '18500').resolutionDisposition, 'selected');
  assert.equal(calculateReadiness(incident).state, 'READY');
});
test('reviewed but unresolved contradiction remains NEEDS_REVIEW and survives JSON persistence', () => {
  const incident = completeIncident(); incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two')); deriveContradictions(incident);
  confirmRequired(incident);
  setContradictionResolution(incident, incident.contradictions[0].id, 'unresolved');
  const restored = JSON.parse(JSON.stringify(incident)); deriveContradictions(restored);
  assert.equal(restored.contradictions[0].status, 'reviewed_unresolved'); assert.equal(calculateReadiness(restored).canSubmit, false);
});
test('contradiction resolution and timeline confirmation persist through application serialization', () => {
  const incident = completeIncident(); incident.facts.push(evidenceFact('transaction_amount', '15500', 'amount_two')); incident.events = [{ id: 'event_1', userConfirmed: true }]; incident.evidence = [{ id: 'ev_receipt', integrityFingerprint: 'a'.repeat(64) }]; deriveContradictions(incident);
  confirmRequired(incident);
  setContradictionResolution(incident, incident.contradictions[0].id, incident.contradictions[0].factIds[0]);
  const restored = restoreIncident(serializeIncident(incident));
  assert.equal(restored.contradictions[0].status, 'resolved'); assert.equal(restored.events[0].userConfirmed, true); assert.equal(restored.evidence[0].integrityFingerprint, 'a'.repeat(64));
});
test('upload allowlist, size limit, and filename sanitization are deterministic', () => {
  assert.equal(validateUpload({ type: 'image/png', size: MAX_BYTES }).ok, true);
  assert.equal(validateUpload({ type: 'text/html', size: 1 }).ok, false);
  assert.equal(validateUpload({ type: 'image/png', size: MAX_BYTES + 1 }).ok, false);
  assert.equal(sanitizeFilename('../../bad<script>.png'), '____bad_script_.png');
});
test('manual facts are explicitly user-entered and have no fabricated fingerprint', () => {
  const manual = { field: 'phone_number', value: '9000012345', provenanceType: 'user_entered', evidenceId: null, integrityFingerprint: null };
  assert.equal(isManualFact(manual), true); assert.equal(manual.integrityFingerprint, null);
});
test('SHA-256 is computed from actual bytes and changes when bytes change', { skip: !globalThis.crypto?.subtle }, async () => {
  const abc = new TextEncoder().encode('abc'); const abd = new TextEncoder().encode('abd');
  const first = await sha256Hex(abc); const second = await sha256Hex(abc); const changed = await sha256Hex(abd);
  assert.equal(first, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); assert.equal(first, second); assert.notEqual(first, changed);
});
