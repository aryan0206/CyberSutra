// backend/routes/evidence.js
// Evidence upload, retrieval, and deletion HTTP endpoints.
//
// Security controls:
//   - multer memory storage (no disk write until validated)
//   - MIME type allowlist via fileFilter
//   - 5 MB file size limit
//   - single file per request
//   - server-generated evidence IDs
//   - sanitized display filenames
//   - deterministic duplicate detection
//   - files stored without extension to prevent accidental execution
//   - original filenames never used as filesystem paths

import { Router } from 'express';
import multer from 'multer';
import { MAX_BYTES, ACCEPTED_MIME_TYPES } from '../domain.js';

/**
 * Create the evidence router.
 * @param {import('../service.js').IncidentService} service
 * @param {import('../evidence-store.js').EvidenceFileStore} evidenceStore
 * @returns {import('express').Router}
 */
export function createEvidenceRouter(service, evidenceStore) {
  const router = Router();

  // multer config: memory storage, strict limits, MIME allowlist
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
        // Reject with an error that the error handler will catch
        const err = new Error('This file type is not supported. Use PNG, JPEG, PDF, or plain text.');
        err.code = 'UNSUPPORTED_MIME';
        cb(err);
      }
    },
  });

  // -----------------------------------------------------------------------
  // POST /api/incidents/:incidentId/evidence — upload evidence file
  // -----------------------------------------------------------------------
  router.post(
    '/incidents/:incidentId/evidence',
    upload.single('file'),
    async (req, res, next) => {
      try {
        const { incidentId } = req.params;

        // Validate that a file was provided
        if (!req.file) {
          return res.status(400).json({ error: 'No file provided.' });
        }

        // Validate that the file has content
        if (!req.file.buffer || req.file.buffer.length === 0) {
          return res.status(400).json({ error: 'Uploaded file is empty.' });
        }

        const result = await service.uploadEvidence(incidentId, req.file.buffer, {
          originalFilename: req.file.originalname,
          mimeType: req.file.mimetype,
        });

        if (result.duplicate) {
          return res.status(409).json(result);
        }

        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // -----------------------------------------------------------------------
  // GET /api/incidents/:incidentId/evidence — list all evidence
  // -----------------------------------------------------------------------
  router.get('/incidents/:incidentId/evidence', (req, res, next) => {
    try {
      const incident = service.getIncident(req.params.incidentId);
      if (!incident) {
        return res.status(404).json({ error: `Incident ${req.params.incidentId} not found.` });
      }
      res.json({ evidence: incident.evidence });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/incidents/:incidentId/evidence/:evidenceId — get single
  // -----------------------------------------------------------------------
  router.get('/incidents/:incidentId/evidence/:evidenceId', (req, res, next) => {
    try {
      const incident = service.getIncident(req.params.incidentId);
      if (!incident) {
        return res.status(404).json({ error: `Incident ${req.params.incidentId} not found.` });
      }
      const ev = incident.evidence.find(e => e.id === req.params.evidenceId);
      if (!ev) {
        return res.status(404).json({ error: `Evidence ${req.params.evidenceId} not found.` });
      }
      res.json({ evidence: ev });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /api/incidents/:incidentId/evidence/:evidenceId — remove
  // -----------------------------------------------------------------------
  router.delete('/incidents/:incidentId/evidence/:evidenceId', async (req, res, next) => {
    try {
      const updated = await service.removeEvidence(
        req.params.incidentId,
        req.params.evidenceId
      );
      res.json({ incident: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
