// backend/config.js
// Environment-based configuration with secure defaults.
// No secrets are hardcoded. All values can be overridden via environment variables.

const config = Object.freeze({
  /** Maximum evidence file size in bytes. Matches frontend MAX_BYTES. */
  maxEvidenceBytes: parseInt(process.env.CYBERSUTRA_MAX_EVIDENCE_BYTES || String(5 * 1024 * 1024), 10),

  /** Server port (used when HTTP layer is added in a future slice). */
  port: parseInt(process.env.PORT || '3001', 10),

  /** Node environment. */
  nodeEnv: process.env.NODE_ENV || 'development',
});

export default config;
