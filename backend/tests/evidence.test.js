// backend/tests/evidence.test.js
// Unit tests for the evidence ingestion subsystem:
// - EvidenceFileStore (fingerprinting, storage, cleanup)
// - IncidentService.uploadEvidence (validation, dedup, persistence)

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { EvidenceFileStore } from '../evidence-store.js';
import { InMemoryCaseRepository } from '../repository.js';
import { IncidentService } from '../service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00]);
const PDF_BYTES = Buffer.from('%PDF-1.4 test content');
const TXT_BYTES = Buffer.from('Plain text evidence content');
const JPEG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'cybersutra-test-'));
}

function expectedHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// ===========================================================================
// EvidenceFileStore — fingerprinting
// ===========================================================================

test('store: computeFingerprint returns correct SHA-256 hex', () => {
  const store = new EvidenceFileStore(join(tmpdir(), 'unused'));
  const result = store.computeFingerprint(PNG_BYTES);
  assert.equal(result, expectedHash(PNG_BYTES));
  assert.equal(result.length, 64); // SHA-256 hex = 64 chars
});

test('store: computeFingerprint is deterministic', () => {
  const store = new EvidenceFileStore(join(tmpdir(), 'unused'));
  const a = store.computeFingerprint(PNG_BYTES);
  const b = store.computeFingerprint(PNG_BYTES);
  assert.equal(a, b);
});

test('store: different bytes produce different fingerprints', () => {
  const store = new EvidenceFileStore(join(tmpdir(), 'unused'));
  const a = store.computeFingerprint(PNG_BYTES);
  const b = store.computeFingerprint(PDF_BYTES);
  assert.notEqual(a, b);
});

test('store: computeFingerprint rejects empty buffer', () => {
  const store = new EvidenceFileStore(join(tmpdir(), 'unused'));
  assert.throws(() => store.computeFingerprint(Buffer.alloc(0)), { message: /empty content/ });
});

test('store: computeFingerprint rejects non-buffer', () => {
  const store = new EvidenceFileStore(join(tmpdir(), 'unused'));
  assert.throws(() => store.computeFingerprint('not a buffer'), { message: /Buffer or Uint8Array/ });
});

// ===========================================================================
// EvidenceFileStore — file storage
// ===========================================================================

test('store: stores and retrieves file by evidence ID', async () => {
  const dir = await makeTempDir();
  try {
    const store = new EvidenceFileStore(dir);
    const path = await store.store('ev_test-id-123', PNG_BYTES);
    const stored = await readFile(path);
    assert.deepEqual(stored, PNG_BYTES);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('store: exists returns true for stored file', async () => {
  const dir = await makeTempDir();
  try {
    const store = new EvidenceFileStore(dir);
    await store.store('ev_test-exist', PNG_BYTES);
    assert.equal(await store.exists('ev_test-exist'), true);
    assert.equal(await store.exists('ev_nonexistent'), false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('store: remove deletes stored file', async () => {
  const dir = await makeTempDir();
  try {
    const store = new EvidenceFileStore(dir);
    await store.store('ev_to-delete', PNG_BYTES);
    assert.equal(await store.remove('ev_to-delete'), true);
    assert.equal(await store.exists('ev_to-delete'), false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('store: remove returns false for nonexistent file', async () => {
  const dir = await makeTempDir();
  try {
    const store = new EvidenceFileStore(dir);
    await store.init();
    assert.equal(await store.remove('ev_no-such-file'), false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('store: rejects unsafe evidence IDs for storage path', () => {
  const store = new EvidenceFileStore(join(tmpdir(), 'unused'));
  assert.throws(() => store._safePath('../etc/passwd'), { message: /unsafe characters/ });
  assert.throws(() => store._safePath('ev id with spaces'), { message: /unsafe characters/ });
  assert.throws(() => store._safePath(''), { message: /required/ });
});

// ===========================================================================
// Service: uploadEvidence — validation
// ===========================================================================

test('service: uploadEvidence stores file and persists metadata', async () => {
  const dir = await makeTempDir();
  try {
    const repo = new InMemoryCaseRepository();
    const store = new EvidenceFileStore(dir);
    const svc = new IncidentService({ repository: repo, evidenceStore: store });
    const incident = svc.createIncident({ description: 'Test' });

    const result = await svc.uploadEvidence(incident.id, PNG_BYTES, {
      originalFilename: 'screenshot.png',
      mimeType: 'image/png',
    });

    assert.equal(result.duplicate, null);
    assert.ok(result.evidence);
    assert.ok(result.evidence.id.startsWith('ev_'));
    assert.equal(result.evidence.mimeType, 'image/png');
    assert.equal(result.evidence.type, 'Screenshot');
    assert.equal(result.evidence.filename, 'screenshot.png');
    assert.equal(result.evidence.source, 'Uploaded by citizen');
    assert.equal(result.evidence.size, PNG_BYTES.length);
    assert.equal(result.evidence.integrityFingerprint, expectedHash(PNG_BYTES));
    assert.ok(result.evidence.createdAt);

    // Verify file is on disk
    assert.equal(await store.exists(result.evidence.id), true);

    // Verify metadata is persisted on incident
    const current = svc.getIncident(incident.id);
    assert.equal(current.evidence.length, 1);
    assert.equal(current.evidence[0].id, result.evidence.id);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('service: uploadEvidence works for all accepted MIME types', async () => {
  const dir = await makeTempDir();
  try {
    const repo = new InMemoryCaseRepository();
    const store = new EvidenceFileStore(dir);
    const svc = new IncidentService({ repository: repo, evidenceStore: store });
    const incident = svc.createIncident();

    const types = [
      { buffer: PNG_BYTES, mime: 'image/png', label: 'Screenshot' },
      { buffer: JPEG_BYTES, mime: 'image/jpeg', label: 'Screenshot' },
      { buffer: PDF_BYTES, mime: 'application/pdf', label: 'Document' },
      { buffer: TXT_BYTES, mime: 'text/plain', label: 'Text message' },
    ];

    for (const { buffer, mime, label } of types) {
      const result = await svc.uploadEvidence(incident.id, buffer, {
        originalFilename: `test.${mime.split('/')[1]}`,
        mimeType: mime,
      });
      assert.equal(result.evidence.type, label);
      assert.equal(result.evidence.mimeType, mime);
    }

    const current = svc.getIncident(incident.id);
    assert.equal(current.evidence.length, 4);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('service: uploadEvidence rejects unsupported MIME type', async () => {
  const dir = await makeTempDir();
  try {
    const repo = new InMemoryCaseRepository();
    const store = new EvidenceFileStore(dir);
    const svc = new IncidentService({ repository: repo, evidenceStore: store });
    const incident = svc.createIncident();

    await assert.rejects(
      svc.uploadEvidence(incident.id, Buffer.from('test'), {
        originalFilename: 'virus.exe',
        mimeType: 'application/x-executable',
      }),
      { message: /not supported/ }
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('service: uploadEvidence rejects oversized file', async () => {
  const dir = await makeTempDir();
  try {
    const repo = new InMemoryCaseRepository();
    const store = new EvidenceFileStore(dir);
    const svc = new IncidentService({ repository: repo, evidenceStore: store });
    const incident = svc.createIncident();

    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0x42);
    await assert.rejects(
      svc.uploadEvidence(incident.id, oversized, {
        originalFilename: 'huge.png',
        mimeType: 'image/png',
      }),
      { message: /5 MB/ }
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});

// ===========================================================================
// Service: uploadEvidence — duplicate detection
// ===========================================================================

test('service: uploadEvidence detects duplicate fingerprint', async () => {
  const dir = await makeTempDir();
  try {
    const repo = new InMemoryCaseRepository();
    const store = new EvidenceFileStore(dir);
    const svc = new IncidentService({ repository: repo, evidenceStore: store });
    const incident = svc.createIncident();

    // First upload succeeds
    const first = await svc.uploadEvidence(incident.id, PNG_BYTES, {
      originalFilename: 'first.png',
      mimeType: 'image/png',
    });
    assert.ok(first.evidence);
    assert.equal(first.duplicate, null);

    // Second upload of same bytes returns duplicate
    const second = await svc.uploadEvidence(incident.id, PNG_BYTES, {
      originalFilename: 'second.png',
      mimeType: 'image/png',
    });
    assert.equal(second.evidence, null);
    assert.ok(second.duplicate);
    assert.equal(second.duplicate.existingEvidenceId, first.evidence.id);
    assert.equal(second.duplicate.fingerprint, expectedHash(PNG_BYTES));

    // Only one evidence record exists
    const current = svc.getIncident(incident.id);
    assert.equal(current.evidence.length, 1);
  } finally {
    await rm(dir, { recursive: true });
  }
});

// ===========================================================================
// Service: uploadEvidence — filename sanitization
// ===========================================================================

test('service: uploadEvidence sanitizes malicious filenames', async () => {
  const dir = await makeTempDir();
  try {
    const repo = new InMemoryCaseRepository();
    const store = new EvidenceFileStore(dir);
    const svc = new IncidentService({ repository: repo, evidenceStore: store });
    const incident = svc.createIncident();

    const result = await svc.uploadEvidence(incident.id, PNG_BYTES, {
      originalFilename: '../../etc/passwd',
      mimeType: 'image/png',
    });
    assert.equal(result.evidence.filename, '____etc_passwd');
  } finally {
    await rm(dir, { recursive: true });
  }
});

// ===========================================================================
// Service: removeEvidence — file cleanup
// ===========================================================================

test('service: removeEvidence deletes stored file', async () => {
  const dir = await makeTempDir();
  try {
    const repo = new InMemoryCaseRepository();
    const store = new EvidenceFileStore(dir);
    const svc = new IncidentService({ repository: repo, evidenceStore: store });
    const incident = svc.createIncident();

    const { evidence } = await svc.uploadEvidence(incident.id, PNG_BYTES, {
      originalFilename: 'test.png',
      mimeType: 'image/png',
    });

    assert.equal(await store.exists(evidence.id), true);
    await svc.removeEvidence(incident.id, evidence.id);
    assert.equal(await store.exists(evidence.id), false);

    const current = svc.getIncident(incident.id);
    assert.equal(current.evidence.length, 0);
  } finally {
    await rm(dir, { recursive: true });
  }
});

// ===========================================================================
// Evidence isolation between cases
// ===========================================================================

test('service: evidence is isolated between incidents', async () => {
  const dir = await makeTempDir();
  try {
    const repo = new InMemoryCaseRepository();
    const store = new EvidenceFileStore(dir);
    const svc = new IncidentService({ repository: repo, evidenceStore: store });

    const caseA = svc.createIncident({ description: 'Case A' });
    const caseB = svc.createIncident({ description: 'Case B' });

    // Same file uploaded to different cases should succeed (not be flagged as duplicate)
    const resultA = await svc.uploadEvidence(caseA.id, PNG_BYTES, {
      originalFilename: 'shared.png',
      mimeType: 'image/png',
    });
    const resultB = await svc.uploadEvidence(caseB.id, PNG_BYTES, {
      originalFilename: 'shared.png',
      mimeType: 'image/png',
    });

    assert.ok(resultA.evidence);
    assert.ok(resultB.evidence);
    assert.notEqual(resultA.evidence.id, resultB.evidence.id);

    // Removing from case A does not affect case B
    await svc.removeEvidence(caseA.id, resultA.evidence.id);
    const currentA = svc.getIncident(caseA.id);
    const currentB = svc.getIncident(caseB.id);
    assert.equal(currentA.evidence.length, 0);
    assert.equal(currentB.evidence.length, 1);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('service: uploadEvidence rejects when incident not found', async () => {
  const dir = await makeTempDir();
  try {
    const repo = new InMemoryCaseRepository();
    const store = new EvidenceFileStore(dir);
    const svc = new IncidentService({ repository: repo, evidenceStore: store });

    await assert.rejects(
      svc.uploadEvidence('nonexistent', PNG_BYTES, {
        originalFilename: 'test.png',
        mimeType: 'image/png',
      }),
      { message: /not found/ }
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('service: uploadEvidence rejects on submitted incident', async () => {
  const dir = await makeTempDir();
  try {
    const repo = new InMemoryCaseRepository();
    const store = new EvidenceFileStore(dir);
    const svc = new IncidentService({ repository: repo, evidenceStore: store });
    const incident = svc.createIncident();

    // Mark as submitted
    const stored = repo.get(incident.id);
    stored.submitted = true;
    repo.save(stored);

    await assert.rejects(
      svc.uploadEvidence(incident.id, PNG_BYTES, {
        originalFilename: 'test.png',
        mimeType: 'image/png',
      }),
      { message: /submitted/ }
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});
