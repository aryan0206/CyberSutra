// backend/routes/cases.js
// Complete case lifecycle REST API.
//
// This router implements the coherent case lifecycle:
//   create → describe → evidence → facts → timeline → contradictions → readiness
//
// Authorization: Minimal case-owner binding via X-Case-Token header.
//   - POST /cases returns a caseToken that must be sent on all subsequent requests.
//   - This is NOT production authentication. It prevents casual ID guessing.
//
// Derived state: The backend always recomputes contradictions and readiness.
//   The frontend must NOT send contradictions, severity, readiness, or canSubmit.
//   Those are computed server-side on every mutation and on every read.

import { Router } from 'express';
import multer from 'multer';
import { ApiError, ErrorCode } from '../errors.js';
import {
  MAX_BYTES,
  ACCEPTED_MIME_TYPES,
  deriveContradictions,
  calculateReadiness,
  buildTimeline,
} from '../domain.js';
import {
  validateCaseUpdate,
  validateFactCreate,
  validateFactUpdate,
  validateFactConfirm,
  validateEventCreate,
  validateEventConfirm,
  validateContradictionResolve,
} from '../validation.js';

// ---------------------------------------------------------------------------
// Multer config — identical to the existing evidence router
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_BYTES,
    files: 1,
    fields: 5,
    fieldSize: 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new ApiError(
        ErrorCode.UNSUPPORTED_FILE_TYPE,
        'This file type is not supported. Use PNG, JPEG, PDF, or plain text.',
        400
      );
      cb(err);
    }
  },
});

// ---------------------------------------------------------------------------
// Middleware: case token authorization
// ---------------------------------------------------------------------------

export function requireCaseToken(service) {
  return (req, _res, next) => {
    const caseId = req.params.caseId || req.params.incidentId;
    const token = req.headers['x-case-token'];
    try {
      service.validateCaseToken(caseId, token);
      next();
    } catch (err) {
      if (err.message.includes('not found')) {
        next(new ApiError(ErrorCode.CASE_NOT_FOUND, `Case ${caseId} not found.`, 404));
      } else {
        next(new ApiError(ErrorCode.UNAUTHORIZED, 'Invalid or missing case token.', 403));
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Helper: strip caseToken from incident before sending to client
// ---------------------------------------------------------------------------

export function sanitizeIncident(incident) {
  if (!incident) return incident;
  const { caseToken, ...safe } = incident;
  return safe;
}

// ---------------------------------------------------------------------------
// Helper: validate that evidence IDs belong to this case
// ---------------------------------------------------------------------------

function validateEvidenceRefs(incident, evidenceIds) {
  const caseEvidenceIds = new Set(incident.evidence.map(e => e.id));
  for (const eid of evidenceIds) {
    if (!caseEvidenceIds.has(eid)) {
      throw new ApiError(
        ErrorCode.CROSS_CASE_REFERENCE,
        `Evidence ${eid} does not belong to this case.`,
        400,
        { field: 'evidenceId', details: { invalidId: eid } }
      );
    }
  }
}

// ===========================================================================
// Router factory
// ===========================================================================

/**
 * Create the cases API router.
 * @param {import('../service.js').IncidentService} service
 * @returns {import('express').Router}
 */
export function createCasesRouter(service) {
  const router = Router();
  const auth = requireCaseToken(service);

  // -----------------------------------------------------------------------
  // POST /api/cases — create a new case
  // No auth required (this is case creation).
  // -----------------------------------------------------------------------
  router.post('/cases', (req, res, next) => {
    try {
      const body = req.body || {};
      const description = typeof body.description === 'string'
        ? body.description.slice(0, 3000)
        : '';
      const incident = service.createIncident({ description });
      // Return the caseToken to the client — they must send it on all future requests.
      // This is the only time caseToken is exposed.
      res.status(201).json({
        incident: sanitizeIncident(incident),
        caseToken: incident.caseToken,
      });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cases/:caseId — retrieve case with computed state
  // -----------------------------------------------------------------------
  router.get('/cases/:caseId', auth, (req, res, next) => {
    try {
      const incident = service.getIncident(req.params.caseId);
      if (!incident) {
        throw new ApiError(ErrorCode.CASE_NOT_FOUND, 'Case not found.', 404);
      }
      // Always recompute derived state
      deriveContradictions(incident);
      const readiness = calculateReadiness(incident);
      res.json({
        incident: sanitizeIncident(incident),
        readiness,
      });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // PATCH /api/cases/:caseId — update case description
  // -----------------------------------------------------------------------
  router.patch('/cases/:caseId', auth, (req, res, next) => {
    try {
      const { description } = validateCaseUpdate(req.body);
      const updated = service.updateDescription(req.params.caseId, description);
      const readiness = calculateReadiness(updated);
      res.json({
        incident: sanitizeIncident(updated),
        readiness,
      });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cases/:caseId/evidence — upload evidence file
  // -----------------------------------------------------------------------
  router.post('/cases/:caseId/evidence', auth, upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ApiError(ErrorCode.NO_FILE_PROVIDED, 'No file provided.', 400);
      }
      if (!req.file.buffer || req.file.buffer.length === 0) {
        throw new ApiError(ErrorCode.VALIDATION_ERROR, 'Uploaded file is empty.', 400);
      }

      const result = await service.uploadEvidence(req.params.caseId, req.file.buffer, {
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
      });

      if (result.duplicate) {
        return res.status(409).json({
          code: ErrorCode.DUPLICATE_EVIDENCE,
          evidence: null,
          duplicate: result.duplicate,
        });
      }

      res.status(201).json({ evidence: result.evidence, duplicate: null });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cases/:caseId/evidence — list all evidence
  // -----------------------------------------------------------------------
  router.get('/cases/:caseId/evidence', auth, (req, res, next) => {
    try {
      const incident = service.getIncident(req.params.caseId);
      if (!incident) {
        throw new ApiError(ErrorCode.CASE_NOT_FOUND, 'Case not found.', 404);
      }
      res.json({ evidence: incident.evidence });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /api/cases/:caseId/evidence/:evidenceId — remove evidence
  // -----------------------------------------------------------------------
  router.delete('/cases/:caseId/evidence/:evidenceId', auth, async (req, res, next) => {
    try {
      const incident = service.getIncident(req.params.caseId);
      if (!incident) {
        throw new ApiError(ErrorCode.CASE_NOT_FOUND, 'Case not found.', 404);
      }
      const ev = incident.evidence.find(e => e.id === req.params.evidenceId);
      if (!ev) {
        throw new ApiError(ErrorCode.EVIDENCE_NOT_FOUND, 'Evidence not found.', 404);
      }

      const updated = await service.removeEvidence(req.params.caseId, req.params.evidenceId);
      const readiness = calculateReadiness(updated);
      res.json({ incident: sanitizeIncident(updated), readiness });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cases/:caseId/facts — add a fact
  // -----------------------------------------------------------------------
  router.post('/cases/:caseId/facts', auth, (req, res, next) => {
    try {
      const factParams = validateFactCreate(req.body);

      // Validate evidence reference belongs to this case
      if (factParams.evidenceId) {
        const incident = service.getIncident(req.params.caseId);
        validateEvidenceRefs(incident, [factParams.evidenceId]);
      }

      const updated = service.addFact(req.params.caseId, factParams);
      const readiness = calculateReadiness(updated);
      res.status(201).json({
        incident: sanitizeIncident(updated),
        readiness,
      });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // PATCH /api/cases/:caseId/facts/:factId — update a fact's value
  // -----------------------------------------------------------------------
  router.patch('/cases/:caseId/facts/:factId', auth, (req, res, next) => {
    try {
      const { value } = validateFactUpdate(req.body);

      // Verify fact exists and belongs to this case
      const incident = service.getIncident(req.params.caseId);
      const fact = incident.facts.find(f => f.id === req.params.factId);
      if (!fact) {
        throw new ApiError(ErrorCode.FACT_NOT_FOUND, 'Fact not found.', 404);
      }

      const updated = service.updateFact(req.params.caseId, req.params.factId, value);
      const readiness = calculateReadiness(updated);
      res.json({
        incident: sanitizeIncident(updated),
        readiness,
      });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cases/:caseId/facts/:factId/confirm — confirm/unconfirm a fact
  // -----------------------------------------------------------------------
  router.post('/cases/:caseId/facts/:factId/confirm', auth, (req, res, next) => {
    try {
      const { confirmed } = validateFactConfirm(req.body);

      const incident = service.getIncident(req.params.caseId);
      const fact = incident.facts.find(f => f.id === req.params.factId);
      if (!fact) {
        throw new ApiError(ErrorCode.FACT_NOT_FOUND, 'Fact not found.', 404);
      }

      const updated = service.confirmFact(req.params.caseId, req.params.factId, confirmed);
      const readiness = calculateReadiness(updated);
      res.json({
        incident: sanitizeIncident(updated),
        readiness,
      });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cases/:caseId/timeline — get timeline (events sorted by timestamp)
  // -----------------------------------------------------------------------
  router.get('/cases/:caseId/timeline', auth, (req, res, next) => {
    try {
      const incident = service.getIncident(req.params.caseId);
      if (!incident) {
        throw new ApiError(ErrorCode.CASE_NOT_FOUND, 'Case not found.', 404);
      }
      const events = buildTimeline(incident);
      res.json({ events });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cases/:caseId/events — add a timeline event
  // -----------------------------------------------------------------------
  router.post('/cases/:caseId/events', auth, (req, res, next) => {
    try {
      const eventParams = validateEventCreate(req.body);

      // Validate evidence references belong to this case
      if (eventParams.evidenceIds.length > 0) {
        const incident = service.getIncident(req.params.caseId);
        validateEvidenceRefs(incident, eventParams.evidenceIds);
      }

      const updated = service.addEvent(req.params.caseId, eventParams);
      res.status(201).json({ incident: sanitizeIncident(updated) });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cases/:caseId/events/:eventId/confirm — confirm/unconfirm event
  // -----------------------------------------------------------------------
  router.post('/cases/:caseId/events/:eventId/confirm', auth, (req, res, next) => {
    try {
      const { confirmed } = validateEventConfirm(req.body);

      const incident = service.getIncident(req.params.caseId);
      const event = incident.events.find(e => e.id === req.params.eventId);
      if (!event) {
        throw new ApiError(ErrorCode.EVENT_NOT_FOUND, 'Event not found.', 404);
      }

      const updated = service.confirmEvent(req.params.caseId, req.params.eventId, confirmed);
      res.json({ incident: sanitizeIncident(updated) });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cases/:caseId/contradictions — get current contradictions
  // -----------------------------------------------------------------------
  router.get('/cases/:caseId/contradictions', auth, (req, res, next) => {
    try {
      const incident = service.getIncident(req.params.caseId);
      if (!incident) {
        throw new ApiError(ErrorCode.CASE_NOT_FOUND, 'Case not found.', 404);
      }
      // Always recompute
      deriveContradictions(incident);
      res.json({ contradictions: incident.contradictions });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cases/:caseId/contradictions/:contradictionId/resolve
  // -----------------------------------------------------------------------
  router.post('/cases/:caseId/contradictions/:contradictionId/resolve', auth, (req, res, next) => {
    try {
      const { choice } = validateContradictionResolve(req.body);

      const updated = service.resolveContradiction(
        req.params.caseId,
        req.params.contradictionId,
        choice
      );
      const readiness = calculateReadiness(updated);
      res.json({
        incident: sanitizeIncident(updated),
        readiness,
      });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cases/:caseId/report — generate structured report
  // -----------------------------------------------------------------------
  router.get('/cases/:caseId/report', auth, (req, res, next) => {
    try {
      const report = service.generateReport(req.params.caseId);
      res.json({ report });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cases/:caseId/readiness — calculate deterministic readiness
  // -----------------------------------------------------------------------
  router.get('/cases/:caseId/readiness', auth, (req, res, next) => {
    try {
      const readiness = service.calculateReadiness(req.params.caseId);
      res.json({ readiness });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
