# Testing Strategy

CyberSutra relies on a zero-dependency testing strategy using the native `node:test` module. The project maintains strict coverage across multiple boundaries.

## Test Suites (103 Total Tests)

1. **Frontend Unit (`tests/unit/core-logic.test.js`)**: 
   - Validates client-side state machine, readiness gating, and Web Crypto SHA-256 fingerprinting.

2. **Backend Domain (`backend/tests/domain.test.js`)**: 
   - Authoritative domain parity with frontend. 
   - Fact creation, contradiction logic, state transitions, validation.

3. **Evidence Unit (`backend/tests/evidence.test.js`)**: 
   - File storage behavior, SHA-256 determinism, and service-level duplicate detection.

4. **Integration (`tests/integration/evidence-upload.test.js`)**: 
   - End-to-end HTTP tests over Express. 
   - Validates correct request parsing, correct status codes (201, 400, 404, 409), and evidence lifecycle (upload, list, get, delete).

5. **Security (`tests/security/evidence-security.test.js`)**: 
   - Hostile input validation.
   - Path traversal, executable MIME rejection, HTML/JS injection, header verification, and cross-case isolation.

## Execution

Run all tests via:
`npm run test:all`

Continuous integration should block any commits that fail tests or introduce warnings.
