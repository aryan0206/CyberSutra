// backend/service.js
// Domain service layer — orchestrates domain operations on incidents.
//
// This service sits between the API layer and the domain/repository.
// It enforces validated state transitions and ensures the domain rules
// (from domain.js) are applied authoritatively.

import {
  createIncident,
  createFact,
  createEvidence,
  createEvent,
  deriveContradictions,
  setContradictionResolution,
  calculateReadiness,
  deriveEvidenceType,
  findDuplicateEvidence,
  sanitizeFilename,
  validateUpload,
} from './domain.js';
import { assembleReport } from './report.js';
import { ApiError, ErrorCode } from './errors.js';

export class IncidentService {
  /**
   * @param {{ repository: import('./repository.js').InMemoryCaseRepository, evidenceStore?: import('./evidence-store.js').EvidenceFileStore, submissionGateway?: import('./submission-gateway.js').SubmissionGateway }} deps
   */
  constructor({ repository, evidenceStore = null, submissionGateway = null }) {
    this.repository = repository;
    this.evidenceStore = evidenceStore;
    this.submissionGateway = submissionGateway;
  }

  // -----------------------------------------------------------------------
  // Incident lifecycle
  // -----------------------------------------------------------------------

  /**
   * Create a new incident.
   * @param {{ description?: string }} params
   * @returns {object} The created incident
   */
  createIncident({ description = '' } = {}) {
    const incident = createIncident({ description });
    this.repository.save(incident);
    return this.repository.get(incident.id);
  }

  /**
   * Retrieve an incident by ID.
   * @param {string} id
   * @returns {object|null}
   */
  getIncident(id) {
    return this.repository.get(id);
  }

  /**
   * Update the incident description.
   * Submitted incidents cannot be modified.
   * @param {string} id
   * @param {string} description
   * @returns {object} Updated incident
   */
  updateDescription(id, description) {
    const incident = this._mustLoad(id);
    this._mustNotBeSubmitted(incident);
    incident.description = String(description ?? '');
    this.repository.save(incident);
    return this.repository.get(id);
  }

  // -----------------------------------------------------------------------
  // Evidence management
  // -----------------------------------------------------------------------

  /**
   * Add evidence metadata to an incident (without file storage).
   * Used for synthetic/demo evidence where no file upload occurs.
   * @param {string} incidentId
   * @param {object} evidenceParams - Parameters for createEvidence
   * @returns {object} Updated incident
   */
  addEvidence(incidentId, evidenceParams) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    const evidence = createEvidence(evidenceParams);
    incident.evidence.push(evidence);
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  /**
   * Upload evidence: validate, fingerprint, detect duplicates, store file, persist metadata.
   *
   * This is the primary evidence ingestion method for real uploads.
   * It performs server-side validation, SHA-256 fingerprinting, and
   * deterministic duplicate detection before persisting.
   *
   * @param {string} incidentId
   * @param {Buffer} fileBuffer - Raw file bytes
   * @param {{ originalFilename: string, mimeType: string }} meta
   * @returns {Promise<{ evidence?: object, duplicate?: object }>}
   */
  async uploadEvidence(incidentId, fileBuffer, { originalFilename, mimeType }) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);

    if (!this.evidenceStore) {
      throw new Error('Evidence file store is not configured.');
    }

    // Validate MIME type and size on the server (defense in depth)
    const validation = validateUpload({ type: mimeType, size: fileBuffer.length });
    if (!validation.ok) {
      throw new Error(`Evidence validation failed: ${validation.reason}`);
    }

    // Compute server-side SHA-256 fingerprint
    const integrityFingerprint = this.evidenceStore.computeFingerprint(fileBuffer);

    // Deterministic duplicate detection by fingerprint
    const existingDuplicate = findDuplicateEvidence(incident, integrityFingerprint);
    if (existingDuplicate) {
      return {
        evidence: null,
        duplicate: {
          existingEvidenceId: existingDuplicate.id,
          fingerprint: integrityFingerprint,
          message: 'An evidence record with the same file fingerprint already exists in this case.',
        },
      };
    }

    // Create evidence record with server-generated ID and sanitized filename
    const evidence = createEvidence({
      type: deriveEvidenceType(mimeType),
      filename: sanitizeFilename(originalFilename),
      mimeType,
      size: fileBuffer.length,
      source: 'Uploaded by citizen',
      integrityFingerprint,
      processingStatus: 'Metadata retained; extraction unavailable',
    });

    // Store file to disk using server-generated safe path
    try {
      await this.evidenceStore.store(evidence.id, fileBuffer);
    } catch (storeErr) {
      // If storage fails, do not persist the evidence record
      throw new Error(`Evidence storage failed: ${storeErr.message}`);
    }

    // Persist evidence metadata on the incident
    incident.evidence.push(evidence);
    this.repository.save(incident);

    return { evidence, duplicate: null };
  }

  /**
   * Remove evidence, any linked facts, and the stored file.
   * Re-derives contradictions after removal.
   * @param {string} incidentId
   * @param {string} evidenceId
   * @returns {Promise<object>} Updated incident
   */
  async removeEvidence(incidentId, evidenceId) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);

    // Delete stored file if evidence store is available
    if (this.evidenceStore) {
      await this.evidenceStore.remove(evidenceId);
    }

    incident.evidence = incident.evidence.filter(item => item.id !== evidenceId);
    incident.facts = incident.facts.filter(item => item.evidenceId !== evidenceId);
    deriveContradictions(incident);
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  // -----------------------------------------------------------------------
  // Fact management
  // -----------------------------------------------------------------------

  /**
   * Add a fact with provenance to an incident, then re-derive contradictions.
   * @param {string} incidentId
   * @param {object} factParams - Parameters for createFact
   * @returns {object} Updated incident
   */
  addFact(incidentId, factParams) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    const fact = createFact(factParams);
    incident.facts.push(fact);
    deriveContradictions(incident);
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  /**
   * Confirm or unconfirm a fact.
   * @param {string} incidentId
   * @param {string} factId
   * @param {boolean} confirmed
   * @returns {object} Updated incident
   */
  confirmFact(incidentId, factId, confirmed) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    const fact = incident.facts.find(item => item.id === factId);
    if (!fact) throw new Error('Fact not found.');
    fact.userConfirmed = !!confirmed;
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  /**
   * Update a fact's value and re-derive contradictions.
   * Only value is mutable. Provenance and evidenceId are immutable.
   * @param {string} incidentId
   * @param {string} factId
   * @param {string} newValue
   * @returns {object} Updated incident
   */
  updateFact(incidentId, factId, newValue) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    const fact = incident.facts.find(item => item.id === factId);
    if (!fact) throw new Error('Fact not found.');
    fact.value = String(newValue);
    // If a contradiction was previously resolved and the value changed,
    // clear the user's confirmation so they must re-review.
    if (fact.resolutionDisposition) {
      delete fact.resolutionDisposition;
      fact.userConfirmed = fact.provenanceType === 'user_entered';
    }
    deriveContradictions(incident);
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  // -----------------------------------------------------------------------
  // Event (timeline) management
  // -----------------------------------------------------------------------

  /**
   * Add a timeline event to an incident.
   * @param {string} incidentId
   * @param {object} eventParams - Parameters for createEvent
   * @returns {object} Updated incident
   */
  addEvent(incidentId, eventParams) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    const event = createEvent(eventParams);
    incident.events.push(event);
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  /**
   * Confirm or unconfirm a timeline event.
   * @param {string} incidentId
   * @param {string} eventId
   * @param {boolean} confirmed
   * @returns {object} Updated incident
   */
  confirmEvent(incidentId, eventId, confirmed) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    const event = incident.events.find(item => item.id === eventId);
    if (!event) throw new Error('Event not found.');
    event.userConfirmed = !!confirmed;
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  // -----------------------------------------------------------------------
  // Contradiction resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve a contradiction by explicit user choice.
   * @param {string} incidentId
   * @param {string} contradictionId
   * @param {string} choice - A factId or 'unresolved'
   * @returns {object} Updated incident
   */
  resolveContradiction(incidentId, contradictionId, choice) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    setContradictionResolution(incident, contradictionId, choice);
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  // -----------------------------------------------------------------------
  // Readiness
  // -----------------------------------------------------------------------

  /**
   * Calculate the current readiness of an incident.
   * Pure computation — does not modify the incident.
   * @param {string} incidentId
   * @returns {{ state: string, missing: string[], criticalOpen: boolean, unconfirmedRequired: boolean, canSubmit: boolean }}
   */
  calculateReadiness(incidentId) {
    const incident = this._mustLoad(incidentId);
    return calculateReadiness(incident);
  }

  // -----------------------------------------------------------------------
  // Report generation
  // -----------------------------------------------------------------------

  /**
   * Generate a deterministic structured report from authoritative case state.
   * Read-only — does not mutate the persisted case.
   * @param {string} incidentId
   * @returns {object} The structured report
   */
  generateReport(incidentId) {
    // _mustLoad returns a deep clone from the repository,
    // so assembleReport cannot mutate the persisted case.
    const incident = this._mustLoad(incidentId);
    return assembleReport(incident);
  }

  // -----------------------------------------------------------------------
  // Submission
  // -----------------------------------------------------------------------

  /**
   * Submit a case through the submission gateway.
   *
   * Flow:
   *   1. Load the authoritative case state
   *   2. Reject if already submitted (idempotent: return existing ack)
   *   3. Calculate readiness server-side — never trust client values
   *   4. Reject if not READY
   *   5. Generate report
   *   6. Delegate to submissionGateway.submit(report)
   *   7. Persist submitted=true + acknowledgement on the case
   *   8. Return the acknowledgement
   *
   * @param {string} incidentId
   * @returns {object} The structured acknowledgement from the gateway
   */
  submitCase(incidentId) {
    const incident = this._mustLoad(incidentId);

    // Idempotent: if already submitted, return existing acknowledgement
    if (incident.submitted && incident.acknowledgement) {
      return {
        acknowledgement: incident.acknowledgement,
        alreadySubmitted: true,
      };
    }

    // Authoritative readiness check — NEVER trust client-supplied readiness
    deriveContradictions(incident);
    const readiness = calculateReadiness(incident);

    if (readiness.state !== 'READY') {
      throw new ApiError(
        ErrorCode.SUBMISSION_NOT_READY,
        `Case cannot be submitted: readiness state is ${readiness.state}.`,
        422,
        {
          details: {
            state: readiness.state,
            blockers: readiness.blockers,
            missing: readiness.missing,
            criticalOpen: readiness.criticalOpen,
            unconfirmedRequired: readiness.unconfirmedRequired,
          },
        },
      );
    }

    if (!this.submissionGateway) {
      throw new ApiError(
        ErrorCode.INTERNAL_ERROR,
        'No submission gateway configured.',
        500,
      );
    }

    // Generate the authoritative report for submission
    const report = assembleReport(JSON.parse(JSON.stringify(incident)));

    // Delegate to the gateway
    const acknowledgement = this.submissionGateway.submit(report);

    // Persist submission state
    incident.submitted = true;
    incident.acknowledgement = acknowledgement;
    this.repository.save(incident);

    return {
      acknowledgement,
      alreadySubmitted: false,
    };
  }

  /**
   * Query the status of a submission via the gateway.
   * @param {string} reference - The submission reference ID
   * @returns {object} Status from the gateway
   */
  getSubmissionStatus(reference) {
    if (!this.submissionGateway) {
      throw new ApiError(
        ErrorCode.INTERNAL_ERROR,
        'No submission gateway configured.',
        500,
      );
    }
    return this.submissionGateway.getStatus(reference);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Load an incident or throw if not found. */
  _mustLoad(id) {
    const incident = this.repository.get(id);
    if (!incident) throw new Error(`Incident ${id} not found.`);
    return incident;
  }

  /** Prevent modification of submitted incidents. */
  _mustNotBeSubmitted(incident) {
    if (incident.submitted) {
      throw new Error('Cannot modify a submitted incident.');
    }
  }

  /**
   * Validate that the provided token matches the case's caseToken.
   * This is a minimal MVP session-binding mechanism, not production auth.
   * @param {string} caseId
   * @param {string|null|undefined} token
   * @returns {object} The loaded incident
   */
  validateCaseToken(caseId, token) {
    const incident = this._mustLoad(caseId);
    if (!incident.caseToken || incident.caseToken !== token) {
      throw new Error('Unauthorized: invalid case token.');
    }
    return incident;
  }
}
