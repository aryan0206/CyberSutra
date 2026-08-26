// backend/config.js
// Environment-based configuration with secure defaults.
// No secrets are hardcoded. All values can be overridden via environment variables.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const config = Object.freeze({
  /** Maximum evidence file size in bytes. Matches frontend MAX_BYTES. */
  maxEvidenceBytes: parseInt(process.env.CYBERSUTRA_MAX_EVIDENCE_BYTES || String(5 * 1024 * 1024), 10),

  /** Server port. */
  port: parseInt(process.env.PORT || '3001', 10),

  /** Node environment. */
  nodeEnv: process.env.NODE_ENV || 'development',

  /**
   * Evidence upload storage directory.
   * Defaults to backend/uploads. Must be outside the served static directory.
   * Override via CYBERSUTRA_UPLOAD_DIR for testing or deployment.
   */
  uploadDir: process.env.CYBERSUTRA_UPLOAD_DIR || join(__dirname, 'uploads'),
});

export default config;
