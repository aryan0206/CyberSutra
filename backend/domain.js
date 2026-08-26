// backend/domain.js
// Canonical domain types, constants, and deterministic domain logic.
//
// This module is the authoritative source of truth for CyberSutra's domain rules.
// It preserves every semantic present in the frontend (frontend/core.js) while
// providing stricter validation and clearer structure for backend use.
//
// Domain rules implemented here:
//   - Evidence validation (MIME type allowlist, size limit, filename sanitization)
//   - Fact creation with provenance
//   - Contradiction derivation (deterministic, never auto-resolves)
//   - Contradiction resolution (explicit source-value selection or unresolved)
//   - Readiness calculation (INCOMPLETE / NEEDS_REVIEW / READY)
//   - Incident lifecycle validation

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants — exactly match frontend/core.js
// ---------------------------------------------------------------------------

export const MAX_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'application/pdf',
  'text/plain',
]);

export const REQUIRED_FIELDS = [
  'incident_description',
  'transaction_amount',
  'transaction_timestamp',
  'transaction_id',
  'payment_institution',
];

export const CRITICAL_CONFLICT_FIELDS = new Set([
  'transaction_amount',
  'transaction_id',
  'transaction_timestamp',
]);

/** Valid provenance types for facts. */
export const PROVENANCE_TYPES = new Set(['evidence', 'user_entered']);

/** Valid contradiction statuses. */
export const CONTRADICTION_STATUSES = new Set(['unresolved', 'resolved', 'reviewed_unresolved']);

/** Valid readiness states. */
export const READINESS_STATES = new Set(['INCOMPLETE', 'NEEDS_REVIEW', 'READY']);

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/** Generate a prefixed unique ID. Matches frontend id() convention. */
export function generateId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Evidence validation — matches frontend validateUpload / sanitizeFilename
// ---------------------------------------------------------------------------

/**
 * Sanitize a user-provided filename.
 * Removes path traversal, script injection, and limits length.
 * Semantically identical to frontend sanitizeFilename.
 */
export function sanitizeFilename(name) {
  return String(name ?? '')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'evidence';
}

/**
 * Validate an evidence upload's metadata.
 * Semantically identical to frontend validateUpload.
 * @param {{ type: string, size: number }} meta
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateUpload({ type, size }) {
  if (!ACCEPTED_MIME_TYPES.has(type)) {
    return { ok: false, reason: 'This file type is not supported. Use PNG, JPEG, PDF, or plain text.' };
  }
  if (!Number.isFinite(size) || size < 0 || size > MAX_BYTES) {
    return { ok: false, reason: 'This file is larger than the 5 MB demo limit.' };
  }
  return { ok: true };
}

/**
 * Derive a user-friendly evidence type label from a MIME type.
 * Matches the frontend app.js convention for uploaded files.
 * @param {string} mimeType
 * @returns {string}
 */
export function deriveEvidenceType(mimeType) {
  if (mimeType === 'application/pdf') return 'Document';
  if (mimeType === 'text/plain') return 'Text message';
  return 'Screenshot';
}

// ---------------------------------------------------------------------------
// Domain model constructors
// ---------------------------------------------------------------------------

/**
 * Create a new Evidence record.
 * @param {{ type: string, filename: string, mimeType: string, size: number, source: string, integrityFingerprint: string|null, processingStatus: string }} params
 * @returns {object} Evidence record
 */
export function createEvidence({ type, filename, mimeType, size, source, integrityFingerprint = null, processingStatus = 'Metadata retained; extraction unavailable' }) {
  const validation = validateUpload({ type: mimeType, size });
  if (!validation.ok) {
    throw new Error(`Evidence validation failed: ${validation.reason}`);
  }
  return {
    id: generateId('ev'),
    type,
    filename: sanitizeFilename(filename),
    mimeType,
    size,
    source,
    integrityFingerprint,
    processingStatus,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create a new Fact with full provenance.
 * Manual facts (provenanceType === 'user_entered') are auto-confirmed
 * and must not claim an evidence source.
 * Evidence-derived facts must reference an evidenceId and sourceReference.
 *
 * @param {{ field: string, value: string, evidenceId: string|null, sourceReference: string|null, confidence: number, provenanceType: 'evidence'|'user_entered' }} params
 * @returns {object} Fact record
 */
export function createFact({ field, value, evidenceId = null, sourceReference = null, confidence = 0.9, provenanceType = 'evidence' }) {
  if (!field || typeof field !== 'string') {
    throw new Error('Fact field is required and must be a string.');
  }
  if (value == null || String(value).trim() === '') {
    throw new Error('Fact value must not be empty. Unknown values should be omitted, not fabricated.');
  }
  if (!PROVENANCE_TYPES.has(provenanceType)) {
    throw new Error(`Invalid provenanceType: ${provenanceType}. Must be one of: ${[...PROVENANCE_TYPES].join(', ')}.`);
  }
  if (provenanceType === 'user_entered' && evidenceId != null) {
    throw new Error('A user-entered fact must not claim an evidence source.');
  }
  if (provenanceType === 'evidence' && !evidenceId) {
    throw new Error('An evidence-derived fact must reference an evidenceId.');
  }
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    throw new Error('Confidence must be a number between 0 and 1.');
  }

  return {
    id: generateId('fact'),
    field,
    value: String(value),
    evidenceId,
    sourceReference,
    confidence,
    provenanceType,
    userConfirmed: provenanceType === 'user_entered',
    // resolutionDisposition is only set during contradiction resolution
  };
}

/**
 * Create a new Event (timeline node).
 * Events begin as candidates (userConfirmed: false).
 *
 * @param {{ timestamp: string, description: string, evidenceIds: string[], confidence: number }} params
 * @returns {object} Event record
 */
export function createEvent({ timestamp, description, evidenceIds = [], confidence = 0.9 }) {
  if (!timestamp || typeof timestamp !== 'string') {
    throw new Error('Event timestamp is required.');
  }
  if (!description || typeof description !== 'string') {
    throw new Error('Event description is required.');
  }
  if (!Array.isArray(evidenceIds)) {
    throw new Error('Event evidenceIds must be an array.');
  }
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    throw new Error('Confidence must be a number between 0 and 1.');
  }
  return {
    id: generateId('event'),
    timestamp,
    description,
    evidenceIds,
    confidence,
    userConfirmed: false,
  };
}

/**
 * Create a new Incident (case).
 * Incidents begin empty with no submission state.
 *
 * @param {{ description?: string }} params
 * @returns {object} Incident record
 */
export function createIncident({ description = '' } = {}) {
  return {
    id: generateId('case'),
    description,
    evidence: [],
    facts: [],
    events: [],
    contradictions: [],
    submitted: false,
    acknowledgement: null,
  };
}

// ---------------------------------------------------------------------------
// Deterministic domain logic
// ---------------------------------------------------------------------------

/**
 * Derive contradictions from the current facts on an incident.
 * Preserves previous resolution status when a contradiction is re-derived.
 * Never auto-resolves — the backend does not choose a conflicting value.
 *
 * Semantically identical to frontend deriveContradictions.
 *
 * @param {object} incident - Incident record (mutated in place)
 * @returns {object} The same incident, with contradictions updated
 */
export function deriveContradictions(incident) {
  const previous = new Map(
    (incident.contradictions || []).map(item => [item.id, item])
  );

  const groups = {};
  incident.facts.forEach(item => {
    if (item.value) {
      (groups[item.field] ||= []).push(item);
    }
  });

  incident.contradictions = Object.entries(groups).flatMap(([field, facts]) => {
    const normalized = [...new Set(facts.map(item => item.value.trim().toLowerCase()))];
    if (normalized.length < 2) return [];

    const id = `conflict_${field}`;
    const old = previous.get(id);

    return [{
      id,
      field,
      factIds: facts.map(item => item.id),
      values: facts.map(item => item.value),
      evidenceIds: facts.map(item => item.evidenceId).filter(Boolean),
      severity: CRITICAL_CONFLICT_FIELDS.has(field) ? 'critical' : 'important',
      status: old?.status || 'unresolved',
      resolution: old?.resolution || null,
    }];
  });

  return incident;
}

/**
 * Resolve a specific contradiction by explicit user choice.
 *
 * choice === 'unresolved': marks the contradiction as reviewed but unresolvable.
 * choice === <factId>: selects that fact's value, rejects others.
 *
 * The backend never chooses automatically — it only records the user's decision.
 *
 * Semantically identical to frontend setContradictionResolution.
 *
 * @param {object} incident
 * @param {string} contradictionId
 * @param {string} choice - A factId or 'unresolved'
 * @returns {object} The resolved contradiction record
 */
export function setContradictionResolution(incident, contradictionId, choice) {
  const conflict = incident.contradictions.find(item => item.id === contradictionId);
  if (!conflict) {
    throw new Error('Contradiction not found.');
  }

  if (choice === 'unresolved') {
    conflict.factIds.forEach(factId => {
      const fact = incident.facts.find(item => item.id === factId);
      if (fact) delete fact.resolutionDisposition;
    });
    conflict.status = 'reviewed_unresolved';
    conflict.resolution = { choice: 'unresolved', label: 'Unable to verify — left unresolved' };
    return conflict;
  }

  const selected = incident.facts.find(
    item => item.id === choice && conflict.factIds.includes(item.id)
  );
  if (!selected) {
    throw new Error('Choose one of the conflicting source values.');
  }

  conflict.factIds.forEach(factId => {
    const fact = incident.facts.find(item => item.id === factId);
    if (!fact) return;
    fact.resolutionDisposition = fact.id === selected.id ? 'selected' : 'rejected';
  });

  // An explicit source selection is a confirmation that this value is the effective one.
  selected.userConfirmed = true;

  conflict.status = 'resolved';
  conflict.resolution = {
    choice: 'source_value',
    chosenFactId: selected.id,
    evidenceId: selected.evidenceId,
    value: selected.value,
  };

  return conflict;
}

/**
 * Calculate the deterministic readiness state of an incident.
 *
 * INCOMPLETE: required information is missing.
 * NEEDS_REVIEW: critical contradiction unresolved OR required evidence-derived values unconfirmed.
 * READY: all requirements met.
 *
 * This is pure computation — it never modifies the incident.
 * Semantically identical to frontend calculateReadiness.
 *
 * @param {object} incident
 * @returns {{ state: string, missing: string[], criticalOpen: boolean, unconfirmedRequired: boolean, canSubmit: boolean }}
 */
export function calculateReadiness(incident) {
  const effectiveFacts = incident.facts.filter(
    item => item.value && item.resolutionDisposition !== 'rejected'
  );
  const fields = new Set(effectiveFacts.map(item => item.field));

  const missing = REQUIRED_FIELDS.filter(
    field => field !== 'incident_description' && !fields.has(field)
  );
  if (!incident.description?.trim()) {
    missing.unshift('incident_description');
  }

  const criticalOpen = incident.contradictions.some(
    item => item.severity === 'critical' && item.status !== 'resolved'
  );

  const unconfirmedRequired = effectiveFacts.some(
    item => REQUIRED_FIELDS.includes(item.field) &&
            item.provenanceType === 'evidence' &&
            !item.userConfirmed
  );

  const state = missing.length
    ? 'INCOMPLETE'
    : (criticalOpen || unconfirmedRequired)
      ? 'NEEDS_REVIEW'
      : 'READY';

  return { state, missing, criticalOpen, unconfirmedRequired, canSubmit: state === 'READY' };
}

/**
 * Check whether a fact is manually entered (has no evidence provenance).
 * @param {object} fact
 * @returns {boolean}
 */
export function isManualFact(fact) {
  return fact.provenanceType === 'user_entered';
}

/**
 * Find an existing evidence record with the same SHA-256 fingerprint.
 * Returns null if no duplicate exists or if fingerprint is null.
 * This is deterministic duplicate detection — it never silently merges records.
 *
 * @param {object} incident
 * @param {string|null} fingerprint - SHA-256 hex digest
 * @returns {object|null} The matching evidence record, or null
 */
export function findDuplicateEvidence(incident, fingerprint) {
  if (!fingerprint) return null;
  return incident.evidence.find(ev => ev.integrityFingerprint === fingerprint) || null;
}
