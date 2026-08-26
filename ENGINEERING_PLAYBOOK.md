# CyberSutra Engineering Playbook

> Connecting the threads of cybercrime.

## Mission

Build a trustworthy citizen-side evidence-readiness layer for cybercrime reporting.

## Operating principle

CyberSutra does not decide what happened. It helps a citizen accurately organise what they can show about what happened.

AI interprets. Rules validate. Provenance explains. Humans confirm. Government systems remain authoritative.

## Architecture Guidelines

- **Frontend/Backend Symmetry**: The backend `domain.js` is the authoritative source of truth. The frontend core rules should mirror backend domain logic as closely as possible to maintain a fast, optimistic UI without diverging from server-enforced security.
- **No External State**: Do not rely on external cloud storage or remote databases in the MVP. Use in-memory persistence and local file storage.
- **Immutable Provenance**: Every extracted fact must link directly to its evidence source. Never present an AI-generated fact without its evidence fingerprint.
- **Explicit Conflict Resolution**: Do not silently merge conflicting data. Represent contradictions explicitly and force a human-in-the-loop resolution.

## Security Posture

- Treat all evidence uploads as hostile.
- Rely on deterministic validation before AI processing.
- Never execute uploaded files.
- Scope all evidence and facts strictly to the incident boundary.

## Testing Expectations

- **Zero Dependency Testing**: Prefer `node:test` and `node:assert`.
- **Comprehensive Coverage**: Ensure domain logic, integration paths, and security boundaries (path traversal, MIME injection, etc.) are heavily tested.
- Run `npm run test:all` before any commit. 100% pass rate is strictly required.
