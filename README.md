# CyberSutra

> Connecting the threads of cybercrime.

CyberSutra is a citizen-side evidence-readiness prototype for online financial cyber fraud. It transforms fragmented evidence — screenshots, bank receipts, SMS messages — into a structured, validated, submission-ready report.

**This is an independent hackathon prototype. It is not an official Government of India / I4C / NCRP product and never submits a real cybercrime complaint.**

---

## Run the prototype

### Frontend only (browser-side demo)

```bash
cd frontend
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). Choose **Open synthetic demo case** to exercise provenance, SHA-256 integrity fingerprints, contradiction resolution, readiness gating, and mock submission. Any static HTTP server works.

### Backend API server

```bash
cd backend
npm install
node server.js
```

The backend listens on port `3001` (override with `PORT` env var). Evidence upload, retrieval, and deletion are available via the REST API. The frontend currently operates independently using local browser storage; backend integration is a planned future step.

### Run tests

```bash
# Install backend dependencies first
cd backend && npm install

# Run all tests
npm run test:all
```

**Current status: 189 tests, 189 passing, 0 failing.**

---

## The Problem

Cybercrime victims experience incidents as fragmented stories across messages, screenshots, transactions, and URLs, while formal reporting requires structured information. The gap between raw evidence and a coherent report is where cases stall.

## The Solution

CyberSutra bridges that gap with a deterministic pipeline:

**Evidence → Incident → Timeline → Validation → Report Readiness → Review → Mock Submission**

## Why This Is Different

- Not a chatbot. Not a fraud detector. Not a police investigation system.
- CyberSutra does not decide what happened. It helps a citizen accurately organise what they can show about what happened.
- AI interprets. Rules validate. Provenance explains. Humans confirm. Government systems remain authoritative.

---

## Key Capabilities

| Capability | Status | Implementation |
|---|---|---|
| Evidence intake (upload) | ✅ Implemented | Frontend (browser) + Backend (Express/multer) |
| SHA-256 integrity fingerprinting | ✅ Implemented | Frontend (Web Crypto) + Backend (node:crypto) |
| MIME/size validation | ✅ Implemented | PNG, JPEG, PDF, plain text; 5 MB limit |
| Filename sanitization | ✅ Implemented | Path traversal, control chars, script injection stripped |
| Duplicate detection | ✅ Implemented | Deterministic fingerprint match; never silently merges |
| Provenance tracking | ✅ Implemented | Every fact links to its evidence source |
| Contradiction detection | ✅ Implemented | Deterministic, field-aware normalization; e.g. ₹18,500 vs 18500 match |
| Contradiction resolution | ✅ Implemented | Explicit user choice; rejected values preserved historically |
| Missing-information detection | ✅ Implemented | Required fields checked, produces human-readable blockers |
| Readiness gating | ✅ Implemented | INCOMPLETE → NEEDS_REVIEW → READY state machine (server-authoritative) |
| Mock submission | ✅ Implemented | Local-only; generates a mock acknowledgement |
| Synthetic demo case | ✅ Implemented | Hand-authored facts demonstrating the full pipeline |
| AI extraction | ❌ Not implemented | Future: source-linked candidates only |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    Frontend                      │
│  index.html ← app.js ← core.js                 │
│  Browser-side demo with localStorage            │
└─────────────────┬───────────────────────────────┘
                  │ (planned integration)
┌─────────────────▼───────────────────────────────┐
│                    Backend                       │
│  server.js → routes/ → service.js → domain.js  │
│  evidence-store.js    repository.js   config.js │
│                                                  │
│  Express + multer (2 dependencies)              │
│  In-memory case repository                      │
│  File-based evidence storage                    │
└─────────────────────────────────────────────────┘
```

The backend `domain.js` is the authoritative deterministic reasoning layer for:
- provenance-aware fact handling
- field-aware value normalization
- contradiction detection and resolution
- reviewed_unresolved conflicts
- missing-information detection
- readiness calculation
- deterministic timeline construction

No machine learning or external AI is used in this reasoning layer; it is purely deterministic and rule-based.

## Technology

| Layer | Stack |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, Web Crypto API, localStorage |
| Backend | Node.js (ESM), Express 4, multer |
| Persistence | In-memory Map (backend), localStorage (frontend) |
| File storage | Filesystem with server-generated IDs, no extensions |
| Testing | Node.js built-in test runner (`node:test`) |
| Dependencies | 2 backend packages (express, multer). Zero frontend deps. |

---

## Security

| Threat | Mitigation | Status |
|---|---|---|
| Malicious upload | MIME allowlist, size limit, server-generated filenames | ✅ |
| Path traversal | `sanitizeFilename()` strips `..`, `/`, `\`, control chars | ✅ |
| File execution | Uploaded files never executed, imported, or served; no extension | ✅ |
| XSS via filename | Script tags and special characters stripped from display names | ✅ |
| Oversized file | 5 MB limit enforced by multer and domain validation | ✅ |
| Prompt injection | Evidence treated as data, never as instructions | ✅ |
| Arbitrary URL fetch | Never automatically fetches user-provided URLs | ✅ |
| Duplicate confusion | Explicit 409 response with relationship info; never silently merges | ✅ |
| Cross-case access | Evidence scoped to incident; cross-case retrieval returns 404 | ✅ |
| Header leakage | `X-Powered-By` disabled, `nosniff`, `X-Frame-Options: DENY` | ✅ |
| Submitted case mutation | Service rejects all modifications to submitted incidents | ✅ |
| PII in evidence | Evidence is untrusted data; no content extraction in MVP | ✅ |

See [`SECURITY_MODEL.md`](SECURITY_MODEL.md) and [`THREAT_MODEL.md`](THREAT_MODEL.md) for full details.

---

## Mock / Production Boundary

| Feature | Mock (current) | Production (future) |
|---|---|---|
| Evidence storage | In-memory + local filesystem | Encrypted persistent storage |
| Case persistence | In-memory Map / localStorage | Database with access control |
| Authentication | None | Session-based or OAuth |
| Government submission | Mock acknowledgement | Authorized NCRP integration |
| AI extraction | Not implemented | Source-linked candidate facts |
| Data retention | Session-scoped, ephemeral | Policy-governed retention |

---

## Testing

| Suite | Tests | What it covers |
|---|---|---|
| Frontend unit (`tests/unit/`) | 9 | Readiness, contradictions, SHA-256, upload validation, serialization |
| Backend domain (`backend/tests/domain.test.js`) | 51 | Domain model parity with frontend, validation, state transitions |
| Evidence unit (`backend/tests/evidence.test.js`) | 20 | Fingerprinting, file storage, upload, duplicate detection, isolation |
| Integration (`tests/integration/`) | 12 | Full HTTP upload/retrieve/delete cycle through Express |
| Security (`tests/security/`) | 11 | Path traversal, MIME enforcement, headers, cross-case isolation |
| **Total** | **103** | **All passing** |

---

## Project Structure

```
CyberSutra/
├── frontend/              # Browser-side prototype
│   ├── index.html
│   ├── app.js             # UI logic and demo case
│   ├── core.js            # Domain rules (client-side)
│   ├── styles.css
│   └── enhancements.css
├── backend/               # Authoritative domain layer
│   ├── server.js          # Express app bootstrap
│   ├── config.js          # Environment configuration
│   ├── domain.js          # Canonical domain model and rules
│   ├── service.js         # Domain service orchestration
│   ├── repository.js      # In-memory case persistence
│   ├── evidence-store.js  # Secure file storage + SHA-256
│   ├── routes/
│   │   ├── evidence.js    # Evidence upload/retrieval/deletion
│   │   └── incidents.js   # Incident create/retrieve
│   └── tests/
│       ├── domain.test.js
│       └── evidence.test.js
├── tests/
│   ├── unit/              # Frontend unit tests
│   ├── integration/       # HTTP integration tests
│   └── security/          # Security-focused tests
├── docs/                  # Design documents
├── ai/                    # Planned AI extraction (not implemented)
├── mock-data/             # Planned test fixtures
├── rules/                 # Validation rule definitions
├── PRODUCT_SPEC.md
├── AI_CONTRACT.md
├── ENGINEERING_PLAYBOOK.md
├── SECURITY_MODEL.md
├── THREAT_MODEL.md
├── JUDGE_QA.md
├── DEMO_SCRIPT.md
├── CODEX_LOG.md
└── package.json
```

---

## Limitations

- No AI extraction, OCR, or external model calls. The synthetic demo uses hand-authored facts.
- No authentication or authorization beyond submitted-case immutability.
- In-memory persistence — data is lost on server restart.
- Frontend and backend are not yet integrated; they operate independently.
- No production deployment infrastructure.
- Single cybercrime category (online financial fraud).
- English only.

## Future Roadmap

- Frontend ↔ backend integration
- AI extraction layer (source-linked candidates, never autonomous)
- Additional cybercrime categories
- Authorized government integration
- Multilingual expansion
- Production-grade security and persistence infrastructure

---

## Disclaimer

CyberSutra is an independent prototype and is **not** an official Government of India / I4C / NCRP product. It does not submit real cybercrime complaints, contact government systems, or claim legal validity. The SHA-256 fingerprint identifies the exact file bytes processed for this demo but does not establish authenticity, admissibility, or government validation.
