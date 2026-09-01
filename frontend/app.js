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
  return `${progress(0)}<h1 class="page-title">Tell us what happened</h1><p class="subtle">Use your own words. This description is not evidence until you review it.</p><form id="descriptionForm" class="card"><div class="field"><label for="description">What happened?</label><textarea id="description" required maxlength="3000">${html(state.description)}</textarea></div><div class="step-actions"><button class="primary">Save and continue</button></div></form>`;
}

function fingerprint(ev) {
  return ev.integrityFingerprint
    ? `<details class="fingerprint"><summary>File integrity fingerprint \u00b7 SHA-256 \u00b7 ${html(shortHash(ev.integrityFingerprint))}</summary><p>This fingerprint identifies the exact file processed by CyberSutra. It does not establish authenticity or legal admissibility.</p><code>${html(ev.integrityFingerprint)}</code><button class="text-button" data-copy-hash="${ev.id}" type="button">Copy full fingerprint</button></details>`
    : '<p class="subtle">No file fingerprint available.</p>';
}

function evidenceView() {
  const selected = state._selectedEvidenceId;
  return `${progress(1)}<h1 class="page-title">Add your evidence</h1><p class="subtle">Only file metadata and a local integrity fingerprint are retained in this dependency-free demo. File-content extraction is unavailable. Files are never executed and supplied URLs are never fetched.</p><div class="card upload"><label for="file">Choose PNG, JPEG, PDF or text file (up to 5 MB)</label><input id="file" type="file" accept="image/png,image/jpeg,application/pdf,text/plain" /><p id="uploadError" class="error hidden" role="alert"></p></div><div class="card"><h2>Evidence locker</h2>${state.evidence.length ? state.evidence.map((item, index) => `<section class="evidence-item ${selected === item.id ? "selected" : ""}" id="evidence-${item.id}"><div class="item"><div><strong>Evidence #${index + 1} \u00b7 ${html(item.filename)}</strong><p>${html(item.type)} \u00b7 ${Math.round(item.size / 1024)} KB \u00b7 <span class="status">${html(item.processingStatus)}</span></p><p class="subtle">Source: ${html(item.source)}</p>${fingerprint(item)}</div><button class="secondary" data-remove="${item.id}">Remove</button></div></section>`).join("") : '<p class="subtle">No evidence added yet. You can still enter details manually in review.</p>'}</div><div class="step-actions"><a class="secondary" href="#describe">Back</a><a class="primary" href="#timeline">Continue to timeline</a></div>`;
}

function timeline() {
  const events = [...(state.events || [])].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  return `${progress(2)}<h1 class="page-title">Timeline</h1><p class="subtle">Events begin as candidates. They are not confirmed unless you explicitly confirm them.</p><div class="card timeline">${events.length ? events.map((event) => `<article><strong>${new Date(event.timestamp).toLocaleString()}</strong> <span class="status ${event.userConfirmed ? "ready" : "warning"}">${event.userConfirmed ? "User-confirmed event" : "Candidate event"}</span><p>${html(event.description)}</p><small>Source: ${event.evidenceIds.map(evidenceName).map(html).join(", ")} \u00b7 ${Math.round(event.confidence * 100)}% confidence</small><p><button class="secondary" data-event-confirm="${event.id}">${event.userConfirmed ? "Unconfirm event" : "Confirm event"}</button></p></article>`).join("") : '<p class="subtle">No timestamped evidence is available yet.</p>'}</div><div class="step-actions"><a class="secondary" href="#evidence">Back</a><a class="primary" href="#review">Review extracted details</a></div>`;
}

function review() {
  return `${progress(3)}<h1 class="page-title">Review the details</h1><p class="subtle">Evidence-derived values retain their source. User-entered details are clearly labelled and have no invented provenance.</p><div class="card"><table class="facts"><thead><tr><th>Field</th><th>Value</th><th>Evidence source</th><th>Status</th></tr></thead><tbody>${state.facts.map((item) => `<tr><td>${html(item.field.replaceAll("_", " "))}</td><td>${html(item.value)}</td><td>${isManualFact(item) ? '<span class="status">USER-ENTERED</span>' : `<button class="source" data-source="${item.evidenceId}">${html(item.sourceReference)}</button>`}</td><td>${isManualFact(item) ? "User-entered" : `<label><input type="checkbox" data-fact-confirm="${item.id}" ${item.userConfirmed ? "checked" : ""}/> Confirm</label>`}</td></tr>`).join("")}</tbody></table></div><div class="card"><h2>Add a detail manually</h2><form id="factForm" class="grid"><div class="field"><label>Field <select id="factField"><option value="transaction_amount">Transaction amount</option><option value="transaction_id">Transaction ID</option><option value="transaction_timestamp">Transaction time</option><option value="payment_institution">Payment institution</option><option value="phone_number">Phone number</option></select></label></div><div class="field"><label>Value <input id="factValue" maxlength="160" required /></label></div><div class="field"><button class="secondary">Add detail</button></div></form></div><div class="step-actions"><a class="secondary" href="#timeline">Back</a><a class="primary" href="#readiness">Check readiness</a></div>`;
}

function readinessView() {
  const r = readiness || { state: "INCOMPLETE", missing: [], criticalOpen: false, unconfirmedRequired: false, canSubmit: false };
  return `${progress(4)}<h1 class="page-title">Report readiness</h1><div class="card"><span class="status ${r.state === "READY" ? "ready" : r.state === "INCOMPLETE" ? "danger" : "warning"}">${r.state}</span><h2>${r.state === "READY" ? "Ready for mock submission" : r.state === "INCOMPLETE" ? "More critical information is needed" : "Review required before submission"}</h2>${r.missing.length ? `<div class="error"><strong>Missing critical information:</strong> ${r.missing.map((field) => html(field.replaceAll("_", " "))).join(", ")}.</div>` : ""}${r.criticalOpen ? '<div class="error"><strong>Critical contradictions require an explicit resolution.</strong> CyberSutra will not choose a conflicting value for you.</div>' : ""}${r.unconfirmedRequired ? '<div class="callout"><strong>Required evidence-derived values still need confirmation.</strong></div>' : ""}<p class="subtle">This state is calculated by explicit rules, not an acceptance prediction.</p></div>${
    state.contradictions.length
      ? `<div class="card"><h2>Contradictions</h2>${state.contradictions
          .map(
            (conflict) =>
              `<section class="contradiction"><h3>${html(conflict.field.replaceAll("_", " "))} mismatch <span class="status ${conflict.status === "resolved" ? "ready" : "warning"}">${html(conflict.status.replaceAll("_", " "))}</span></h3><p>${html(resolutionLabel(conflict))}</p><form data-conflict-form="${conflict.id}">${conflict.factIds
                .map((factId) => {
                  const fact = state.facts.find((item) => item.id === factId);
                  return `<label class="choice"><input type="radio" name="${conflict.id}" value="${fact.id}" ${conflict.resolution?.chosenFactId === fact.id ? "checked" : ""}/> Use ${html(fact.value)} from ${html(evidenceName(fact.evidenceId))}</label>`;
                })
                .join(
                  "",
                )}<label class="choice"><input type="radio" name="${conflict.id}" value="unresolved" ${conflict.status === "reviewed_unresolved" ? "checked" : ""}/> Mark as unresolved / unable to verify</label><button class="secondary">Save explicit resolution</button></form></section>`,
          )
          .join("")}</div>`
      : ""
  }<div class="step-actions"><a class="secondary" href="#review">Back</a><a class="primary" href="#report">Review report</a></div>`;
}

function reportView() {
  const r = readiness || { state: "INCOMPLETE", canSubmit: false };
  return `${progress(5)}<h1 class="page-title">Report review</h1><div class="notice"><strong>Mock report only.</strong> This does not contact NCRP or any government system.</div><article class="card"><h2>Financial cyber fraud \u2014 draft</h2><p>${html(state.description || "No incident description provided.")}</p><h3>Evidence-linked details</h3>${state.facts.length ? `<ul>${state.facts.map((item) => `<li>${html(item.field.replaceAll("_", " "))}: ${html(item.value)} <small>(${isManualFact(item) ? "USER-ENTERED" : `source: ${html(item.sourceReference)}`})</small></li>`).join("")}</ul>` : "<p>No details added.</p>"}<h3>Contradiction resolutions</h3>${state.contradictions.length ? `<ul>${state.contradictions.map((conflict) => `<li>${html(conflict.field.replaceAll("_", " "))}: ${html(resolutionLabel(conflict))}</li>`).join("")}</ul>` : "<p>None detected.</p>"}<h3>Readiness</h3><p><span class="status ${r.state === "READY" ? "ready" : "warning"}">${r.state}</span></p></article><div class="step-actions"><a class="secondary" href="#readiness">Back</a><button class="primary" data-action="submit" ${r.canSubmit ? "" : "disabled"}>Submit mock report</button>${r.canSubmit ? "" : '<p class="subtle">Mock submission is available only when the deterministic readiness state is READY.</p>'}</div>`;
}

function acknowledgement() {
  const ack = state.acknowledgement;
  const ref = ack ? (ack.reference || JSON.stringify(ack)) : "not available";
  return `${progress(6)}<h1 class="page-title">Mock acknowledgement</h1><div class="success"><h2>Mock report recorded</h2><p>Your local demo acknowledgement is <strong>${html(ref)}</strong>.</p><p>No data was sent outside this browser. This acknowledgement is not valid for a real complaint.</p></div><div class="step-actions"><button class="primary" data-action="new-case">Start another incident</button></div>`;
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
      try {
        const data = await api.updateDescription(
          state.id,
          $("#description").value.trim(),
        );
        applyResponse(data);
        location.hash = "evidence";
      } catch (err) {
        showError(err.message);
      }
    };

  const file = $("#file");
  if (file) file.onchange = handleUpload;

  document.querySelectorAll("[data-remove]").forEach(
    (button) =>
      (button.onclick = async () => {
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
            const data = await api.submitCase(state.id);
            // Refresh full state to get submitted flag and acknowledgement
            await refreshState();
            location.hash = "acknowledgement";
          }
        } catch (err) {
          showError(err.message);
        }
      }),
  );
}

// ---------------------------------------------------------------------------
// Evidence upload — uses V2 API
// ---------------------------------------------------------------------------

async function handleUpload(event) {
  const file = event.target.files[0];
  const error = $("#uploadError");
  if (!file) return;
  const result = validateUpload(file);
  if (!result.ok) {
    error.textContent = result.reason;
    error.classList.remove("hidden");
    event.target.value = "";
    return;
  }
  try {
    const data = await api.uploadEvidence(state.id, file);
    if (data.duplicate) {
      throw new Error(data.duplicate.message);
    }
    // Refresh full state from backend to get updated evidence list
    await refreshState();
    render();
  } catch (problem) {
    error.textContent = `The file was not stored: ${problem.message}`;
    error.classList.remove("hidden");
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
