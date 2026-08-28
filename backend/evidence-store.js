// backend/evidence-store.js
// Secure evidence file storage with server-side SHA-256 fingerprinting.
//
// Files are stored using server-generated names. User-provided filenames
// are never used as filesystem paths. Uploaded files are never executed.

import { createHash } from 'node:crypto';
import { unlink, mkdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';

export class EvidenceFileStore {
  /**
   * @param {string} baseDir - Absolute path to the upload storage directory.
   */
  constructor(baseDir) {
    if (!baseDir || typeof baseDir !== 'string') {
      throw new Error('EvidenceFileStore requires an absolute base directory path.');
    }
    this.baseDir = baseDir;
    this._initialized = false;
  }

  /** Ensure the storage directory exists. */
  async init() {
    if (this._initialized) return;
    await mkdir(this.baseDir, { recursive: true });
    this._initialized = true;
  }

  /**
   * Compute the SHA-256 hex fingerprint of a buffer.
   * Deterministic: identical bytes always produce the identical fingerprint.
   * @param {Buffer|Uint8Array} buffer
   * @returns {string} Lowercase hex SHA-256 digest
   */
  computeFingerprint(buffer) {
    if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
      throw new Error('computeFingerprint requires a Buffer or Uint8Array.');
    }
    if (buffer.length === 0) {
      throw new Error('Cannot compute fingerprint of empty content.');
    }
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Store file bytes to disk using a server-generated safe path.
   * The original filename is never used.
   *
   * @param {string} evidenceId - Server-generated evidence ID (e.g. ev_uuid)
   * @param {Buffer|Uint8Array} buffer - File content
   * @returns {Promise<string>} The safe storage path
   */
  async store(evidenceId, buffer) {
    await this.init();
    const safePath = this._safePath(evidenceId);
    let handle;
    try {
      // Exclusive creation prevents replacing an unrelated file if an ID
      // collision or storage misconfiguration occurs.
      handle = await open(safePath, 'wx');
      await handle.writeFile(buffer);
      await handle.close();
      return safePath;
    } catch (err) {
      if (handle) {
        try { await handle.close(); } catch { /* cleanup continues */ }
        // Only unlink a file this invocation created; never touch an existing
        // unrelated storage object when exclusive open failed.
        try { await unlink(safePath); } catch { /* best-effort cleanup */ }
      }
      throw err;
    }
  }

  /**
   * Remove a stored evidence file.
   * @param {string} evidenceId
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async remove(evidenceId) {
    const safePath = this._safePath(evidenceId);
    try {
      await unlink(safePath);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  /**
   * Check if a file exists in storage.
   * @param {string} evidenceId
   * @returns {Promise<boolean>}
   */
  async exists(evidenceId) {
    try {
      await stat(this._safePath(evidenceId));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Derive a safe filesystem path from an evidence ID.
   * Evidence IDs are server-generated (ev_<uuid>), containing only
   * alphanumerics, underscores, and hyphens. We validate this invariant.
   * Files are stored without an extension to prevent accidental execution.
   *
   * @param {string} evidenceId
   * @returns {string} Absolute safe path
   */
  _safePath(evidenceId) {
    if (!evidenceId || typeof evidenceId !== 'string') {
      throw new Error('Evidence ID is required for storage path.');
    }
    // Validate that the ID contains only safe characters
    if (!/^[a-zA-Z0-9_-]+$/.test(evidenceId)) {
      throw new Error('Evidence ID contains unsafe characters for storage path.');
    }
    return join(this.baseDir, evidenceId);
  }
}
