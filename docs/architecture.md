# Architecture

## High-Level Flow

Untrusted input → probabilistic extraction (future) → deterministic validation → human confirmation → mock adapter.

## System Components

1. **Frontend (Browser)**
   - Vanilla HTML/JS/CSS.
   - `core.js`: Domain rules implemented client-side for immediate feedback.
   - `app.js`: UI coordination, localStorage state, and synthetic demo logic.

2. **Backend (Node.js/Express)**
   - Authoritative domain layer (`domain.js`) replicating and securing the frontend rules.
   - Evidence ingestion via `multer` to local disk (`evidence-store.js`).
   - In-memory repository (`repository.js`) for incident tracking.
   - REST API routes (`routes/incidents.js`, `routes/evidence.js`) for evidence submission.

3. **Integration (Planned)**
   - The frontend currently uses a standalone local-only mock. Future integration will connect the frontend directly to the backend API for persistent evidence storage and validation.

4. **AI Layer (Planned)**
   - A proposed asynchronous extraction pipeline that analyzes evidence to propose source-linked candidate facts. Must remain non-authoritative.
