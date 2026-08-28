# CyberSutra Engineering Playbook

> Connecting the threads of cybercrime.

## Mission

Build a trustworthy citizen-side evidence-readiness layer for cybercrime reporting.

## Operating principle

CyberSutra does not decide what happened. It helps a citizen accurately organise what they can show about what happened.

AI interprets. Rules validate. Provenance explains. Humans confirm. Government systems remain authoritative.

## Architecture Guidelines

- **Authoritative Deterministic Reasoning**: The backend `domain.js` is the authoritative deterministic reasoning layer for provenance, field-aware value normalization, contradiction detection, timeline construction, and readiness calculation. The frontend core rules mirror backend domain logic where necessary for optimistic UI, but the server is the absolute authority.
- **Deterministic Report Assembly**: Reports must be deterministically assembled (`report.js`) from the authoritative case state without any LLM inference or fabrication.
- **Adapter-Based Integration**: External system integrations (like government submission) must use the `SubmissionGateway` adapter boundary. The mock adapter ensures zero outbound network communication and prevents coupling core domain logic to external APIs.
- **No External State**: Do not rely on external cloud storage or remote databases in the MVP. Use in-memory persistence and local file storage.
- **Immutable Provenance**: Every extracted fact must link directly to its evidence source. Never present an AI-generated fact without its evidence fingerprint.
- **Explicit Conflict Resolution**: Do not silently merge conflicting data. Represent contradictions explicitly and force a human-in-the-loop resolution.

## Security Posture

- Treat all evidence uploads as hostile.
- Rely on deterministic validation before AI processing.
- Never execute uploaded files.
- Scope all evidence and facts strictly to the incident boundary.
- Validate all route parameter IDs strictly against expected UUID formats.
- Explicitly strip authoritative fields (`id`, `caseToken`, `state`) from creation payloads.
- Use exclusive file creation flags (`wx`) for evidence storage and clean up partial writes.
- Redact all generic error responses to prevent internal leakage.

## Testing Expectations

- **Zero Dependency Testing**: Prefer `node:test` and `node:assert`.
- **Comprehensive Coverage**: Ensure domain logic, integration paths, and security boundaries (path traversal, MIME injection, etc.) are heavily tested.
- Run `npm run test:all` before any commit. 100% pass rate is strictly required.
