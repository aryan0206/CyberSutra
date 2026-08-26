# Judge Q&A

## Is this an NCRP product?

No. It is an independent hackathon prototype that helps a citizen organise evidence for their own review. It never submits a real complaint to any government system.

## Does AI determine what happened?

No. The current MVP does not call AI or perform extraction. Its synthetic demo uses hand-authored facts, while deterministic rules validate and the user confirms. AI is only a future architectural concept — if implemented, it would produce source-linked candidates only, never autonomous decisions.

## Is any evidence sent externally?

No. The frontend stores data in browser localStorage only. The backend stores uploaded evidence files locally on the server filesystem. No data is sent to any external service, government system, or third-party API.

## Does the fingerprint prove evidence is genuine?

No. It is a SHA-256 fingerprint of the processed file bytes. It identifies that exact file for this demo but does not establish authenticity, admissibility, government validation, or pre-upload history.

## How is uploaded evidence protected?

- Files are validated server-side: MIME allowlist (PNG, JPEG, PDF, text), 5 MB size limit, filename sanitization.
- Files are stored using server-generated IDs with no extension — never executed, imported, or served.
- Original filenames are sanitized and retained as display metadata only.
- Duplicate uploads are detected by fingerprint and explicitly reported, never silently merged.
- Evidence is scoped to its incident — one case cannot access another case's evidence.

## What happens if the same file is uploaded twice?

The server detects the duplicate by SHA-256 fingerprint and returns an explicit response identifying the existing evidence record. It never silently merges or creates a second copy. The application can explain the relationship to the user.

## How are the tests structured?

103 automated tests across five suites: frontend unit (9), backend domain (51), evidence unit (20), HTTP integration (12), and security (11). All tests use the Node.js built-in test runner with zero test framework dependencies.
