import {
  validateUpload,
  sha256Hex,
  isManualFact,
} from "./core.js";

const KEY = "cybersutra.mock.case.v2";
const TOKEN_KEY = "cybersutra.mock.token.v2";
const STEPS = [
  "Describe",
  "Evidence",
  "Timeline",
  "Review",
  "Readiness",
  "Report",
  "Acknowledgement",
];
const $ = (selector, root = document) => root.querySelector(selector);
const html = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const shortHash = (hash) =>
  hash
    ? `${hash.slice(0, 6)}\u2026${hash.slice(-4)}`
    : "No file fingerprint available";

// ---------------------------------------------------------------------------
// API client — all authoritative state flows through the V2 Cases API
// ---------------------------------------------------------------------------

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function authHeaders() {
  return { "X-Case-Token": getToken() };
}

const api = {
  async createCase(description) {
    const res = await fetch("/api/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: description || "" }),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async createDemoCase() {
    const res = await fetch("/api/cases/demo", { method: "POST" });
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async getCase(caseId) {
    const res = await fetch(`/api/cases/${caseId}`, { headers: authHeaders() });
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async updateDescription(caseId, description) {
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ description }),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async uploadEvidence(caseId, file) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/cases/${caseId}/evidence`, {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async deleteEvidence(caseId, evidenceId) {
    const res = await fetch(`/api/cases/${caseId}/evidence/${evidenceId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async addFact(caseId, factParams) {
    const res = await fetch(`/api/cases/${caseId}/facts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(factParams),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async confirmFact(caseId, factId, confirmed) {
    const res = await fetch(`/api/cases/${caseId}/facts/${factId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ confirmed }),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async confirmEvent(caseId, eventId, confirmed) {
    const res = await fetch(`/api/cases/${caseId}/events/${eventId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ confirmed }),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async resolveContradiction(caseId, contradictionId, choice) {
    const res = await fetch(
      `/api/cases/${caseId}/contradictions/${contradictionId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ choice }),
      },
    );
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async getReport(caseId) {
    const res = await fetch(`/api/cases/${caseId}/report`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async submitCase(caseId) {
    const res = await fetch(`/api/cases/${caseId}/submit`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  },
};

async function apiError(res) {
  try {
    const data = await res.json();
    return new Error(data.message || data.error || `Request failed (${res.status})`);
  } catch {
    return new Error(`Request failed (${res.status})`);
  }
}

// ---------------------------------------------------------------------------
// Application state — incident + readiness from the backend
// ---------------------------------------------------------------------------

let state = null;
let readiness = null;

/** Refresh state from the backend. */
async function refreshState() {
  if (!state) return;
  const data = await api.getCase(state.id);
  state = data.incident;
  readiness = data.readiness;
}

/** Apply a mutation response: { incident, readiness }. */
function applyResponse(data) {
  if (data.incident) state = data.incident;
  if (data.readiness) readiness = data.readiness;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function load() {
  try {
    const caseId = localStorage.getItem(KEY);
    if (!caseId) return null;
    const token = getToken();
    if (!token) return null;
    const res = await fetch(`/api/cases/${caseId}`, {
      headers: { "X-Case-Token": token },
    });
    if (!res.ok) return null;
    const data = await res.json();
    readiness = data.readiness;
    return data.incident;
  } catch {
    return null;
  }
}

async function createNewCase() {
  const data = await api.createCase();
  localStorage.setItem(TOKEN_KEY, data.caseToken);
  localStorage.setItem(KEY, data.incident.id);
  state = data.incident;
  readiness = data.readiness || null;
}

async function loadDemoCase() {
  const data = await api.createDemoCase();
  localStorage.setItem(TOKEN_KEY, data.caseToken);
  localStorage.setItem(KEY, data.incident.id);
  state = data.incident;
  readiness = data.readiness;
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

function progress(active) {
  const currentLabel = STEPS[active];
  return `
    <nav class="progress" aria-label="Case progress">
      <div class="progress-mobile" aria-hidden="true">
        Step ${active + 1} of ${STEPS.length} &middot; ${currentLabel}
      </div>
      <ol class="progress-desktop">
        ${STEPS.map((label, index) => {
          const stateClass = index === active ? "current" : index < active ? "done" : "upcoming";
          const ariaCurrent = index === active ? 'aria-current="step"' : '';
          return `<li class="${stateClass}" ${ariaCurrent}>
            <span class="step-num">${index + 1}</span>
            <span class="step-label">${label}</span>
          </li>`;
        }).join("")}
      </ol>
    </nav>`;
}

function evidenceName(evidenceId) {
  return (
    state.evidence.find((item) => item.id === evidenceId)?.filename ||
    "User-entered information"
  );
}

function resolutionLabel(conflict) {
  if (conflict.status === "unresolved") return "Not reviewed";
  if (conflict.status === "reviewed_unresolved")
    return "Reviewed \u2014 unable to verify";
  return `Resolved: use ${conflict.resolution?.value} from ${evidenceName(conflict.resolution?.evidenceId)}. Other conflicting value(s) remain preserved as historical evidence.`;
}

// ---------------------------------------------------------------------------
// View renderers — same DOM structure and visual behavior as before
// ---------------------------------------------------------------------------

function render() {
  const app = $("#app");
  if (!state) {
    app.innerHTML = "";
    app.append($("#landing-template").content.cloneNode(true));
    bind();
    return;
  }
  const page = location.hash.slice(1) || "describe";
  const views = {
    describe,
    evidence: evidenceView,
    timeline,
    review,
    readiness: readinessView,
    report: reportView,
    acknowledgement,
  };
  app.innerHTML = (views[page] || describe)();
  bind();
}

function describe() {
  return `
    ${progress(0)}
    <h1 class="page-title">Tell us what happened</h1>
    <p class="subtle">Use your own words to describe the incident. This helps establish context for the evidence you'll upload next.</p>
    <form id="descriptionForm" class="card">
      <div class="field">
        <label for="description">Incident Description</label>
        <p class="subtle" style="font-size: 0.85rem; margin-top: 0; margin-bottom: 0.5rem;" id="desc-hint">Briefly summarize the events. Maximum 3000 characters.</p>
        <textarea id="description" required maxlength="3000" aria-describedby="desc-hint" placeholder="E.g., On Tuesday, I received an SMS...">${html(state.description)}</textarea>
      </div>
      <div class="step-actions">
        <button type="submit" class="primary" id="saveDescriptionBtn">Save and continue</button>
      </div>
    </form>`;
}

function fingerprint(ev) {
  return ev.integrityFingerprint
    ? `<details class="fingerprint">
        <summary style="cursor:pointer; color: var(--teal); font-weight: 600; font-size: 0.85rem; margin-top: 0.5rem;">File integrity fingerprint</summary>
        <div style="margin-top:0.5rem; padding: 0.5rem; background: var(--bg); border-radius: 4px; border: 1px solid var(--line);">
          <p style="font-size: 0.8rem; margin-top: 0;">This SHA-256 fingerprint identifies the exact file processed. It does not establish legal authenticity.</p>
          <code>${html(ev.integrityFingerprint)}</code>
          <button class="text-button" data-copy-hash="${ev.id}" type="button" style="padding: 0.4rem 0; min-height: auto; margin-top: 0.5rem; display: block;">Copy full fingerprint</button>
        </div>
       </details>`
    : '';
}

function evidenceView() {
  const selected = state._selectedEvidenceId;
  return `
    ${progress(1)}
    <h1 class="page-title">Evidence Locker</h1>
    <p class="subtle">Upload screenshots, receipts, or documents. Your files are organized here for your report.</p>

    <div class="card upload">
      <label for="file" style="display:block; font-weight: 600; margin-bottom: 0.5rem; cursor: pointer;">Upload evidence</label>
      <p class="subtle" style="font-size: 0.85rem; margin-top: 0; margin-bottom: 1rem;">Supported formats: PNG, JPEG, PDF, TXT (up to 5 MB).</p>
      <input id="file" type="file" accept="image/png,image/jpeg,application/pdf,text/plain" style="margin: 0 auto; display: block;" />
      <p id="uploadStatus" class="subtle hidden" aria-live="polite" style="margin-top: 1rem; font-weight: 600; color: var(--teal);">Uploading and analyzing...</p>
      <p id="uploadError" class="error hidden" role="alert" style="margin-top: 1rem; text-align: left;"></p>
    </div>

    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1rem;">
        <h2 style="margin: 0; font-size: 1.25rem; color: var(--navy);">Files attached</h2>
        <span class="status" style="background: var(--bg); border: 1px solid var(--line);">${state.evidence.length} items</span>
      </div>
      ${state.evidence.length ? state.evidence.map((item, index) => `
        <section class="evidence-item ${selected === item.id ? "selected" : ""}" id="evidence-${item.id}">
          <div class="item" style="align-items: flex-start;">
            <div style="flex: 1; min-width: 0;">
              <strong style="display:block; font-size: 1rem; color: var(--navy); margin-bottom: 0.3rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${html(item.filename)}</strong>
              <div style="font-size: 0.85rem; color: var(--muted); display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                <span>${html(item.type)}</span>
                <span style="color: var(--line);">&bull;</span>
                <span>${Math.round(item.size / 1024)} KB</span>
                <span style="color: var(--line);">&bull;</span>
                <span class="status" style="padding: 0.15rem 0.4rem;">${html(item.processingStatus)}</span>
              </div>
              ${fingerprint(item)}
            </div>
            <div style="margin-left: 1rem; flex-shrink: 0;">
              <button class="danger" data-remove="${item.id}" aria-label="Remove ${html(item.filename)}" style="padding: 0.4rem 0.8rem; min-height: 36px; font-size: 0.85rem;">Remove</button>
            </div>
          </div>
        </section>
      `).join("") : '<p class="subtle">No evidence added yet. You can still enter details manually later in the review step.</p>'}
    </div>

    <div class="step-actions">
      <a class="secondary" href="#describe">Back</a>
      <a class="primary" href="#timeline">Continue to timeline</a>
    </div>`;
}

function timeline() {
  const events = [...(state.events || [])].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  return `
    ${progress(2)}
    <h1 class="page-title">Timeline</h1>
    <p class="subtle">Events begin as candidates. Please confirm the chronological sequence of the incident.</p>

    <div class="card timeline">
      ${events.length ? `
        <ol style="list-style: none; padding: 0; margin: 0;">
          ${events.map((event) => `
            <li style="margin-bottom: 2rem; position: relative;">
              <article>
                <div style="display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 0.5rem;">
                  <strong style="color: var(--navy); font-size: 1.05rem;">${new Date(event.timestamp).toLocaleString()}</strong>
                  <span class="status ${event.userConfirmed ? "ready" : "warning"}">
                    ${event.userConfirmed ? "USER-CONFIRMED" : "NEEDS REVIEW"}
                  </span>
                </div>
                <p style="margin: 0.25rem 0 0.75rem; color: var(--ink);">${html(event.description)}</p>

                <div style="font-size: 0.85rem; color: var(--muted); margin-bottom: 1rem;">
                  ${event.evidenceIds.length ? `Source: ${event.evidenceIds.map(evidenceName).map(html).join(", ")}` : 'Source: User entered'}
                </div>

                <div>
                  <button class="${event.userConfirmed ? 'secondary' : 'primary'}" data-event-confirm="${event.id}">
                    ${event.userConfirmed ? "Unconfirm event" : "Confirm event"}
                  </button>
                </div>
              </article>
            </li>
          `).join("")}
        </ol>
      ` : '<p class="subtle">No timestamped evidence is available yet.</p>'}
    </div>

    <div class="step-actions">
      <a class="secondary" href="#evidence">Back</a>
      <a class="primary" href="#review">Continue to review</a>
    </div>`;
}

function review() {
  return `
    ${progress(3)}
    <h1 class="page-title">Review the details</h1>
    <p class="subtle">Please verify the extracted information and provide any missing details.</p>

    <div class="card">
      <h2 style="margin-top: 0; font-size: 1.25rem; color: var(--navy); margin-bottom: 1rem;">Extracted & Entered Details</h2>
      <div class="facts-container">
        ${state.facts.length ? `
          <table class="facts">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Value</th>
                <th scope="col">Source</th>
                <th scope="col">Confirmation</th>
              </tr>
            </thead>
            <tbody>
              ${state.facts.map((item) => {
                const isManual = isManualFact(item);
                const sourceBadge = isManual
                  ? '<span class="status">USER-ENTERED</span>'
                  : `<button class="source" data-source="${item.evidenceId}" aria-label="View source for ${html(item.field.replaceAll("_", " "))}">${html(item.sourceReference)}</button>`;

                return `
                <tr>
                  <th scope="row" style="font-weight: 600; color: var(--navy);">${html(item.field.replaceAll("_", " "))}</th>
                  <td data-label="Value">${html(item.value)}</td>
                  <td data-label="Source">${sourceBadge}</td>
                  <td data-label="Confirmation">
                    ${isManual
                      ? '<span class="status ready">Confirmed</span>'
                      : `<label><input type="checkbox" data-fact-confirm="${item.id}" ${item.userConfirmed ? "checked" : ""} aria-label="Confirm ${html(item.field.replaceAll("_", " "))}"/> Confirm</label>`
                    }
                  </td>
                </tr>
              `}).join("")}
            </tbody>
          </table>
        ` : '<p class="subtle">No details have been extracted or entered yet.</p>'}
      </div>
    </div>

    <div class="card" style="background: var(--bg); border: 1px dashed var(--line);">
      <h2 style="margin-top: 0; font-size: 1.15rem; color: var(--navy); margin-bottom: 0.5rem;">Add missing detail</h2>
      <p class="subtle" style="font-size: 0.85rem; margin-bottom: 1rem;">If the system missed a key detail like an amount or date, you can add it manually here.</p>
      <form id="factForm" class="grid" style="align-items: end;">
        <div class="field" style="margin: 0;">
          <label for="factField">Field</label>
          <select id="factField">
            <option value="transaction_amount">Transaction amount</option>
            <option value="transaction_id">Transaction ID</option>
            <option value="transaction_timestamp">Transaction time</option>
            <option value="payment_institution">Payment institution</option>
            <option value="phone_number">Phone number</option>
          </select>
        </div>
        <div class="field" style="margin: 0;">
          <label for="factValue">Value</label>
          <input id="factValue" maxlength="160" required />
        </div>
        <div style="margin-bottom: 2px;">
          <button class="secondary" style="width: 100%;">Add detail</button>
        </div>
      </form>
    </div>

    <div class="step-actions">
      <a class="secondary" href="#timeline">Back</a>
      <a class="primary" href="#readiness">Check readiness</a>
    </div>`;
}

function readinessView() {
  const r = readiness || { state: "INCOMPLETE", missing: [], criticalOpen: false, unconfirmedRequired: false, canSubmit: false };

  let readinessHeader = "";
  if (r.state === "READY") {
    readinessHeader = `
      <div class="success" style="margin-bottom: 2rem;">
        <h2 style="margin-top: 0; font-size: 1.25rem; color: var(--success-text);">You're ready</h2>
        <p style="margin-bottom: 0;">All required information has been reviewed. You can now proceed to the mock report.</p>
      </div>`;
  } else {
    readinessHeader = `
      <div class="card" style="border-left: 4px solid var(--warn-text); background: var(--warn-bg);">
        <h2 style="margin-top: 0; font-size: 1.25rem; color: var(--warn-text);">Almost ready</h2>
        <p style="margin-bottom: 0; color: var(--warn-text);">Some items need your attention before generating the report.</p>
      </div>`;
  }

  const checklistItems = [];
  checklistItems.push(`<li style="margin-bottom: 0.5rem;">✓ Incident details provided</li>`);
  checklistItems.push(`<li style="margin-bottom: 0.5rem;">✓ Evidence attached</li>`);

  if (r.missing.length) {
    checklistItems.push(`<li style="margin-bottom: 0.5rem; color: var(--danger-text);">⚠ Missing critical information: ${r.missing.map((field) => html(field.replaceAll("_", " "))).join(", ")}</li>`);
  } else {
    checklistItems.push(`<li style="margin-bottom: 0.5rem;">✓ Required fields present</li>`);
  }

  if (r.unconfirmedRequired) {
    checklistItems.push(`<li style="margin-bottom: 0.5rem; color: var(--warn-text);">⚠ Required evidence-derived values need confirmation</li>`);
  } else {
    checklistItems.push(`<li style="margin-bottom: 0.5rem;">✓ Required values confirmed</li>`);
  }

  if (r.criticalOpen) {
    checklistItems.push(`<li style="margin-bottom: 0.5rem; color: var(--danger-text);">⚠ Contradictions need explicit resolution</li>`);
  } else if (state.contradictions.length > 0) {
    checklistItems.push(`<li style="margin-bottom: 0.5rem;">✓ Contradictions resolved</li>`);
  }

  return `
    ${progress(4)}
    <h1 class="page-title">Report Readiness</h1>

    ${readinessHeader}

    <div class="card">
      <h3 style="margin-top: 0;">Pre-submission Checklist</h3>
      <ul style="list-style: none; padding: 0; margin: 0; font-weight: 500;">
        ${checklistItems.join("")}
      </ul>
      <p class="subtle" style="font-size: 0.85rem; margin-top: 1rem;">This state is calculated by explicit rules, not an acceptance prediction.</p>
    </div>

    ${state.contradictions.length ? `
      <div class="card">
        <h2 style="margin-top: 0;">Contradictions</h2>
        <p class="subtle">We found conflicting information in your evidence. Which value is correct?</p>

        ${state.contradictions.map((conflict) => `
          <section class="contradiction">
            <h3 style="margin-top: 0; font-size: 1.05rem;">
              ${html(conflict.field.replaceAll("_", " "))} mismatch
              <span class="status ${conflict.status === "resolved" ? "ready" : "warning"}">${html(conflict.status.replaceAll("_", " "))}</span>
            </h3>
            <p style="font-size: 0.9rem; color: var(--muted);">${html(resolutionLabel(conflict))}</p>

            <form data-conflict-form="${conflict.id}">
              <fieldset style="border: none; padding: 0; margin: 0;">
                <legend class="hidden">Resolve ${html(conflict.field.replaceAll("_", " "))}</legend>
                ${conflict.factIds.map((factId) => {
                  const fact = state.facts.find((item) => item.id === factId);
                  return `
                    <label class="choice">
                      <input type="radio" name="${conflict.id}" value="${fact.id}" ${conflict.resolution?.chosenFactId === fact.id ? "checked" : ""} style="margin-right: 0.75rem;" />
                      Use <strong>${html(fact.value)}</strong> from ${html(evidenceName(fact.evidenceId))}
                    </label>
                  `;
                }).join("")}
                <label class="choice">
                  <input type="radio" name="${conflict.id}" value="unresolved" ${conflict.status === "reviewed_unresolved" ? "checked" : ""} style="margin-right: 0.75rem;" />
                  Mark as unresolved / unable to verify
                </label>
              </fieldset>
              <button class="secondary" style="margin-top: 0.5rem;">Save resolution</button>
            </form>
          </section>
        `).join("")}
      </div>
    ` : ""}

    <div class="step-actions">
      <a class="secondary" href="#review">Back</a>
      <a class="primary" href="#report">Review report</a>
    </div>`;
}

function reportView() {
  const r = readiness || { state: "INCOMPLETE", canSubmit: false };
  const events = [...(state.events || [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let readinessUI = "";
  if (r.canSubmit) {
    readinessUI = `
      <div class="success" style="margin-bottom: 2rem;">
        <h2 style="margin-top: 0; font-size: 1.15rem; color: var(--success-text);">READY FOR MOCK SUBMISSION</h2>
        <ul style="list-style: none; padding: 0; margin: 0; font-weight: 500;">
          <li style="margin-bottom: 0.25rem;">✓ Incident details</li>
          <li style="margin-bottom: 0.25rem;">✓ Evidence</li>
          <li style="margin-bottom: 0.25rem;">✓ Timeline</li>
          <li>✓ Required information reviewed</li>
        </ul>
      </div>`;
  } else {
    readinessUI = `
      <div class="error" style="margin-bottom: 2rem;">
        <h2 style="margin-top: 0; font-size: 1.15rem; color: var(--danger-text);">NOT READY FOR SUBMISSION</h2>
        <p style="margin: 0;">Please return to the Readiness step to review missing information or unverified contradictions.</p>
      </div>`;
  }

  return `
    ${progress(5)}

    <div class="notice" style="margin-bottom: 2rem; border-color: var(--teal); background: #f0fdfa;">
      <strong style="color: var(--teal);">DEMO ENVIRONMENT</strong><br/>
      This experience uses synthetic demonstration data.<br/>
      No real government submission is performed.
    </div>

    ${readinessUI}

    <article class="card" style="padding: 2.5rem 2rem; box-shadow: 0 4px 20px rgba(0,0,0,0.05); border: 1px solid var(--line); overflow-wrap: break-word;">
      <header style="margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 2px solid var(--line);">
        <p class="subtle" style="text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.5rem; font-size: 0.85rem;">Cybercrime Incident Report</p>
        <h1 style="margin: 0; font-size: 1.75rem; color: var(--navy);">Financial Cyber Fraud</h1>
      </header>

      <section style="margin-bottom: 2rem;">
        <h2 style="font-size: 1.1rem; color: var(--navy); border-bottom: 1px solid var(--line); padding-bottom: 0.5rem; margin-bottom: 1rem;">INCIDENT SUMMARY</h2>
        <p style="white-space: pre-wrap; margin: 0;">${html(state.description || "No incident description provided.")}</p>
      </section>

      <section style="margin-bottom: 2rem;">
        <h2 style="font-size: 1.1rem; color: var(--navy); border-bottom: 1px solid var(--line); padding-bottom: 0.5rem; margin-bottom: 1rem;">EVIDENCE</h2>
        ${state.evidence.length ? `
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${state.evidence.map(item => `
              <li style="margin-bottom: 0.5rem; padding: 0.8rem; background: var(--bg); border-radius: 4px; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                <strong style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${html(item.filename)}</strong>
                <span class="subtle" style="flex-shrink: 0;">${Math.round(item.size / 1024)} KB</span>
              </li>
            `).join("")}
          </ul>
        ` : "<p class='subtle' style='margin:0;'>No evidence attached.</p>"}
      </section>

      <section style="margin-bottom: 2rem;">
        <h2 style="font-size: 1.1rem; color: var(--navy); border-bottom: 1px solid var(--line); padding-bottom: 0.5rem; margin-bottom: 1rem;">TIMELINE</h2>
        ${events.length ? `
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${events.map(event => `
              <li style="margin-bottom: 1.5rem; padding-left: 1rem; border-left: 2px solid var(--line);">
                <div style="font-weight: 600; font-size: 0.9rem; color: var(--navy);">${new Date(event.timestamp).toLocaleString()}</div>
                <div style="margin-top: 0.25rem;">${html(event.description)}</div>
              </li>
            `).join("")}
          </ul>
        ` : "<p class='subtle' style='margin:0;'>No timeline events recorded.</p>"}
      </section>

      <section style="margin-bottom: 1.5rem;">
        <h2 style="font-size: 1.1rem; color: var(--navy); border-bottom: 1px solid var(--line); padding-bottom: 0.5rem; margin-bottom: 1rem;">FACTS</h2>
        ${state.facts.length ? `
          <ul style="list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem;">
            ${state.facts.map((item) => `
              <li style="display: flex; flex-direction: column;">
                <span class="subtle" style="font-size: 0.75rem; text-transform: uppercase; margin-bottom: 0.25rem;">${html(item.field.replaceAll("_", " "))}</span>
                <strong>${html(item.value)}</strong>
              </li>
            `).join("")}
          </ul>
        ` : "<p class='subtle' style='margin:0;'>No details extracted.</p>"}
      </section>

      ${state.contradictions.length ? `
        <section style="margin-top: 2.5rem;">
          <h2 style="font-size: 1.1rem; color: var(--navy); border-bottom: 1px solid var(--line); padding-bottom: 0.5rem; margin-bottom: 1rem;">RESOLUTIONS</h2>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${state.contradictions.map((conflict) => `
              <li style="margin-bottom: 0.75rem;">
                <strong style="text-transform: capitalize;">${html(conflict.field.replaceAll("_", " "))}</strong><br/>
                <span class="subtle">${html(resolutionLabel(conflict))}</span>
              </li>
            `).join("")}
          </ul>
        </section>
      ` : ""}
    </article>

    <div class="step-actions">
      <a class="secondary" href="#readiness">Back</a>
      <button class="primary" id="submitReportBtn" data-action="submit" ${r.canSubmit ? "" : "disabled"}>Submit Mock Report</button>
    </div>`;
}

function acknowledgement() {
  const ack = state.acknowledgement;
  const ref = ack ? (ack.reference || JSON.stringify(ack)) : "not available";

  // Using an auto-focus element to shift context cleanly for screen readers on load
  return `
    ${progress(6)}

    <div class="card" style="text-align: center; padding: 3rem 1.5rem; border-color: var(--teal); border-top: 4px solid var(--teal);" tabindex="-1" id="ack-container">
      <div style="font-size: 3rem; color: var(--teal); margin-bottom: 1rem;" aria-hidden="true">✓</div>
      <h1 style="margin: 0 0 0.5rem; color: var(--navy);">Report prepared</h1>
      <p style="font-size: 1.1rem; margin-bottom: 2rem;">Your mock incident report has been submitted successfully.</p>

      <div style="background: var(--bg); padding: 1.5rem; border-radius: 8px; display: inline-block; min-width: 200px; margin-bottom: 2rem;">
        <div class="subtle" style="text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Reference ID</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: var(--navy); letter-spacing: 0.05em; font-family: monospace;">${html(ref)}</div>
      </div>

      <div class="notice" style="text-align: left; max-width: 500px; margin: 0 auto 2rem;">
        <strong>This was a simulated submission using synthetic data.</strong><br/>
        No report was sent to a real government system.
      </div>

      <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
        <button class="primary" data-action="new-case">Start another incident</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Event binding — all mutations go through the API
// ---------------------------------------------------------------------------

function showError(message) {
  const app = $("#app");
  const existing = $("#globalError", app);
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.id = "globalError";
  div.className = "error";
  div.setAttribute("role", "alert");
  div.textContent = message;
  app.prepend(div);
}

function bind() {
  const descriptionForm = $("#descriptionForm");
  if (descriptionForm)
    descriptionForm.onsubmit = async (event) => {
      event.preventDefault();
      const btn = $("#saveDescriptionBtn");
      const originalText = btn.textContent;
      btn.textContent = "Saving...";
      btn.disabled = true;
      try {
        const data = await api.updateDescription(
          state.id,
          $("#description").value.trim(),
        );
        applyResponse(data);
        location.hash = "evidence";
      } catch (err) {
        showError(err.message);
        btn.textContent = originalText;
        btn.disabled = false;
      }
    };

  const file = $("#file");
  if (file) file.onchange = handleUpload;

  document.querySelectorAll("[data-remove]").forEach(
    (button) =>
      (button.onclick = async () => {
        if (!window.confirm("Are you sure you want to remove this evidence?")) return;
        try {
          const data = await api.deleteEvidence(
            state.id,
            button.dataset.remove,
          );
          applyResponse(data);
          render();
        } catch (err) {
          showError(err.message);
        }
      }),
  );

  document.querySelectorAll("[data-source]").forEach(
    (button) =>
      (button.onclick = () => {
        state._selectedEvidenceId = button.dataset.source;
        location.hash = "evidence";
        render();
      }),
  );

  document.querySelectorAll("[data-copy-hash]").forEach(
    (button) =>
      (button.onclick = async () => {
        const hash = state.evidence.find(
          (item) => item.id === button.dataset.copyHash,
        )?.integrityFingerprint;
        try {
          await navigator.clipboard.writeText(hash);
          button.textContent = "Copied";
        } catch {
          button.textContent = "Copy unavailable";
        }
      }),
  );

  document.querySelectorAll("[data-event-confirm]").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          const event = state.events.find(
            (item) => item.id === button.dataset.eventConfirm,
          );
          const data = await api.confirmEvent(
            state.id,
            event.id,
            !event.userConfirmed,
          );
          applyResponse(data);
          render();
        } catch (err) {
          showError(err.message);
        }
      }),
  );

  document.querySelectorAll("[data-fact-confirm]").forEach(
    (control) =>
      (control.onchange = async () => {
        try {
          const data = await api.confirmFact(
            state.id,
            control.dataset.factConfirm,
            control.checked,
          );
          applyResponse(data);
        } catch (err) {
          showError(err.message);
        }
      }),
  );

  const factForm = $("#factForm");
  if (factForm)
    factForm.onsubmit = async (event) => {
      event.preventDefault();
      try {
        const data = await api.addFact(state.id, {
          field: $("#factField").value,
          value: $("#factValue").value.trim(),
          provenanceType: "user_entered",
        });
        applyResponse(data);
        render();
      } catch (err) {
        showError(err.message);
      }
    };

  document.querySelectorAll("[data-conflict-form]").forEach(
    (form) =>
      (form.onsubmit = async (event) => {
        event.preventDefault();
        const choice = new FormData(form).get(form.dataset.conflictForm);
        if (!choice) return;
        try {
          const data = await api.resolveContradiction(
            state.id,
            form.dataset.conflictForm,
            choice,
          );
          applyResponse(data);
          render();
        } catch (err) {
          showError(err.message);
        }
      }),
  );

  document.querySelectorAll("[data-action]").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          if (button.dataset.action === "new-case") {
            await createNewCase();
            location.hash = "describe";
          }
          if (button.dataset.action === "load-demo") {
            await loadDemoCase();
            location.hash = "evidence";
          }
          if (button.dataset.action === "submit") {
            if (!window.confirm("This is a mock submission. No real data will be sent to any government system.\n\nProceed with mock submission?")) {
              return;
            }

            const originalText = button.textContent;
            button.textContent = "Submitting...";
            button.disabled = true;

            try {
              const data = await api.submitCase(state.id);
              await refreshState();
              location.hash = "acknowledgement";
            } catch (err) {
              button.textContent = originalText;
              button.disabled = false;
              throw err;
            }
          }
        } catch (err) {
          showError(err.message);
        }
      }),
  );

  const ackContainer = document.getElementById('ack-container');
  if (ackContainer) {
    ackContainer.focus();
  }
}

// ---------------------------------------------------------------------------
// Evidence upload — uses V2 API
// ---------------------------------------------------------------------------

async function handleUpload(event) {
  const file = event.target.files[0];
  const error = $("#uploadError");
  const status = $("#uploadStatus");
  const input = event.target;
  if (!file) return;
  const result = validateUpload(file);
  if (!result.ok) {
    error.textContent = result.reason;
    error.classList.remove("hidden");
    if (status) status.classList.add("hidden");
    input.value = "";
    return;
  }

  error.classList.add("hidden");
  if (status) {
    status.classList.remove("hidden");
    status.textContent = "Uploading and analyzing...";
  }
  input.disabled = true;

  try {
    const data = await api.uploadEvidence(state.id, file);
    if (data.duplicate) {
      throw new Error(data.duplicate.message);
    }
    if (status) status.textContent = "Upload complete. Updating locker...";
    // Refresh full state from backend to get updated evidence list
    await refreshState();
    render();
  } catch (problem) {
    error.textContent = `The file was not stored: ${problem.message}`;
    error.classList.remove("hidden");
    if (status) status.classList.add("hidden");
    input.disabled = false;
    input.value = "";
  }
}

// ---------------------------------------------------------------------------
// Router and initialization
// ---------------------------------------------------------------------------

window.addEventListener("hashchange", () => {
  // Re-fetch readiness when entering readiness or report views
  const page = location.hash.slice(1);
  if ((page === "readiness" || page === "report") && state) {
    refreshState().then(render).catch(() => render());
  } else {
    render();
  }
});

$("#resetCase").onclick = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(KEY);
  state = null;
  readiness = null;
  location.hash = "start";
  render();
};

async function init() {
  state = await load();
  render();
}
init();
