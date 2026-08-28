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

export function requireOnlyFields(body, allowed) {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new ApiError(ErrorCode.VALIDATION_ERROR, `Unexpected field: ${key}.`, 400, { field: key });
    }
  }
}

export function requireSafeId(value, field, expectedPrefix = null) {
  const id = requireString(value, field, 100);
  const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const allowed = expectedPrefix === 'contradiction'
    ? /^conflict_[a-z_]{1,100}$/
    : expectedPrefix
      ? new RegExp(`^${expectedPrefix}_${uuidPattern}$`, 'i')
      : new RegExp(`^(?:case|ev|fact|event)_${uuidPattern}$`, 'i');
  if (!allowed.test(id)) {
    throw new ApiError(ErrorCode.VALIDATION_ERROR, `${field} is not a valid identifier.`, 400, { field });
  }
  return id;
}

/** Validate a route ID against the exact server-generated identifier type. */
export function validateRouteId(value, field, expectedPrefix) {
  return requireSafeId(value, field, expectedPrefix);
}

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
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(s);
  if (!match) {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `${field} must be a valid ISO 8601 timestamp (e.g. 2026-08-25T14:08).`,
      400,
      { field }
    );
  }
  const [, year, month, day, hour, minute, second = '0'] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const h = Number(hour), min = Number(minute), sec = Number(second);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth || h > 23 || min > 59 || sec > 59) {
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

/** Validate POST /cases and POST /incidents bodies. */
export function validateCaseCreate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(ErrorCode.VALIDATION_ERROR, 'Request body must be an object.', 400);
  }
  requireOnlyFields(body, new Set(['description']));
  return { description: optionalString(body.description, 'description', 3000) };
}

/**
 * Validate PATCH /cases/:caseId body.
 * Only description is updatable via PATCH.
 */
export function validateCaseUpdate(body) {
  if (!body || typeof body !== 'object') {
    throw new ApiError(ErrorCode.VALIDATION_ERROR, 'Request body is required.', 400);
  }
  requireOnlyFields(body, new Set(['description']));
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
  requireOnlyFields(body, new Set(['field', 'value', 'provenanceType', 'evidenceId', 'sourceReference', 'confidence']));
  const field = requireString(body.field, 'field', 100);
  const value = requireString(body.value, 'value', 500);
  const provenanceType = requireEnum(body.provenanceType, PROVENANCE_TYPES, 'provenanceType');

  const result = { field, value, provenanceType };

  if (provenanceType === 'evidence') {
    result.evidenceId = requireSafeId(body.evidenceId, 'evidenceId', 'ev');
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
  requireOnlyFields(body, new Set(['value']));
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
  requireOnlyFields(body, new Set(['confirmed']));
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
  requireOnlyFields(body, new Set(['timestamp', 'description', 'evidenceIds', 'confidence']));
  const timestamp = requireTimestamp(body.timestamp, 'timestamp');
  const description = requireString(body.description, 'description', 1000);
  const evidenceIds = body.evidenceIds == null ? [] : body.evidenceIds;
  if (!Array.isArray(evidenceIds) || evidenceIds.length > 20) {
    throw new ApiError(ErrorCode.VALIDATION_ERROR, 'evidenceIds must be an array of at most 20 identifiers.', 400, { field: 'evidenceIds' });
  }
  // Validate each evidenceId is a string
  for (const eid of evidenceIds) {
    requireSafeId(eid, 'evidenceIds', 'ev');
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
  requireOnlyFields(body, new Set(['confirmed']));
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
  requireOnlyFields(body, new Set(['choice']));
  return {
    choice: requireString(body.choice, 'choice', 200),
  };
}
