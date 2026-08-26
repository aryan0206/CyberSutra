// backend/validation.js
// Input validation functions for the cases API.
//
// Every endpoint validates body structure, types, string lengths,
// identifiers, timestamps, enum values, and referenced IDs.
//
// Validators throw ApiError with VALIDATION_ERROR code on failure.

import { ApiError, ErrorCode } from './errors.js';
import { ACCEPTED_MIME_TYPES, PROVENANCE_TYPES } from './domain.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Assert a value is a non-empty trimmed string within a max length.
 * @param {*} value
 * @param {string} field
 * @param {number} maxLength
 * @returns {string} The trimmed string
 */
export function requireString(value, field, maxLength = 3000) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `${field} is required and must be a non-empty string.`,
      400,
      { field }
    );
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `${field} must not exceed ${maxLength} characters.`,
      400,
      { field }
    );
  }
  return trimmed;
}

/**
 * Assert a value is a string (may be empty) within a max length.
 * @param {*} value
 * @param {string} field
 * @param {number} maxLength
 * @returns {string}
 */
export function optionalString(value, field, maxLength = 3000) {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `${field} must be a string.`,
      400,
      { field }
    );
  }
  if (value.length > maxLength) {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `${field} must not exceed ${maxLength} characters.`,
      400,
      { field }
    );
  }
  return value;
}

/**
 * Assert a value is a boolean.
 * @param {*} value
 * @param {string} field
 * @returns {boolean}
 */
export function requireBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `${field} must be a boolean.`,
      400,
      { field }
    );
  }
  return value;
}

/**
 * Assert a value is a number in range [min, max].
 * @param {*} value
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function requireNumber(value, field, min = 0, max = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `${field} must be a number between ${min} and ${max}.`,
      400,
      { field }
    );
  }
  return value;
}

/**
 * Assert a value is one of a set of allowed strings.
 * @param {*} value
 * @param {Set<string>} allowed
 * @param {string} field
 * @returns {string}
 */
export function requireEnum(value, allowed, field) {
  if (!allowed.has(value)) {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `${field} must be one of: ${[...allowed].join(', ')}.`,
      400,
      { field }
    );
  }
  return value;
}

/**
 * Assert a value looks like a valid ISO 8601 timestamp.
 * Does not perform calendar validation, just basic format checking.
 * @param {*} value
 * @param {string} field
 * @returns {string}
 */
export function requireTimestamp(value, field) {
  const s = requireString(value, field, 30);
  // Accept ISO-like formats: YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS etc.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `${field} must be a valid ISO 8601 timestamp (e.g. 2026-08-25T14:08).`,
      400,
      { field }
    );
  }
  // Reject clearly invalid dates
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `${field} is not a valid date.`,
      400,
      { field }
    );
  }
  return s;
}

// ---------------------------------------------------------------------------
// Composite validators
// ---------------------------------------------------------------------------

/**
 * Validate PATCH /cases/:caseId body.
 * Only description is updatable via PATCH.
 */
export function validateCaseUpdate(body) {
  if (!body || typeof body !== 'object') {
    throw new ApiError(ErrorCode.VALIDATION_ERROR, 'Request body is required.', 400);
  }
  return {
    description: optionalString(body.description, 'description', 3000),
  };
}

/**
 * Validate POST /cases/:caseId/facts body.
 */
export function validateFactCreate(body) {
  if (!body || typeof body !== 'object') {
    throw new ApiError(ErrorCode.VALIDATION_ERROR, 'Request body is required.', 400);
  }
  const field = requireString(body.field, 'field', 100);
  const value = requireString(body.value, 'value', 500);
  const provenanceType = requireEnum(body.provenanceType, PROVENANCE_TYPES, 'provenanceType');

  const result = { field, value, provenanceType };

  if (provenanceType === 'evidence') {
    result.evidenceId = requireString(body.evidenceId, 'evidenceId', 200);
    result.sourceReference = requireString(body.sourceReference, 'sourceReference', 500);
    result.confidence = body.confidence != null
      ? requireNumber(body.confidence, 'confidence', 0, 1)
      : 0.9;
  } else {
    // user_entered facts must not claim evidence
    if (body.evidenceId != null) {
      throw new ApiError(
        ErrorCode.VALIDATION_ERROR,
        'A user-entered fact must not claim an evidence source.',
        400,
        { field: 'evidenceId' }
      );
    }
    result.evidenceId = null;
    result.sourceReference = null;
    result.confidence = 1;
  }

  return result;
}

/**
 * Validate PATCH /cases/:caseId/facts/:factId body.
 * Only value is updatable. Re-deriving contradictions is automatic.
 */
export function validateFactUpdate(body) {
  if (!body || typeof body !== 'object') {
    throw new ApiError(ErrorCode.VALIDATION_ERROR, 'Request body is required.', 400);
  }
  return {
    value: requireString(body.value, 'value', 500),
  };
}

/**
 * Validate POST /cases/:caseId/facts/:factId/confirm body.
 */
export function validateFactConfirm(body) {
  if (!body || typeof body !== 'object') {
    throw new ApiError(ErrorCode.VALIDATION_ERROR, 'Request body is required.', 400);
  }
  return {
    confirmed: requireBoolean(body.confirmed, 'confirmed'),
  };
}

/**
 * Validate POST /cases/:caseId/events body.
 */
export function validateEventCreate(body) {
  if (!body || typeof body !== 'object') {
    throw new ApiError(ErrorCode.VALIDATION_ERROR, 'Request body is required.', 400);
  }
  const timestamp = requireTimestamp(body.timestamp, 'timestamp');
  const description = requireString(body.description, 'description', 1000);
  const evidenceIds = Array.isArray(body.evidenceIds) ? body.evidenceIds : [];
  // Validate each evidenceId is a string
  for (const eid of evidenceIds) {
    if (typeof eid !== 'string' || eid.trim().length === 0) {
      throw new ApiError(
        ErrorCode.VALIDATION_ERROR,
        'Each evidenceId must be a non-empty string.',
        400,
        { field: 'evidenceIds' }
      );
    }
  }
  const confidence = body.confidence != null
    ? requireNumber(body.confidence, 'confidence', 0, 1)
    : 0.9;

  return { timestamp, description, evidenceIds, confidence };
}

/**
 * Validate POST /cases/:caseId/events/:eventId/confirm body.
 */
export function validateEventConfirm(body) {
  if (!body || typeof body !== 'object') {
    throw new ApiError(ErrorCode.VALIDATION_ERROR, 'Request body is required.', 400);
  }
  return {
    confirmed: requireBoolean(body.confirmed, 'confirmed'),
  };
}

/**
 * Validate POST /cases/:caseId/contradictions/:contradictionId/resolve body.
 */
export function validateContradictionResolve(body) {
  if (!body || typeof body !== 'object') {
    throw new ApiError(ErrorCode.VALIDATION_ERROR, 'Request body is required.', 400);
  }
  return {
    choice: requireString(body.choice, 'choice', 200),
  };
}
