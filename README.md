# CyberSutra

### Connecting the threads of cybercrime.

> CyberSutra is an evidence-readiness layer that helps turn fragmented cybercrime evidence into a structured, traceable incident for human review.

**This is an independent hackathon prototype. It is not an official Government of India / I4C / NCRP product and never submits a real cybercrime complaint.**

---

## 1. The Problem

Cybercrime victims experience incidents as fragmented stories scattered across multiple formats. Evidence is often buried in:
* screenshots
* messages
* transaction records
* emails
* phone numbers
* URLs
* timestamps
* documents

The core problem CyberSutra addresses is the gap between this **fragmented citizen evidence** and **a coherent, structured incident suitable for human review and report preparation**. When evidence is disorganized, reports stall and critical details are lost.

---

## 2. The Solution

CyberSutra bridges this gap using a deterministic workflow:

```text
Fragmented Evidence
        ↓
Evidence Intake
        ↓
Extraction / Classification
        ↓
Structured Incident
        ↓
Entities + Transactions
        ↓
Timeline Reconstruction
        ↓
Missing / Contradictory Information
        ↓
Provenance
        ↓
Human Review
        ↓
Review-Ready Report
        ↓
Mock Submission
```

---

## 3. Key Product Differentiators

### Evidence-linked facts
Important extracted information is rigorously traceable back to its source evidence.
*Note: CyberSutra provides provenance (traceability) to the uploaded files. It does NOT claim to authenticate the legal validity of the evidence itself.*

### Timeline reconstruction
Extracted events are automatically organized into a chronological incident timeline, making the sequence of events immediately understandable.

### Contradiction detection
When sources disagree (e.g., a bank receipt shows ₹18,500 but a text message shows ₹15,500), the conflicting information is explicitly surfaced for resolution rather than silently averaged or ignored.

### Missing information
If critical fields required for a complete report are absent from the evidence, the system explicitly flags this incomplete information for user attention.

### Human-in-the-loop
CyberSutra assists organization and review; **it does not determine guilt**. Uncertain or conflicting information is surfaced for human attention rather than being silently converted into a definitive claim.

---

## 4. Responsible AI / Trust Boundaries

*   **No unsupported facts:** The system does not fabricate missing evidence or present unsupported information as fact.
*   **Provenance:** Derived information remains strictly connected to source evidence.
*   **Uncertainty:** Conflicts or uncertainty are surfaced for review, never hidden.
*   **Human control:** The user remains responsible for confirmation and review.
*   **No guilt determination:** CyberSutra does not determine whether someone is guilty.
*   **No investigation claim:** CyberSutra is an evidence-readiness and organization layer, not a law-enforcement investigation engine.

---

## 5. NCRP / Government Integration Transparency

CyberSutra is designed around the National Cyber Crime Reporting Portal workflow and use case. However:

**The prototype does NOT send a real complaint to a government system. The current government-facing interaction is strictly MOCK / DEMONSTRATION ONLY.**

Production integration would require:
* authorized government APIs/interfaces
* formal identity/access controls
* strict government security requirements
* operational and legal approvals
* production data handling requirements

The UI intentionally displays a persistent warning: **DEMO / MOCK ENVIRONMENT — no report is sent to a government system**.

---

## 6. Architecture

The application is deployed as a single, unified Node.js/Express service.

```text
                ┌─────────────────────┐
                │      Frontend       │
                │ Citizen Evidence UI │
                └──────────┬──────────┘
                           │ (V2 API)
                           ▼
                ┌─────────────────────┐
                │      Backend        │
                │ APIs / Orchestration│
                └──────────┬──────────┘
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
        Evidence       Incident       Validation
        Processing       Model          / Review
             │             │             │
             └─────────────┼─────────────┘
                           ▼
                ┌─────────────────────┐
                │ Review-ready Report │
                └──────────┬──────────┘
                           │
                           ▼
                 Mock Submission Gateway
```

*The frontend is fully integrated with the authoritative backend V2 Cases API.*

---

## 7. Security

The prototype implements the following validated controls:

| Threat | Mitigation |
|---|---|
| Malicious upload | MIME allowlist, 5 MB limit, server-generated filenames without extensions |
| Path traversal | Strict filename sanitization strips `..`, `/`, `\`, and control characters |
| File execution | Uploaded files are never executed, imported, or served |
| XSS via filename | Script tags and special characters stripped |
| Duplicate confusion | SHA-256 integrity fingerprinting ensures deterministic match; explicit 409 response |
| Cross-case access | Evidence scoped strictly to the incident; isolated token boundary |
| Header leakage | `X-Powered-By` disabled, `nosniff` enforced |
| Client-side forgery | Server unconditionally calculates readiness natively |
| Real submission | Zero outbound network calls; explicitly synthetic mock references |

---

## 8. Data / Privacy

**Demo Data Boundary:** The hackathon demonstration utilizes strictly synthetic demo data. No real victim information, real financial credentials, or real passwords should be used in the demo. Government submission is mocked. A production deployment would require comprehensive privacy, retention, access-control, and operational security policies.

---

## 9. Local Development

```bash
# 1. Install backend dependencies
cd backend && npm install && cd ..

# 2. Start the application
node backend/server.js
```

The application will be available at `http://localhost:3001` (unless the `PORT` environment variable is overridden).

---

## 10. Deployed Demo

When evaluating a deployed instance of CyberSutra:
*   Expect a synthetic/mock environment.
*   The intended scenario is to click **"Open synthetic demo case"** to evaluate the complete pipeline.
*   **No government report is actually submitted.**

### Demo Workflow

1. Start an incident
2. Provide fragmented evidence
3. Extract structured facts
4. Reconstruct the incident timeline
5. Review provenance
6. Surface missing/conflicting information
7. Confirm/review findings
8. Prepare review-ready report
9. Demonstrate mock submission

---

## 11. Testing

**Current status: 266/266 tests passing.**

```bash
# Install backend dependencies first
cd backend && npm install && cd ..

# Run all tests
npm run test:all
```

The comprehensive test suite covers frontend formatting, authoritative backend domain modeling, secure file handling, legacy route protection, deterministic report generation, and strict integration boundaries.

---

## 12. Repository Structure

```text
CyberSutra/
├── frontend/              # Citizen-facing UI (Vanilla JS/CSS)
├── backend/               # Authoritative Domain Layer (Node.js/Express)
│   ├── routes/            # V2 API Endpoints
│   ├── domain.js          # Canonical readiness & contradiction logic
│   ├── evidence-store.js  # Secure SHA-256 file handling
│   ├── submission-gateway.js # Mock integration boundary
│   └── tests/             # Backend unit tests
├── tests/
│   ├── integration/       # Full HTTP cycle tests
│   └── security/          # Traversal, MIME, and isolation tests
├── README.md              # Project documentation
└── package.json           # Test orchestration
```

---

## 13. Design Principles

*   **Evidence before assertion:** Important claims should be grounded in supplied evidence.
*   **Traceability:** Users should be able to understand exactly where extracted information came from.
*   **Uncertainty is visible:** Conflicts and missing information should not be silently hidden.
*   **Human review:** The system supports human judgment rather than replacing it.
*   **Honest integration boundaries:** Mock government integration is clearly identified as mock.

---

## 14. What This Prototype Does / Does Not Do

| CyberSutra does | CyberSutra does not |
| --- | --- |
| Organize evidence | Determine guilt |
| Extract structured facts | Replace investigators |
| Reconstruct timelines | Authenticate evidence (legally) |
| Surface missing information | Invent missing evidence |
| Surface contradictions | Silently resolve conflicting sources |
| Preserve provenance | Send a real government complaint |
| Prepare a review-ready report | Replace NCRP |

---

## 15. Future / Production Work (Roadmap)

*   Authorized government integration
*   Stronger identity/access management
*   Production-scale encrypted storage
*   Multilingual evidence handling
*   Additional evidence formats
*   Stronger operational audit controls
