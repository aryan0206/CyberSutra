# Data Model

The CyberSutra domain is defined by a strict set of entities mapping the citizen journey from raw upload to validated report.

## Core Entities

- **Incident**: The root boundary. Contains a collection of facts, events, contradictions, and evidence. Determines the overall `readiness` status.
- **Evidence**: A strictly immutable record of a provided file or text. Contains an integrity `fingerprint` (SHA-256), `mimeType`, and sanitized `filename`.
- **Fact**: An extracted or user-entered piece of information. Each fact must declare a `provenanceType` (`extracted`, `user_entered`, `synthetic_demo`) and reference its source `evidenceId`.
- **Event**: A timestamped occurrence building the incident timeline. Events begin as `candidate` and must be explicitly `confirmed`.
- **Contradiction**: Detected when multiple facts assert different values for the same logical field (e.g., `transaction_amount`). Forces a resolution state (`unresolved`, `reviewed_unresolved`, `resolved`).

See `PRODUCT_SPEC.md` for the overarching product boundary.
