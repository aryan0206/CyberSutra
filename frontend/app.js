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
let _lastRenderedRoute = null;

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
      <div class="progress-mobile progress-${active + 1}" role="status" aria-label="Step ${active + 1} of ${STEPS.length}: ${currentLabel}">
        <div class="progress-mobile-copy">
          <span>Step ${active + 1} of ${STEPS.length}</span>
          <strong>${currentLabel}</strong>
        </div>
        <span class="progress-track" aria-hidden="true"><span class="progress-value"></span></span>
      </div>
      <ol class="progress-desktop">
        ${STEPS.map((label, index) => {
          const stateClass = index === active ? "current" : index < active ? "done" : "upcoming";
          const ariaCurrent = index === active ? 'aria-current="step"' : '';
          return `<li class="${stateClass}" ${ariaCurrent}>
            <span class="step-num" aria-hidden="true">${index < active ? "&#10003;" : index + 1}</span>
            <span class="step-label">${label}</span>
          </li>`;
        }).join("")}
      </ol>
    </nav>`;
}

function pageHeader(kicker, title, description) {
  return `
    <header class="page-header">
      <p class="page-kicker">${kicker}</p>
      <h1 class="page-title" id="page-title" tabindex="-1">${title}</h1>
      ${description ? `<p class="page-description">${description}</p>` : ""}
    </header>`;
}

const ICON_PATHS = {
  alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4.5M12 17h.01"/>',
  arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  document: '<path d="M7 3h7l4 4v14H7V3Z"/><path d="M14 3v5h5M10 12h5M10 16h5"/>',
  evidence: '<path d="M5 5h14v14H5z"/><path d="m8 15 3-3 2 2 3-4 2 3M9 9h.01"/>',
  hash: '<path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  report: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  timeline: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
};

function icon(name, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ICON_PATHS.document}</svg>`;
}

function formatFileSize(size) {
  if (!Number.isFinite(size)) return "Size unavailable";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function fieldLabel(field) {
  return String(field || "Detail").replaceAll("_", " ");
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
    _lastRenderedRoute = null;
    app.innerHTML = "";
    app.append($("#landing-template").content.cloneNode(true));
    bind();
    return;
  }
  const page = location.hash.slice(1) || "describe";
  const isRouteChange = page !== _lastRenderedRoute;
  _lastRenderedRoute = page;
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
  if (isRouteChange) {
    window.scrollTo(0, 0);
    // Acknowledgement screen has its own focus target (ack-container),
    // handled inside bind(). For all other routes, focus the page title.
    if (page !== "acknowledgement") {
      document.getElementById("page-title")?.focus();
    }
  }
}

function describe() {
  return `
    ${progress(0)}
    ${pageHeader("Incident foundation", "Tell us what happened", "Use your own words to establish the context that will connect every piece of evidence in the steps ahead.")}
    <form id="descriptionForm" class="card workflow-panel incident-form">
      <div class="section-heading">
        <span class="section-icon">${icon("document")}</span>
        <div class="section-heading-copy">
          <p class="section-kicker">Incident narrative</p>
          <h2>Describe the sequence in your own words</h2>
          <p>Include how contact began, what was requested, and when you recognized the activity as suspicious.</p>
        </div>
        <span class="required-badge">Required</span>
      </div>
      <div class="field narrative-field">
        <label for="description">What happened?</label>
        <textarea id="description" required maxlength="3000" aria-describedby="desc-hint desc-limit" placeholder="For example: On Tuesday afternoon, I received an SMS claiming to be from my bank...">${html(state.description)}</textarea>
        <div class="field-support">
          <p id="desc-hint">Focus on people, messages, transactions, and the order of events.</p>
          <span id="desc-limit">Up to 3,000 characters</span>
        </div>
      </div>
      <div class="form-footer">
        <p>${icon("check")} You can return and refine this narrative before submission.</p>
        <button type="submit" class="primary" id="saveDescriptionBtn">Save and continue ${icon("arrow")}</button>
      </div>
    </form>`;
}

function fingerprint(ev) {
  return ev.integrityFingerprint
    ? `<details class="fingerprint">
        <summary>${icon("hash")}<span>File integrity fingerprint</span></summary>
        <div class="fingerprint-panel">
          <p>This SHA-256 fingerprint identifies the exact file processed. It does not establish legal authenticity.</p>
          <code>${html(ev.integrityFingerprint)}</code>
          <button class="text-button fingerprint-copy" data-copy-hash="${ev.id}" type="button">Copy full fingerprint</button>
        </div>
       </details>`
    : '';
}

function evidenceView() {
  const selected = state._selectedEvidenceId;
  return `
    ${progress(1)}
    ${pageHeader("Source material", "Evidence locker", "Bring screenshots, receipts, messages, and documents together so each detail remains connected to its source.")}

    <section class="card upload evidence-upload" aria-labelledby="upload-title">
      <div class="upload-copy">
        <p class="section-kicker">Add source material</p>
        <h2 id="upload-title">Choose a file to add as evidence</h2>
        <p>Each file stays connected to the facts and events derived from it.</p>
      </div>
      <label class="file-select" for="file">${icon("plus")} Select evidence file</label>
      <input id="file" class="file-input" type="file" accept="image/png,image/jpeg,application/pdf,text/plain" />
      <div class="format-list" aria-label="Supported file requirements">
        <span>PNG</span><span>JPEG</span><span>PDF</span><span>TXT</span><span>Maximum 5 MB</span>
      </div>
      <p id="uploadStatus" class="upload-status hidden" aria-live="polite">Uploading and analyzing...</p>
      <p id="uploadError" class="error upload-error hidden" role="alert"></p>
    </section>

    <section class="card workflow-panel evidence-locker">
      <div class="section-heading section-heading-compact">
        <span class="section-icon">${icon("evidence")}</span>
        <div class="section-heading-copy">
          <p class="section-kicker">Evidence chain</p>
          <h2>Files attached</h2>
          <p>The source material currently connected to this incident.</p>
        </div>
        <span class="count-badge">${state.evidence.length} ${state.evidence.length === 1 ? "file" : "files"}</span>
      </div>
      <div class="evidence-list">
        ${state.evidence.length ? state.evidence.map((item, index) => `
          <article class="evidence-item ${selected === item.id ? "selected" : ""}" id="evidence-${item.id}">
            <span class="evidence-thread-node" aria-hidden="true"></span>
            <span class="file-type-icon">${icon(item.type?.startsWith("image/") ? "evidence" : "document")}</span>
            <div class="evidence-content">
              <div class="evidence-heading">
                <strong title="${html(item.filename)}">${html(item.filename)}</strong>
                <span class="status ${item.processingStatus === "processed" ? "ready" : ""}">${html(item.processingStatus)}</span>
              </div>
              <div class="metadata-row">
                <span>${html(item.type)}</span>
                <span>${formatFileSize(item.size)}</span>
                <span>Evidence ${index + 1}</span>
              </div>
              ${fingerprint(item)}
            </div>
            <button class="danger evidence-remove" data-remove="${item.id}" aria-label="Remove ${html(item.filename)}">Remove</button>
          </article>
        `).join("") : `
          <div class="empty-state">
            <span class="empty-icon">${icon("evidence")}</span>
            <h3>No evidence connected yet</h3>
            <p>Add a supported file above, or continue and enter important details manually during review.</p>
          </div>`}
      </div>
    </section>

    <div class="step-actions">
      <a class="secondary" href="#describe">Back</a>
      <a class="primary" href="#timeline">Continue to timeline ${icon("arrow")}</a>
    </div>`;
}

function timeline() {
  const events = [...(state.events || [])].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  return `
    ${progress(2)}
    ${pageHeader("Sequence of events", "Build the timeline", "Review the moments identified in your evidence and confirm the order in which the incident unfolded.")}

    <section class="card workflow-panel timeline-panel" aria-labelledby="timeline-heading">
      <div class="section-heading section-heading-compact">
        <span class="section-icon">${icon("timeline")}</span>
        <div class="section-heading-copy">
          <p class="section-kicker">Incident reconstruction</p>
          <h2 id="timeline-heading">Chronological evidence trail</h2>
          <p>Confirm the sequence so the final report distinguishes reviewed events from candidates.</p>
        </div>
        <span class="count-badge">${events.length} ${events.length === 1 ? "event" : "events"}</span>
      </div>
      ${events.length ? `
        <ol class="timeline-list">
          ${events.map((event, index) => `
            <li class="timeline-event ${event.userConfirmed ? "is-confirmed" : "needs-review"}">
              <span class="timeline-node" aria-hidden="true"><span>${String(index + 1).padStart(2, "0")}</span></span>
              <article class="event-card">
                <header class="event-header">
                  <div class="event-time">
                    ${icon("timeline")}
                    <time datetime="${html(event.timestamp)}">${new Date(event.timestamp).toLocaleString()}</time>
                  </div>
                  <span class="status ${event.userConfirmed ? "ready" : "warning"}">
                    ${event.userConfirmed ? "User-confirmed" : "Needs review"}
                  </span>
                </header>
                <p class="event-description">${html(event.description)}</p>
                <div class="event-footer">
                  <p class="provenance-line">${icon("link")}<span><strong>Source</strong>${event.evidenceIds.length ? event.evidenceIds.map(evidenceName).map(html).join(", ") : "User entered"}</span></p>
                  <button class="${event.userConfirmed ? 'secondary' : 'primary'} event-confirm" data-event-confirm="${event.id}">
                    ${event.userConfirmed ? `${icon("check")} Confirmed — undo` : `${icon("check")} Confirm event`}
                  </button>
                </div>
              </article>
            </li>
          `).join("")}
        </ol>
      ` : `
        <div class="empty-state">
          <span class="empty-icon">${icon("timeline")}</span>
          <h3>No timestamped events yet</h3>
          <p>When uploaded evidence contains dates or times, candidate events will appear here for review.</p>
        </div>`}
    </section>

    <div class="step-actions">
      <a class="secondary" href="#evidence">Back</a>
      <a class="primary" href="#review">Continue to review ${icon("arrow")}</a>
    </div>`;
}

function review() {
  return `
    ${progress(3)}
    ${pageHeader("Evidence review", "Review the details", "Verify the information connected to your evidence and add anything important that is still missing.")}

    <section class="card workflow-panel facts-panel">
      <div class="section-heading section-heading-compact facts-heading">
        <span class="section-icon">${icon("report")}</span>
        <div class="section-heading-copy">
          <p class="section-kicker">Connected facts</p>
          <h2>Extracted and entered details</h2>
          <p>Review each value alongside its provenance before it enters the final report.</p>
        </div>
        <span class="count-badge">${state.facts.length} ${state.facts.length === 1 ? "detail" : "details"}</span>
      </div>
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
                  ? `<span class="status">User-entered</span>`
                  : `<button class="source" data-source="${item.evidenceId}" aria-label="View source for ${html(fieldLabel(item.field))}">${icon("link")}${html(item.sourceReference)}</button>`;

                return `
                <tr>
                  <th scope="row"><span class="fact-field">${html(fieldLabel(item.field))}</span></th>
                  <td data-label="Value"><strong class="fact-value">${html(item.value)}</strong></td>
                  <td data-label="Source">${sourceBadge}</td>
                  <td data-label="Confirmation">
                    ${isManual
                      ? `<span class="status ready">${icon("check")} Confirmed</span>`
                      : `<label class="confirm-control"><input type="checkbox" data-fact-confirm="${item.id}" ${item.userConfirmed ? "checked" : ""} aria-label="Confirm ${html(fieldLabel(item.field))}"/><span aria-hidden="true"></span> Confirm</label>`
                    }
                  </td>
                </tr>
              `}).join("")}
            </tbody>
          </table>
        ` : `
          <div class="empty-state">
            <span class="empty-icon">${icon("report")}</span>
            <h3>No details available for review</h3>
            <p>Add a missing detail below, or return to the evidence locker to attach source material.</p>
          </div>`}
      </div>
    </section>

    <section class="card add-detail-panel">
      <div class="section-heading section-heading-compact">
        <span class="section-icon section-icon-muted">${icon("plus")}</span>
        <div class="section-heading-copy">
          <p class="section-kicker">Complete the record</p>
          <h2>Add a missing detail</h2>
          <p>Enter a key detail manually when it was not available in the uploaded evidence.</p>
        </div>
      </div>
      <form id="factForm" class="detail-form">
        <div class="field">
          <label for="factField">Field</label>
          <select id="factField">
            <option value="transaction_amount">Transaction amount</option>
            <option value="transaction_id">Transaction ID</option>
            <option value="transaction_timestamp">Transaction time</option>
            <option value="payment_institution">Payment institution</option>
            <option value="phone_number">Phone number</option>
          </select>
        </div>
        <div class="field">
          <label for="factValue">Value</label>
          <input id="factValue" maxlength="160" required placeholder="Enter the value exactly as known" />
        </div>
        <button class="secondary add-detail-button">${icon("plus")} Add detail</button>
      </form>
    </section>

    <div class="step-actions">
      <a class="secondary" href="#timeline">Back</a>
      <a class="primary" href="#readiness">Check readiness ${icon("arrow")}</a>
    </div>`;
}

function readinessView() {
  const r = readiness || { state: "INCOMPLETE", missing: [], criticalOpen: false, unconfirmedRequired: false, canSubmit: false };
  const checklistItem = (tone, label) => `
    <li class="checklist-item ${tone}">
      <span class="checklist-icon">${icon(tone === "complete" ? "check" : "alert")}</span>
      <span>${label}</span>
    </li>`;

  let readinessHeader = "";
  if (r.state === "READY") {
    readinessHeader = `
      <section class="readiness-summary is-ready">
        <span class="readiness-emblem">${icon("check")}</span>
        <div>
          <p class="section-kicker">Readiness state</p>
          <h2>Ready for report review</h2>
          <p>All required information has been reviewed. You can now proceed to the mock report.</p>
        </div>
        <span class="readiness-state">Ready</span>
      </section>`;
  } else {
    readinessHeader = `
      <section class="readiness-summary needs-attention">
        <span class="readiness-emblem">${icon("alert")}</span>
        <div>
          <p class="section-kicker">Readiness state</p>
          <h2>Review required</h2>
          <p>Some items need your attention before generating the report.</p>
        </div>
        <span class="readiness-state">${html(r.state.replaceAll("_", " "))}</span>
      </section>`;
  }

  const checklistItems = [];
  checklistItems.push(checklistItem("complete", "Incident details provided"));
  checklistItems.push(checklistItem("complete", "Evidence attached"));

  if (r.missing.length) {
    checklistItems.push(checklistItem("critical", `Missing critical information: ${r.missing.map((field) => html(fieldLabel(field))).join(", ")}`));
  } else {
    checklistItems.push(checklistItem("complete", "Required fields present"));
  }

  if (r.unconfirmedRequired) {
    checklistItems.push(checklistItem("attention", "Required evidence-derived values need confirmation"));
  } else {
    checklistItems.push(checklistItem("complete", "Required values confirmed"));
  }

  if (r.criticalOpen) {
    checklistItems.push(checklistItem("critical", "Contradictions need explicit resolution"));
  } else if (state.contradictions.length > 0) {
    checklistItems.push(checklistItem("complete", "Contradictions resolved"));
  }

  return `
    ${progress(4)}
    ${pageHeader("Quality check", "Report readiness", "See what is complete, what still needs attention, and which conflicting details require your decision.")}

    ${readinessHeader}

    <section class="card workflow-panel checklist-panel">
      <div class="section-heading section-heading-compact">
        <span class="section-icon">${icon("check")}</span>
        <div class="section-heading-copy">
          <p class="section-kicker">Rule-based checkpoint</p>
          <h2>Pre-submission checklist</h2>
          <p>Every item is derived from the current case state and review requirements.</p>
        </div>
      </div>
      <ul class="readiness-checklist">
        ${checklistItems.join("")}
      </ul>
      <p class="rules-note">${icon("alert")} This state is calculated by explicit rules, not an acceptance prediction.</p>
    </section>

    ${state.contradictions.length ? `
      <section class="card workflow-panel contradictions-panel">
        <div class="section-heading">
          <span class="section-icon section-icon-warning">${icon("alert")}</span>
          <div class="section-heading-copy">
            <p class="section-kicker">Analytical review</p>
            <h2>Resolve conflicting evidence</h2>
            <p>Compare the source-linked values below and record the most supportable outcome.</p>
          </div>
          <span class="count-badge warning">${state.contradictions.length} ${state.contradictions.length === 1 ? "conflict" : "conflicts"}</span>
        </div>

        ${state.contradictions.map((conflict) => `
          <section class="contradiction">
            <header class="contradiction-header">
              <div>
                <p class="contradiction-label">Conflicting field</p>
                <h3>${html(fieldLabel(conflict.field))}</h3>
              </div>
              <span class="status ${conflict.status === "resolved" ? "ready" : "warning"}">${html(conflict.status.replaceAll("_", " "))}</span>
            </header>
            <p class="resolution-summary">${icon("link")}${html(resolutionLabel(conflict))}</p>

            <form class="contradiction-form" data-conflict-form="${conflict.id}">
              <fieldset>
                <legend>Which source should the report use?</legend>
                <div class="contradiction-choices">
                ${conflict.factIds.map((factId) => {
                  const fact = state.facts.find((item) => item.id === factId);
                  return `
                    <label class="choice contradiction-choice">
                      <input type="radio" name="${conflict.id}" value="${fact.id}" ${conflict.resolution?.chosenFactId === fact.id ? "checked" : ""} />
                      <span class="choice-marker" aria-hidden="true"></span>
                      <span class="choice-content">
                        <span class="choice-caption">Use this value</span>
                        <strong>${html(fact.value)}</strong>
                        <span class="choice-source">${icon("link")} ${html(evidenceName(fact.evidenceId))}</span>
                      </span>
                    </label>
                  `;
                }).join("")}
                <label class="choice contradiction-choice unresolved-choice">
                  <input type="radio" name="${conflict.id}" value="unresolved" ${conflict.status === "reviewed_unresolved" ? "checked" : ""} />
                  <span class="choice-marker" aria-hidden="true"></span>
                  <span class="choice-content">
                    <span class="choice-caption">Preserve uncertainty</span>
                    <strong>Unable to verify</strong>
                    <span class="choice-source">Keep both source values visible and mark the conflict unresolved.</span>
                  </span>
                </label>
                </div>
              </fieldset>
              <button class="secondary save-resolution">${icon("check")} Save resolution</button>
            </form>
          </section>
        `).join("")}
      </section>
    ` : ""}

    <div class="step-actions">
      <a class="secondary" href="#review">Back</a>
      <a class="primary" href="#report">Review report ${icon("arrow")}</a>
    </div>`;
}

function reportView() {
  const r = readiness || { state: "INCOMPLETE", canSubmit: false };
  const events = [...(state.events || [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let readinessUI = "";
  if (r.canSubmit) {
    readinessUI = `
      <section class="report-gate is-ready">
        <span class="report-gate-icon">${icon("check")}</span>
        <div>
          <p class="section-kicker">Pre-submission state</p>
          <h2>Ready for mock submission</h2>
          <p>Incident details, evidence, timeline, and required information have been reviewed.</p>
        </div>
        <span class="status ready">Ready</span>
      </section>`;
  } else {
    readinessUI = `
      <section class="report-gate is-blocked">
        <span class="report-gate-icon">${icon("alert")}</span>
        <div>
          <p class="section-kicker">Pre-submission state</p>
          <h2>Review required before submission</h2>
          <p>Return to Readiness to review missing information or unresolved contradictions.</p>
        </div>
        <span class="status danger">Not ready</span>
      </section>`;
  }

  return `
    ${progress(5)}
    ${pageHeader("Incident report", "Review your report", "Read the complete evidence-linked summary before proceeding with the simulated submission.")}

    <div class="notice report-demo-notice">
      <span class="notice-icon">${icon("alert")}</span>
      <div><strong>Demonstration report</strong><span>This experience uses synthetic demonstration data. No real government submission is performed.</span></div>
    </div>

    ${readinessUI}

    <article class="dossier">
      <header class="dossier-header">
        <div class="dossier-brandline">
          <span class="dossier-mark" aria-hidden="true">CS</span>
          <div>
            <p>CyberSutra evidence report</p>
            <span>Structured incident record</span>
          </div>
          <span class="status ${r.canSubmit ? "ready" : "warning"}">${html(r.state.replaceAll("_", " "))}</span>
        </div>
        <div class="dossier-title">
          <p>Cybercrime incident report</p>
          <h2>Financial cyber fraud</h2>
        </div>
        <dl class="dossier-metadata">
          <div><dt>Case reference</dt><dd>${html(state.id)}</dd></div>
          <div><dt>Evidence files</dt><dd>${state.evidence.length}</dd></div>
          <div><dt>Timeline events</dt><dd>${events.length}</dd></div>
          <div><dt>Recorded facts</dt><dd>${state.facts.length}</dd></div>
        </dl>
      </header>

      <section class="dossier-section summary-section">
        <header class="dossier-section-heading"><span>01</span><div><p>Incident overview</p><h3>Incident summary</h3></div></header>
        <p class="dossier-summary">${html(state.description || "No incident description provided.")}</p>
      </section>

      <section class="dossier-section">
        <header class="dossier-section-heading"><span>02</span><div><p>Source material</p><h3>Evidence register</h3></div></header>
        ${state.evidence.length ? `
          <ul class="dossier-evidence-list">
            ${state.evidence.map((item, index) => `
              <li>
                <span class="dossier-file-icon">${icon(item.type?.startsWith("image/") ? "evidence" : "document")}</span>
                <div><strong>${html(item.filename)}</strong><span>${html(item.type)} · ${formatFileSize(item.size)}</span></div>
                <span class="evidence-index">E${String(index + 1).padStart(2, "0")}</span>
              </li>
            `).join("")}
          </ul>
        ` : '<p class="dossier-empty">No evidence attached.</p>'}
      </section>

      <section class="dossier-section">
        <header class="dossier-section-heading"><span>03</span><div><p>Reconstructed sequence</p><h3>Incident timeline</h3></div></header>
        ${events.length ? `
          <ol class="dossier-timeline">
            ${events.map((event, index) => `
              <li>
                <span class="dossier-timeline-node" aria-hidden="true"></span>
                <div class="dossier-event-heading"><time datetime="${html(event.timestamp)}">${new Date(event.timestamp).toLocaleString()}</time><span class="status ${event.userConfirmed ? "ready" : "warning"}">${event.userConfirmed ? "Confirmed" : "Candidate"}</span></div>
                <p>${html(event.description)}</p>
                <span class="dossier-source">${icon("link")} ${event.evidenceIds.length ? event.evidenceIds.map(evidenceName).map(html).join(", ") : "User entered"}</span>
              </li>
            `).join("")}
          </ol>
        ` : '<p class="dossier-empty">No timeline events recorded.</p>'}
      </section>

      <section class="dossier-section">
        <header class="dossier-section-heading"><span>04</span><div><p>Reviewed information</p><h3>Recorded facts</h3></div></header>
        ${state.facts.length ? `
          <dl class="dossier-facts">
            ${state.facts.map((item) => `
              <div>
                <dt>${html(fieldLabel(item.field))}</dt>
                <dd>${html(item.value)}<span>${isManualFact(item) ? "User entered" : `Source: ${html(evidenceName(item.evidenceId))}`}</span></dd>
              </div>
            `).join("")}
          </dl>
        ` : '<p class="dossier-empty">No details extracted.</p>'}
      </section>

      ${state.contradictions.length ? `
        <section class="dossier-section resolutions-section">
          <header class="dossier-section-heading"><span>05</span><div><p>Analytical record</p><h3>Contradictions and resolutions</h3></div></header>
          <ul class="dossier-resolutions">
            ${state.contradictions.map((conflict) => `
              <li>
                <span class="resolution-icon">${icon(conflict.status === "resolved" ? "check" : "alert")}</span>
                <div><strong>${html(fieldLabel(conflict.field))}</strong><span>${html(resolutionLabel(conflict))}</span></div>
                <span class="status ${conflict.status === "resolved" ? "ready" : "warning"}">${html(conflict.status.replaceAll("_", " "))}</span>
              </li>
            `).join("")}
          </ul>
        </section>
      ` : ""}

      <footer class="dossier-footer">
        <span>${icon("link")} Evidence-linked incident preparation</span>
        <strong>CyberSutra</strong>
      </footer>
    </article>

    <div class="step-actions report-actions">
      <a class="secondary" href="#readiness">Back</a>
      <button class="primary" id="submitReportBtn" data-action="submit" ${r.canSubmit ? "" : "disabled"}>Submit mock report ${icon("arrow")}</button>
    </div>`;
}

function acknowledgement() {
  const ack = state.acknowledgement;
  const ref = ack ? (ack.reference || JSON.stringify(ack)) : "not available";

  // Using an auto-focus element to shift context cleanly for screen readers on load
  return `
    ${progress(6)}

    <section class="acknowledgement-card" tabindex="-1" id="ack-container">
      <div class="acknowledgement-thread" aria-hidden="true">
        <span></span><span>${icon("check")}</span><span></span>
      </div>
      <p class="section-kicker">Workflow complete</p>
      <h1>Report prepared</h1>
      <p class="acknowledgement-lede">Your mock incident report has been submitted successfully.</p>

      <div class="reference-card">
        <span>Reference ID</span>
        <strong>${html(ref)}</strong>
      </div>

      <div class="notice acknowledgement-notice">
        <span class="notice-icon">${icon("alert")}</span>
        <div><strong>Simulated submission</strong><span>This used synthetic data. No report was sent to a real government system.</span></div>
      </div>

      <button class="primary" data-action="new-case">Start another incident ${icon("arrow")}</button>
    </section>`;
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
        const originalText = button.textContent;
        button.textContent = "Removing\u2026";
        button.disabled = true;
        try {
          const data = await api.deleteEvidence(
            state.id,
            button.dataset.remove,
          );
          applyResponse(data);
          render();
        } catch (err) {
          showError(err.message);
          button.textContent = originalText;
          button.disabled = false;
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
        const originalText = button.textContent;
        button.textContent = "Confirming\u2026";
        button.disabled = true;
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
          button.textContent = originalText;
          button.disabled = false;
        }
      }),
  );

  document.querySelectorAll("[data-fact-confirm]").forEach(
    (control) =>
      (control.onchange = async () => {
        control.disabled = true;
        try {
          const data = await api.confirmFact(
            state.id,
            control.dataset.factConfirm,
            control.checked,
          );
          applyResponse(data);
        } catch (err) {
          showError(err.message);
          control.checked = !control.checked;
          control.disabled = false;
        }
      }),
  );

  const factForm = $("#factForm");
  if (factForm)
    factForm.onsubmit = async (event) => {
      event.preventDefault();
      const btn = $(".add-detail-button", factForm);
      const originalText = btn.textContent;
      btn.textContent = "Adding\u2026";
      btn.disabled = true;
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
        btn.textContent = originalText;
        btn.disabled = false;
      }
    };

  document.querySelectorAll("[data-conflict-form]").forEach(
    (form) =>
      (form.onsubmit = async (event) => {
        event.preventDefault();
        const choice = new FormData(form).get(form.dataset.conflictForm);
        if (!choice) return;
        const btn = $(".save-resolution", form);
        const originalText = btn.textContent;
        btn.textContent = "Resolving\u2026";
        btn.disabled = true;
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
          btn.textContent = originalText;
          btn.disabled = false;
        }
      }),
  );

  document.querySelectorAll("[data-action]").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          if (button.dataset.action === "new-case") {
            if (state && !state.acknowledgement) {
              if (!window.confirm("Starting a new incident will discard your current case data.\n\nAre you sure?")) return;
            }
            button.disabled = true;
            try {
              await createNewCase();
              location.hash = "describe";
            } catch (err) {
              button.disabled = false;
              throw err;
            }
          }
          if (button.dataset.action === "load-demo") {
            if (state && !state.acknowledgement) {
              if (!window.confirm("Loading the demo will discard your current case data.\n\nAre you sure?")) return;
            }
            button.disabled = true;
            try {
              await loadDemoCase();
              location.hash = "evidence";
            } catch (err) {
              button.disabled = false;
              throw err;
            }
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
  if (state && !state.acknowledgement) {
    if (!window.confirm("Starting over will discard your current case data.\n\nAre you sure?")) return;
  }
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
