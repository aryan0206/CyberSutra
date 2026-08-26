// backend/server.js
// Express application bootstrap.
//
// Exports createApp() for testing. When run directly, starts listening.
// No secrets are hardcoded. Security headers are set explicitly.

import express from 'express';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { InMemoryCaseRepository } from './repository.js';
import { IncidentService } from './service.js';
import { EvidenceFileStore } from './evidence-store.js';
import { createEvidenceRouter } from './routes/evidence.js';
import { createIncidentRouter } from './routes/incidents.js';

/**
 * Create and configure the Express application.
 *
 * @param {{ uploadDir?: string, repository?: object, evidenceStore?: object }} options
 * @returns {{ app: import('express').Express, service: IncidentService, evidenceStore: EvidenceFileStore }}
 */
export function createApp(options = {}) {
  const repository = options.repository || new InMemoryCaseRepository();
  const evidenceStore = options.evidenceStore || new EvidenceFileStore(options.uploadDir || config.uploadDir);
  const service = new IncidentService({ repository, evidenceStore });

  const app = express();

  // -----------------------------------------------------------------------
  // Security headers — no helmet dependency, explicit control
  // -----------------------------------------------------------------------
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // -----------------------------------------------------------------------
  // JSON body parser — limit request body size
  // -----------------------------------------------------------------------
  app.use(express.json({ limit: '1mb' }));

  // -----------------------------------------------------------------------
  // API routes
  // -----------------------------------------------------------------------
  app.use('/api', createIncidentRouter(service));
  app.use('/api', createEvidenceRouter(service, evidenceStore));

  // -----------------------------------------------------------------------
  // Error handling — JSON responses only, no stack traces
  // -----------------------------------------------------------------------
  app.use((err, _req, res, _next) => {
    // Multer file-size errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'This file is larger than the 5 MB demo limit.' });
    }
    // Other multer limit errors
    if (err.code && err.code.startsWith('LIMIT_')) {
      return res.status(400).json({ error: `Upload limit exceeded: ${err.message}` });
    }
    // Domain / service errors — return the message
    if (err.message) {
      // Choose appropriate status code based on error message patterns
      const status = err.message.includes('not found') ? 404
        : err.message.includes('submitted') ? 409
        : 400;
      return res.status(status).json({ error: err.message });
    }
    // Unknown errors — never expose internals
    res.status(500).json({ error: 'Internal server error.' });
  });

  return { app, service, evidenceStore };
}

// ---------------------------------------------------------------------------
// Start server when this file is run directly
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const { app } = createApp();
  app.listen(config.port, () => {
    console.log(`CyberSutra backend listening on port ${config.port}`);
  });
}
