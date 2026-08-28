// backend/server.js
// Express application bootstrap.
//
// Exports createApp() for testing. When run directly, starts listening.
// No secrets are hardcoded. Security headers are set explicitly.

import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import config from './config.js';
import { InMemoryCaseRepository } from './repository.js';
import { IncidentService } from './service.js';
import { EvidenceFileStore } from './evidence-store.js';
import { createEvidenceRouter } from './routes/evidence.js';
import { createIncidentRouter } from './routes/incidents.js';
import { createCasesRouter } from './routes/cases.js';
import { ApiError } from './errors.js';
import { MockSubmissionGateway } from './submission-gateway.js';

/**
 * Create and configure the Express application.
 *
 * @param {{ uploadDir?: string, repository?: object, evidenceStore?: object, submissionGateway?: object }} options
 * @returns {{ app: import('express').Express, service: IncidentService, evidenceStore: EvidenceFileStore }}
 */
export function createApp(options = {}) {
  const repository = options.repository || new InMemoryCaseRepository();
  const evidenceStore = options.evidenceStore || new EvidenceFileStore(options.uploadDir || config.uploadDir);
  const submissionGateway = options.submissionGateway || new MockSubmissionGateway();
  const service = new IncidentService({ repository, evidenceStore, submissionGateway });

  const app = express();
  // JSON-escape HTML-significant characters in API responses. This preserves
  // evidence as data while making accidental embedding in HTML safer.
  app.set('json escape', true);

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
  // Static files and API routes
  // -----------------------------------------------------------------------
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  app.use(express.static(path.join(__dirname, '../frontend')));

  // Legacy routes — kept for backward compatibility with existing tests
  app.use('/api', createIncidentRouter(service));
  app.use('/api', createEvidenceRouter(service, evidenceStore));

  // Primary cases API — the canonical lifecycle endpoints
  app.use('/api', createCasesRouter(service));

  // -----------------------------------------------------------------------
  // Error handling — JSON responses only, no stack traces
  // -----------------------------------------------------------------------
  app.use((err, _req, res, _next) => {
    // ApiError — structured machine-readable errors
    if (err instanceof ApiError) {
      return res.status(err.status).json(err.toJSON());
    }
    // Multer file-size errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ code: 'FILE_TOO_LARGE', message: 'This file is larger than the 5 MB demo limit.' });
    }
    // Other multer limit errors
    if (err.code && err.code.startsWith('LIMIT_')) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Upload limit exceeded.' });
    }
    // Multer MIME rejection (from cases router)
    if (err.code === 'UNSUPPORTED_MIME' || err.code === 'UNSUPPORTED_FILE_TYPE') {
      return res.status(400).json({ code: 'UNSUPPORTED_FILE_TYPE', message: 'This file type is not supported.' });
    }
    // Unexpected errors may contain filesystem paths, secrets, or exception
    // details. Only known ApiErrors above are safe to expose.
    if (err.message) {
      return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Internal server error.' });
    }
    // Unknown errors — never expose internals
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Internal server error.' });
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
