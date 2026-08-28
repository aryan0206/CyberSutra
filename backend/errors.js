// backend/errors.js
// Structured API error class and stable error codes.
//
// Every API error response has the shape:
//   { code: string, message: string, field?: string, details?: any }
//
// Error codes are stable strings. Messages are human-readable.
// Stack traces are never exposed in API responses.

/**
 * Stable error codes for machine-readable API responses.
 * Each code is a constant string that clients can match on.
 */
export const ErrorCode = Object.freeze({
  // Lifecycle
  CASE_NOT_FOUND:          'CASE_NOT_FOUND',
  CASE_SUBMITTED:          'CASE_SUBMITTED',

  // Evidence
  EVIDENCE_NOT_FOUND:      'EVIDENCE_NOT_FOUND',
  DUPLICATE_EVIDENCE:      'DUPLICATE_EVIDENCE',
  UNSUPPORTED_FILE_TYPE:   'UNSUPPORTED_FILE_TYPE',
  FILE_TOO_LARGE:          'FILE_TOO_LARGE',
  NO_FILE_PROVIDED:        'NO_FILE_PROVIDED',

  // Facts
  FACT_NOT_FOUND:          'FACT_NOT_FOUND',

  // Events
  EVENT_NOT_FOUND:         'EVENT_NOT_FOUND',

  // Contradictions
  CONTRADICTION_NOT_FOUND: 'CONTRADICTION_NOT_FOUND',
  INVALID_RESOLUTION:      'INVALID_RESOLUTION',

  // Validation
  VALIDATION_ERROR:        'VALIDATION_ERROR',

  // Authorization
  UNAUTHORIZED:            'UNAUTHORIZED',

  // Cross-case isolation
  CROSS_CASE_REFERENCE:    'CROSS_CASE_REFERENCE',

  // Submission
  SUBMISSION_NOT_READY:    'SUBMISSION_NOT_READY',
  ALREADY_SUBMITTED:       'ALREADY_SUBMITTED',

  // Generic
  INTERNAL_ERROR:          'INTERNAL_ERROR',
});

/**
 * Structured API error.
 * Thrown by service/route code and caught by the central error handler.
 */
export class ApiError extends Error {
  /**
   * @param {string} code   — One of ErrorCode values
   * @param {string} message — Human-readable explanation
   * @param {number} status  — HTTP status code
   * @param {{ field?: string, details?: any }} [context]
   */
  constructor(code, message, status, context = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.field = context.field || null;
    this.details = context.details || null;
  }

  /** Serialize to a JSON-safe API response body. No stack traces. */
  toJSON() {
    const body = { code: this.code, message: this.message };
    if (this.field) body.field = this.field;
    if (this.details) body.details = this.details;
    return body;
  }
}
