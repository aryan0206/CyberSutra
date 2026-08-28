// backend/routes/incidents.js
// Legacy routes for optimistic UI and backwards compatibility.

import { Router } from 'express';
import { requireCaseToken, sanitizeIncident } from './cases.js';
import { validateCaseCreate, validateCaseUpdate, validateRouteId } from '../validation.js';

export function createIncidentRouter(service) {
  const router = Router();
  const auth = requireCaseToken(service);
  router.param('incidentId', (req, _res, next, value) => {
    try {
      validateRouteId(value, 'incidentId', 'case');
      next();
    } catch (err) {
      next(err);
    }
  });

  // POST /incidents — create a new incident
  router.post('/incidents', (req, res, next) => {
    try {
      const { description } = validateCaseCreate(req.body || {});
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

      // Legacy compatibility permits description updates only. Facts, evidence,
      // readiness, contradictions and submission state are server-authoritative.
      const { description } = validateCaseUpdate(req.body);
      const updated = service.updateDescription(req.params.incidentId, description);

      res.json({ incident: sanitizeIncident(updated) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
