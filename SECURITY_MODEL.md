# Security Model

## Trust Zones

```
ZONE 1 — USER INPUT                          ← Untrusted
  Upload, form fields, filenames
  ↓
ZONE 2 — TRANSPORT VALIDATION                ← Untrusted (server-side defense)
  multer MIME allowlist, size limit
  Filename sanitization (path traversal, control chars, script injection)
  Server-generated evidence IDs (original filenames never used as paths)
  ↓
ZONE 3 — DOMAIN VALIDATION                   ← Deterministic, trusted computation
  domain.js: validateUpload, createEvidence, deriveContradictions
  SHA-256 integrity fingerprinting
  Duplicate detection by fingerprint
  ↓
ZONE 4 — USER CONFIRMATION                   ← Human-verified state
  Fact confirmation, contradiction resolution
  Client sets UI state, but server recalculates readiness unconditionally
  ↓
ZONE 5 — SUBMISSION GATEWAY (MOCK)           ← Strict adapter boundary
  Server `domain.js` recalculates `READY` state (never trusts client `canSubmit`)
  Local-only `MockSubmissionGateway` simulated external system
  Zero outbound network communication
  Case tokens excluded from submission payloads and reports
  Synthetic `MOCK-NCRP-` references with simulated flags
```

## Evidence Security Controls

| Control | Implementation |
|---|---|
| MIME validation | Server: multer fileFilter + domain validateUpload. Client: same rules. |
| Size limit | 5 MB enforced at multer (request) + domain (validation). |
| Filename sanitization | `sanitizeFilename()`: strips `..`, `/`, `\`, `<`, `>`, control chars, limits to 120 chars. |
| Storage isolation | Files stored as `{evidenceId}` (no extension) in configurable upload directory. |
| No execution | Uploaded files are never executed, dynamically imported, or treated as instructions. |
| No URL fetching | User-provided URLs remain data only. Never automatically fetched. |
| Duplicate handling | Deterministic fingerprint match. Returns 409 with explicit relationship. Never silently merges. |
| Cross-case isolation | Evidence retrieval validates incident ownership. `X-Case-Token` required for mutating non-legacy API access. |
| Immutability | Submitted incidents reject all modifications. |
| Security headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, no `X-Powered-By`. |
| Token protection | `X-Case-Token` is strictly excluded from `report.js` and all submission acknowledgements. |
| Server-authoritative gating | `submitCase` strictly recalculates readiness. Forged client `canSubmit: true` or `state: READY` payloads are ignored. |
| Submission isolation | `MockSubmissionGateway` adapter strictly verified to contain zero networking library imports. |

## AI Processing (Zone 2.5 — Future)

AI extraction is not implemented in this MVP. If added, AI output would be:
- Untrusted and probabilistic
- Source-linked candidates only
- Subject to deterministic validation and human confirmation
- Never treated as authoritative