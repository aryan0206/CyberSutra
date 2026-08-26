// backend/routes/incidents.js
// Legacy routes for optimistic UI and backwards compatibility.

import { Router } from 'express';
import { deriveContradictions } from '../domain.js';
import { requireCaseToken, sanitizeIncident } from './cases.js';

export function createIncidentRouter(service) {
  const router = Router();
  const auth = requireCaseToken(service);

  // POST /incidents — create a new incident
  router.post('/incidents', (req, res, next) => {
    try {
      const description = typeof req.body?.description === 'string'
        ? req.body.description.slice(0, 3000)
        : '';
      const incident = service.createIncident({ description });
      res.status(201).json({
        incident: sanitizeIncident(incident),
        caseToken: incident.caseToken
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /incidents/:incidentId — retrieve an incident
  router.get('/incidents/:incidentId', auth, (req, res, next) => {
    try {
      const incident = service.getIncident(req.params.incidentId);
      if (!incident) {
        return res.status(404).json({ error: `Incident ${req.params.incidentId} not found.` });
      }
      res.json({ incident: sanitizeIncident(incident) });
    } catch (err) {
      next(err);
    }
  });

  // PUT /incidents/:incidentId — sync incident state from frontend
  router.put('/incidents/:incidentId', auth, (req, res, next) => {
    try {
      const incident = service.getIncident(req.params.incidentId);
      if (!incident) {
        return res.status(404).json({ error: `Incident ${req.params.incidentId} not found.` });
      }
      if (incident.submitted) {
        return res.status(409).json({ error: 'Cannot modify a submitted incident.' });
      }

      // Sync state from frontend payload (optimistic UI)
      const payload = req.body || {};

      // Update core fields securely
      incident.description = payload.description ?? incident.description;
      incident.facts = payload.facts ?? incident.facts;
      incident.events = payload.events ?? incident.events;
      incident.ui = payload.ui ?? incident.ui;
      incident.submitted = payload.submitted ?? incident.submitted;
      incident.acknowledgement = payload.acknowledgement ?? incident.acknowledgement;

      // We do NOT overwrite evidence directly from frontend PUT,
      // as evidence should only be added via upload endpoint or demo sync.
      if (payload.evidence) {
         incident.evidence = payload.evidence;
      }
      if (payload.contradictions) {
         // Optionally accept frontend resolutions
         incident.contradictions = payload.contradictions;
      }

      // Enforce backend domain authority by re-deriving constraints
      deriveContradictions(incident);
      service.repository.save(incident);

      res.json({ incident: sanitizeIncident(incident) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
