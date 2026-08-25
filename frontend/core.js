export const MAX_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf', 'text/plain']);
export const REQUIRED_FIELDS = ['incident_description', 'transaction_amount', 'transaction_timestamp', 'transaction_id', 'payment_institution'];
export const CRITICAL_CONFLICT_FIELDS = new Set(['transaction_amount', 'transaction_id', 'transaction_timestamp']);

export function sanitizeFilename(name) {
  return String(name ?? '').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\.{2,}/g, '_').replace(/^\.+/, '').slice(0, 120) || 'evidence';
}

export function validateUpload({ type, size }) {
  if (!ACCEPTED_MIME_TYPES.has(type)) return { ok: false, reason: 'This file type is not supported. Use PNG, JPEG, PDF, or plain text.' };
  if (!Number.isFinite(size) || size < 0 || size > MAX_BYTES) return { ok: false, reason: 'This file is larger than the 5 MB demo limit.' };
  return { ok: true };
}

export async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable in this browser.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function deriveContradictions(incident) {
  const previous = new Map((incident.contradictions || []).map(item => [item.id, item]));
  const groups = {};
  incident.facts.forEach(item => { if (item.value) (groups[item.field] ||= []).push(item); });
  incident.contradictions = Object.entries(groups).flatMap(([field, facts]) => {
    const normalized = [...new Set(facts.map(item => item.value.trim().toLowerCase()))];
    if (normalized.length < 2) return [];
    const id = `conflict_${field}`;
    const old = previous.get(id);
    return [{
      id, field, factIds: facts.map(item => item.id), values: facts.map(item => item.value),
      evidenceIds: facts.map(item => item.evidenceId).filter(Boolean),
      severity: CRITICAL_CONFLICT_FIELDS.has(field) ? 'critical' : 'important',
      status: old?.status || 'unresolved', resolution: old?.resolution || null
    }];
  });
  return incident;
}

export function setContradictionResolution(incident, contradictionId, choice) {
  const conflict = incident.contradictions.find(item => item.id === contradictionId);
  if (!conflict) throw new Error('Contradiction not found.');
  if (choice === 'unresolved') {
    conflict.factIds.forEach(factId => {
      const fact = incident.facts.find(item => item.id === factId);
      if (fact) delete fact.resolutionDisposition;
    });
    conflict.status = 'reviewed_unresolved';
    conflict.resolution = { choice: 'unresolved', label: 'Unable to verify — left unresolved' };
    return conflict;
  }
  const selected = incident.facts.find(item => item.id === choice && conflict.factIds.includes(item.id));
  if (!selected) throw new Error('Choose one of the conflicting source values.');
  conflict.factIds.forEach(factId => {
    const fact = incident.facts.find(item => item.id === factId);
    if (!fact) return;
    fact.resolutionDisposition = fact.id === selected.id ? 'selected' : 'rejected';
  });
  // An explicit source selection is a confirmation that this value is the effective one.
  selected.userConfirmed = true;
  conflict.status = 'resolved';
  conflict.resolution = { choice: 'source_value', chosenFactId: selected.id, evidenceId: selected.evidenceId, value: selected.value };
  return conflict;
}

export function calculateReadiness(incident) {
  const effectiveFacts = incident.facts.filter(item => item.value && item.resolutionDisposition !== 'rejected');
  const fields = new Set(effectiveFacts.map(item => item.field));
  const missing = REQUIRED_FIELDS.filter(field => field !== 'incident_description' && !fields.has(field));
  if (!incident.description?.trim()) missing.unshift('incident_description');
  const criticalOpen = incident.contradictions.some(item => item.severity === 'critical' && item.status !== 'resolved');
  const unconfirmedRequired = effectiveFacts.some(item => REQUIRED_FIELDS.includes(item.field) && item.provenanceType === 'evidence' && !item.userConfirmed);
  const state = missing.length ? 'INCOMPLETE' : (criticalOpen || unconfirmedRequired) ? 'NEEDS_REVIEW' : 'READY';
  return { state, missing, criticalOpen, unconfirmedRequired, canSubmit: state === 'READY' };
}

export function isManualFact(fact) { return fact.provenanceType === 'user_entered'; }

export function serializeIncident(incident) { return JSON.stringify(incident); }
export function restoreIncident(serialized) { return JSON.parse(serialized); }
