// backend/routes/incidents.js
// Minimal incident management routes.
// Only what is needed for evidence endpoints to have incidents to attach to.

import { Router } from 'express';

/**
 * Create the incidents router.
 * @param {import('../service.js').IncidentService} service
 * @returns {import('express').Router}
 */
export function createIncidentRouter(service) {
  const router = Router();

  // POST /api/incidents — create a new incident
  router.post('/incidents', (req, res, next) => {
    try {
      const { description } = req.body || {};
      const incident = service.createIncident({ description });
      res.status(201).json({ incident });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/incidents/:incidentId — retrieve an incident
  router.get('/incidents/:incidentId', (req, res, next) => {
    try {
      const incident = service.getIncident(req.params.incidentId);
      if (!incident) {
        return res.status(404).json({ error: `Incident ${req.params.incidentId} not found.` });
      }
      res.json({ incident });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
