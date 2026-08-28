| Threat              | Example                               | Mitigation                     |
| ------------------- | ------------------------------------- | ------------------------------ |
| Prompt injection    | Screenshot says "ignore instructions" | Treat evidence as data         |
| XSS                 | Malicious extracted text              | Sanitize rendering             |
| Malicious upload    | Executable renamed `.png`             | MIME/type validation           |
| Oversized file      | 500MB upload                          | Size limits                    |
| Path traversal      | `../../secret`                        | Server-generated filenames     |
| Secret exposure     | API key in frontend                   | Server-side env vars           |
| PII leakage         | Evidence in logs                      | Redacted structured logs       |
| Hallucination       | Invented transaction ID               | Null + confirmation            |
| False accusation    | AI labels someone criminal            | No guilt/identity claims       |
| Data persistence    | Sensitive case stored indefinitely    | Session/minimal retention      |
| Unauthorized access | Case ID guessed                       | Authorization/session binding  |
| Arbitrary URL fetch | User submits malicious URL            | Never automatically fetch      |
| Model failure       | API timeout                           | Graceful fallback/manual entry |
| Contradiction       | ₹18,500 vs ₹15,500                    | Explicit conflict state        |
| Client forgery      | Client sends `state: READY`           | Server-authoritative gating    |
| Submission leakage  | Case token returned in ack            | Token strictly excluded        |
| Fake real submission| Mock ID looks real                    | `MOCK-NCRP-` prefix enforced   |
| Field forgery       | Client provides fake `id`/`token`     | Strict creation filtering      |
| ID manipulation     | Non-UUID strings sent in URL          | Strict regex route validation  |
| Partial write       | Race condition overwrites evidence    | Exclusive file creation (`wx`) |
| Error leakage       | Stack trace reveals file paths        | Generic error redaction        |
