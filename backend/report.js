// backend/report.js
// Deterministic report assembly service.
//
// This module assembles a structured, review-ready report from the
// authoritative case state. It does NOT use machine learning, LLMs,
// or external AI. It consumes existing domain functions — it never
// duplicates business logic.
//
// Report generation is read-only: it never mutates the case.
// For identical case state, repeated calls produce equivalent output.

import {
  deriveContradictions,
  calculateReadiness,
  buildTimeline,
  REQUIRED_FIELDS,
} from './domain.js';

/**
 * Assemble a deterministic structured report from authoritative case state.
 *
 * @param {object} incident - Deep clone of the authoritative case object.
 *                            Must already be loaded from the repository
 *                            (i.e. a deep copy, not a reference).
 * @returns {object} The structured report — safe for JSON serialization.
 */
export function assembleReport(incident) {
  // --- Step 1: Derive current contradictions (idempotent) ----
  // We operate on a deep clone so the original case is never mutated.
  deriveContradictions(incident);

  // --- Step 2: Compute authoritative readiness --
  const readiness = calculateReadiness(incident);

  // --- Step 3: Build deterministic timeline --
  const timeline = buildTimeline(incident);

  // --- Step 4: Assemble evidence inventory --
  const evidence = incident.evidence.map(ev => ({
    id: ev.id,
    type: ev.type,
    filename: ev.filename,
    mimeType: ev.mimeType,
    size: ev.size,
    source: ev.source,
    integrityFingerprint: ev.integrityFingerprint,
    processingStatus: ev.processingStatus,
    createdAt: ev.createdAt,
  }));

  // --- Step 5: Assemble facts with full provenance --
  const facts = incident.facts.map(f => {
    const entry = {
      id: f.id,
      field: f.field,
      value: f.value,
      provenanceType: f.provenanceType,
      userConfirmed: f.userConfirmed,
      confidence: f.confidence,
    };
    if (f.provenanceType === 'evidence') {
      entry.evidenceId = f.evidenceId;
      entry.sourceReference = f.sourceReference;
    }
    if (f.resolutionDisposition) {
      entry.resolutionDisposition = f.resolutionDisposition;
    }
    return entry;
  });

  // --- Step 6: Assemble contradictions --
  const contradictions = incident.contradictions.map(c => ({
    id: c.id,
    field: c.field,
    factIds: c.factIds,
    values: c.values,
    evidenceIds: c.evidenceIds,
    severity: c.severity,
    status: c.status,
    resolution: c.resolution,
  }));

  // --- Step 7: Extract resolutions for resolved contradictions --
  const resolutions = contradictions
    .filter(c => c.status === 'resolved' || c.status === 'reviewed_unresolved')
    .map(c => ({
      contradictionId: c.id,
      field: c.field,
      status: c.status,
      resolution: c.resolution,
    }));

  // --- Step 8: Missing information --
  // Reuse the authoritative readiness computation.
  // Distinguish missing from present fields.
  const effectiveFacts = incident.facts.filter(
    f => f.value && f.resolutionDisposition !== 'rejected'
  );
  const coveredFields = new Set(effectiveFacts.map(f => f.field));

  const missingInformation = REQUIRED_FIELDS.map(field => {
    if (field === 'incident_description') {
      const present = !!incident.description?.trim();
      return { field, present, source: present ? 'incident_description' : null };
    }
    const present = coveredFields.has(field);
    return { field, present, source: present ? 'facts' : null };
  }).filter(entry => !entry.present)
    .map(entry => entry.field);

  // --- Step 9: Review status --
  const reviewStatus = {
    confirmedFacts: facts.filter(f => f.userConfirmed).map(f => f.id),
    unconfirmedFacts: facts.filter(f => !f.userConfirmed && f.resolutionDisposition !== 'rejected').map(f => f.id),
    resolvedContradictions: contradictions.filter(c => c.status === 'resolved').map(c => c.id),
    unresolvedContradictions: contradictions.filter(c => c.status === 'unresolved').map(c => c.id),
    reviewedUnresolvedContradictions: contradictions.filter(c => c.status === 'reviewed_unresolved').map(c => c.id),
    rejectedFacts: facts.filter(f => f.resolutionDisposition === 'rejected').map(f => f.id),
  };

  // --- Step 10: Submission status --
  const submissionStatus = {
    submitted: !!incident.submitted,
    acknowledgement: incident.acknowledgement || null,
  };

  // --- Assemble the report --
  return {
    caseId: incident.id,
    incident: {
      description: incident.description || '',
    },
    evidence,
    facts,
    timeline,
    contradictions,
    resolutions,
    missingInformation,
    readiness,
    reviewStatus,
    submissionStatus,
  };
}
