# Codex usage log

## 2026-08-25 — Initial reliable MVP implementation

- Prompt: Improve the existing CyberSutra workflow for reliability, clarity, evidence grounding, security and depth without expanding its scope.
- Files changed: `frontend/index.html`, `frontend/styles.css`, `frontend/app.js`, `tests/core-logic.test.js`, `README.md`.
- Implementation: Added the local mock incident flow with evidence intake, provenance-linked facts, deterministic contradiction/readiness logic, a synthetic demo case, and mock acknowledgement.
- Security: MIME/size allowlist, sanitized filenames, escaped rendered values, no URL fetching or uploaded-file execution, and local-only mock state.
- Tests: Static review completed. Node and browser smoke test were unavailable in this workspace.
- Human review: Pending.

## 2026-08-25 — Repository structure alignment

- Prompt: Create the agreed CyberSutra repository structure before further implementation and push it to Git/GitHub.
- Files changed: Root project documents, `docs/`, `rules/`, and Git-tracked placeholders for planned AI, mock-data, test, and workflow directories.
- Implementation: Aligned the local project to the requested skeleton while preserving the existing prototype files.
- Tests: Verified the expected directories exist locally.
- Human review: Pending.
- Outcome: Local structure complete. Git/GitHub publication is pending because Git access approval was declined.

## 2026-08-25 — Evidence-readiness reliability corrections

- Prompt: Correct only the specified readiness gate, contradiction workflow, timeline confirmation, provenance, upload wording, SHA-256 integrity fingerprint, and core-logic testing gaps.
- Files changed: `frontend/core.js`, `frontend/app.js`, `frontend/index.html`, `frontend/enhancements.css`, `tests/unit/core-logic.test.js`, `package.json`, and `README.md`.
- Implementation: Submission is now gated on deterministic `READY`; contradictions retain `unresolved`, `reviewed_unresolved`, or `resolved` status with an explicit source-value choice; confirmed timeline events and source highlighting persist locally; uploaded file bytes are fingerprinted with browser Web Crypto SHA-256; manual facts remain user-entered with no fabricated fingerprint.
- Tests: Executed `node --check frontend/app.js` and `node --test tests/unit/core-logic.test.js` using the bundled Node runtime. Result: 9 passing, 0 failing, 0 skipped. The SHA-256 test used the known `abc` SHA-256 vector and verified changed bytes produce a different fingerprint.
- Browser test: Not executed. The available browser-control runtime previously exited unexpectedly during setup; no browser automation was available.
- Human review: Pending. No GitHub push was performed.

## 2026-08-25 — Final review corrections

- Prompt: Fix the reviewed contradiction/readiness defect, improve test fidelity, document local HTTP serving and MVP honesty, and prepare the working tree for human review.
- Files changed: `frontend/core.js`, `frontend/app.js`, `tests/unit/core-logic.test.js`, `README.md`, `AI_CONTRACT.md`, `JUDGE_QA.md`, and `.gitattributes`.
- Implementation: Explicitly selecting a conflicting source marks that fact selected and confirmed, retains the other fact as rejected historical evidence, and excludes only the rejected fact from the effective readiness set. An unable-to-verify decision remains non-ready.
- Tests: Executed bundled Node syntax checks for `frontend/core.js` and `frontend/app.js`, then `node --test tests/unit/core-logic.test.js`. Result: 9 passing, 0 failing, 0 skipped.
- Browser test: Not executed; the browser-control runtime is unavailable after exiting unexpectedly during setup. No commit or GitHub push was performed.
- Human review: Pending.

## 2026-08-25 — Backend foundation (domain layer)

- Prompt: Create the backend domain layer under `/backend` that re-implements the frontend domain rules as the authoritative server-side source of truth.
- Files created: `backend/package.json`, `backend/config.js`, `backend/domain.js`, `backend/repository.js`, `backend/service.js`, `backend/tests/domain.test.js`.
- Files modified: `package.json` (root — added backend test script).
- Implementation: Canonical domain model (`domain.js`) with identical semantics to `frontend/core.js`: evidence validation, fact creation with provenance, deterministic contradiction derivation, explicit contradiction resolution, readiness calculation (INCOMPLETE / NEEDS_REVIEW / READY), and incident lifecycle. Added server-side input validation not present in the frontend. In-memory repository with deep-copy isolation. Service layer orchestrating validated operations and enforcing submitted-case immutability.
- Dependencies: Zero external dependencies. Node.js built-in modules only (`node:crypto`, `node:test`, `node:assert`).
- Tests: `node --test backend/tests/domain.test.js` — 47 passing, 0 failing. Frontend tests unchanged: 9 passing. Combined: 56 passing.
- Human review: Completed — pushed as `345e36d`.

## 2026-08-25 — Evidence ingestion subsystem

- Prompt: Move evidence intake from browser-only behavior into a secure backend service with multipart upload, server-side SHA-256 fingerprinting, strict validation, duplicate detection, and file storage.
- Files created: `backend/evidence-store.js`, `backend/server.js`, `backend/routes/evidence.js`, `backend/routes/incidents.js`, `backend/tests/evidence.test.js`, `tests/integration/evidence-upload.test.js`, `tests/security/evidence-security.test.js`.
- Files modified: `backend/config.js` (added `uploadDir`), `backend/domain.js` (added `createdAt`, `deriveEvidenceType`, `findDuplicateEvidence`), `backend/service.js` (added `uploadEvidence`, async `removeEvidence`, evidence store integration), `backend/package.json` (added `express@4`, `multer@1.4.5-lts.1`), `backend/tests/domain.test.js` (async fix + new tests), `package.json` (root — added `test:integration`, `test:security`, `test:all` scripts).
- Dependencies: 2 backend packages — `express@4.22.2`, `multer@1.4.5-lts.1` (LTS, 0 vulnerabilities).
- Security controls: MIME allowlist, 5 MB size limit, multer memory storage (no disk write until validated), server-generated evidence IDs, files stored without extension, `sanitizeFilename` strips path traversal / control chars / script injection, deterministic duplicate detection (409 with explicit relationship info, never silently merges), cross-case evidence isolation, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-Powered-By` disabled, submitted-case immutability.
- API endpoints: `POST /api/incidents`, `GET /api/incidents/:id`, `POST /api/incidents/:id/evidence` (multipart upload), `GET /api/incidents/:id/evidence`, `GET /api/incidents/:id/evidence/:evId`, `DELETE /api/incidents/:id/evidence/:evId`.
- Tests: Backend domain 51 pass, evidence unit 20 pass, integration 12 pass, security 11 pass, frontend 9 pass. **Total: 103 passing, 0 failing.**
- Human review: Completed — pushed as `acc74ea`.

## Prompt 4 — Harden Deterministic Evidence Reasoning Engine

- **Prompt**: 4
- **Title**: Harden Deterministic Evidence Reasoning Engine
- **Objective**: Harden the backend's deterministic reasoning engine for provenance, field-aware value normalization, contradiction detection, readiness calculation, and timeline construction.
- **Implementation completed**: Yes.
- **Major changes**: Added field-type-aware value normalization (monetary, timestamp, tx id, phone, URL, institution), added deterministic timeline builder that handles invalid timestamps safely, added human-readable readiness blockers, updated contradictions to use normalized comparison.
- **Files/components affected**: `backend/domain.js`, `backend/routes/cases.js`, `backend/tests/prompt4-reasoning.test.js`, `package.json`, and documentation files.
- **Security/reasoning implications**: Contradiction detection uses safe field-aware normalization; timeline generation does not fabricate or modify original timestamps; readiness blocks on explicit open contradictions and lists blockers.
- **Automated verification**: 189 passed / 0 failed.
- **Prompt 4-specific tests**: 48.
- **Independent manual/API verification**: 21/21 passed.
- **Important regression**: ₹18,500 vs ₹15,500 remains a critical contradiction requiring explicit resolution.
- **AI constraints**: No ML/external AI introduced. Purely deterministic and rule-based.
- **Status**: Commit was completed and pushed.

## Prompt 5 — Deterministic Report Generation

- **Prompt**: 5
- **Title**: Deterministic Report Generation Service
- **Objective**: Implement a deterministic report assembly service that structures authoritative case state into a JSON report without using AI.
- **Implementation completed**: Yes.
- **Major changes**: Created a structured JSON report endpoint (`GET /api/cases/:caseId/report`) assembled strictly from authoritative backend case state (incident description, evidence inventory, evidence-linked facts, deterministic timeline, contradictions, resolutions, missing information, readiness, and mock submission status). Excluded `caseToken` from report output.
- **Files/components affected**: `backend/report.js`, `backend/service.js`, `backend/routes/cases.js`, `backend/tests/report.test.js`, and documentation.
- **Security/reasoning implications**: Report relies entirely on deterministic server-computed properties. Provenance and original values are explicitly preserved.
- **Automated verification**: 224 total passed / 0 failed (35 new tests added).
- **Independent manual/API verification**: 20/20 manual checks passed.
- **AI constraints**: No LLM, ML, or external AI introduced. Purely deterministic and rule-based.
- **Status**: Commit was completed and pushed.

## Prompt 6 — Mock Government Submission Boundary

- **Prompt**: 6
- **Title**: Mock Government Submission Boundary
- **Objective**: Implement an adapter-based mock government submission boundary enforcing server-side readiness.
- **Implementation completed**: Yes.
- **Major changes**: Implemented `SubmissionGateway` adapter architecture. Created `MockSubmissionGateway` for simulated submissions. Added `POST /api/cases/:caseId/submit` and `GET /api/cases/:caseId/submission` endpoints. Server unconditionally recalculates readiness and rejects INCOMPLETE/NEEDS_REVIEW cases (422), blocking on unresolved critical contradictions or unconfirmed facts. Idempotent submission endpoint. Generates synthetic `MOCK-NCRP-YYYYMMDD-NNNNNN` reference format with explicit simulated/mock flags.
- **Files/components affected**: `backend/submission-gateway.js`, `backend/errors.js`, `backend/service.js`, `backend/server.js`, `backend/routes/cases.js`, `backend/tests/submission.test.js`, `package.json`, and documentation.
- **Security/reasoning implications**: Zero external network communication. No real government integration. Mock references are unmistakably non-governmental. Frontend `canSubmit` is never trusted. Case token isolation maintained.
- **Automated verification**: 252 total passed / 0 failed (28 new tests added).
- **Independent manual/API verification**: 12/12 manual/API checks passed (verified READY submission, blocked INCOMPLETE/NEEDS_REVIEW, critical contradiction rejection, forged readiness rejection, idempotency, submission status, case isolation, zero networking, sensitive-data boundary, adapter boundary, and deterministic mock reference).
- **Status**: Implementation complete and verified locally. Documentation updated.

## Prompt 7 — Security Hardening

- **Prompt**: 7
- **Title**: Security Hardening Implementation
- **Objective**: Harden the backend against forgery, partial writes, ID manipulation, and generic error leakage.
- **Implementation completed**: Yes.
- **Major changes**: Added strict create-endpoint validation to reject forged authoritative fields (like `id` or `caseToken`). Implemented rigorous ID format validation (regex) for all route parameters across cases, evidence, facts, events, and contradictions. Evidence storage upgraded to use exclusive creation (`wx` flags) with robust cleanup of partial writes on failure. Enforced that generic errors do not expose stack traces, filesystem paths, secrets, or tokens.
- **Files/components affected**: `backend/routes/cases.js`, `backend/routes/incidents.js`, `backend/routes/evidence.js`, `backend/evidence-store.js`, `backend/server.js`, `tests/security/`, and documentation.
- **Security/reasoning implications**: Maintains all prior protections (evidence content validation, size/path/traversal blocks, cross-case auth, no networking). Ensures evidence remains strictly data. Reiterated absence of AI/LLM, automated accusations, or identity inference. Limitations identified (no token expiry, no deep scanning, no automated TTL, memory volatility).
- **Automated verification**: 264 total passed / 0 failed (12 new tests added). Dedicated security suite: 23 passed / 0 failed.
- **Status**: Implementation complete and verified locally. Documentation updated.
