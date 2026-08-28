// backend/submission-gateway.js
// Adapter-based submission architecture.
//
// Defines a generic SubmissionGateway interface and provides
// MockSubmissionGateway — a deterministic simulated adapter.
//
// IMPORTANT:
// - This module must NEVER import fetch, axios, http, https, or any
//   outbound networking mechanism.
// - The mock adapter must NEVER make real network calls.
// - Mock references must be unmistakably synthetic.
// - A future authorized integration replaces the adapter, not the
//   case logic.

// ---------------------------------------------------------------------------
// SubmissionGateway — generic interface
// ---------------------------------------------------------------------------

/**
 * Abstract submission gateway interface.
 *
 * Any concrete adapter must implement:
 *   submit(report)   → { reference, timestamp, status, provider, simulated }
 *   getStatus(ref)   → { reference, status, provider, simulated }
 *
 * The domain layer depends only on this interface.
 */
export class SubmissionGateway {
  /**
   * Submit a structured case report to the external system.
   * @param {object} report - The assembled report (from assembleReport).
   * @returns {object} Structured acknowledgement.
   */
  submit(report) {
    throw new Error('SubmissionGateway.submit() must be implemented by a concrete adapter.');
  }

  /**
   * Query the status of a previously submitted report.
   * @param {string} reference - The reference ID returned by submit().
   * @returns {object} Status response.
   */
  getStatus(reference) {
    throw new Error('SubmissionGateway.getStatus() must be implemented by a concrete adapter.');
  }
}

// ---------------------------------------------------------------------------
// MockSubmissionGateway — deterministic simulated adapter
// ---------------------------------------------------------------------------

/**
 * Mock submission gateway for prototype/demo purposes.
 *
 * - Generates unmistakably synthetic reference IDs.
 * - Never makes network calls.
 * - Never imports networking libraries.
 * - Explicitly marks all responses as simulated.
 * - Deterministic: same case produces consistent behavior.
 */
export class MockSubmissionGateway extends SubmissionGateway {
  constructor() {
    super();
    this._counter = 0;
    this._submissions = new Map();
  }

  /**
   * Generate a synthetic reference ID.
   *
   * Format: MOCK-NCRP-YYYYMMDD-NNNNNN
   * Example: MOCK-NCRP-20260828-000001
   *
   * The "MOCK-" prefix makes it unmistakably non-governmental.
   */
  _generateReference() {
    this._counter++;
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');
    const seq = String(this._counter).padStart(6, '0');
    return `MOCK-NCRP-${date}-${seq}`;
  }

  /**
   * Simulate submission of a case report.
   *
   * @param {object} report - The assembled report.
   * @returns {object} Structured mock acknowledgement.
   */
  submit(report) {
    if (!report || !report.caseId) {
      throw new Error('MockSubmissionGateway: report with caseId is required.');
    }

    const reference = this._generateReference();
    const timestamp = new Date().toISOString();

    const acknowledgement = {
      reference,
      timestamp,
      status: 'submitted',
      provider: 'MockSubmissionGateway',
      simulated: true,
      note: 'This is a simulated submission for prototype/demo purposes only. '
          + 'No data was transmitted to any government system.',
    };

    // Store for getStatus lookups
    this._submissions.set(reference, {
      ...acknowledgement,
      caseId: report.caseId,
    });

    return acknowledgement;
  }

  /**
   * Query the status of a mock submission.
   *
   * @param {string} reference - The mock reference ID.
   * @returns {object} Status response.
   */
  getStatus(reference) {
    const record = this._submissions.get(reference);
    if (!record) {
      return {
        reference,
        status: 'not_found',
        provider: 'MockSubmissionGateway',
        simulated: true,
      };
    }

    return {
      reference: record.reference,
      status: record.status,
      provider: record.provider,
      simulated: true,
      caseId: record.caseId,
      submittedAt: record.timestamp,
    };
  }
}
