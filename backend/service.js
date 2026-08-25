// backend/service.js
// Domain service layer — orchestrates domain operations on incidents.
//
// This service sits between the future API layer and the domain/repository.
// It enforces validated state transitions and ensures the domain rules
// (from domain.js) are applied authoritatively.

import {
  createIncident,
  createFact,
  createEvidence,
  createEvent,
  deriveContradictions,
  setContradictionResolution,
  calculateReadiness,
} from './domain.js';

export class IncidentService {
  /** @param {{ repository: import('./repository.js').InMemoryCaseRepository }} deps */
  constructor({ repository }) {
    this.repository = repository;
  }

  // -----------------------------------------------------------------------
  // Incident lifecycle
  // -----------------------------------------------------------------------

  /**
   * Create a new incident.
   * @param {{ description?: string }} params
   * @returns {object} The created incident
   */
  createIncident({ description = '' } = {}) {
    const incident = createIncident({ description });
    this.repository.save(incident);
    return this.repository.get(incident.id);
  }

  /**
   * Retrieve an incident by ID.
   * @param {string} id
   * @returns {object|null}
   */
  getIncident(id) {
    return this.repository.get(id);
  }

  /**
   * Update the incident description.
   * Submitted incidents cannot be modified.
   * @param {string} id
   * @param {string} description
   * @returns {object} Updated incident
   */
  updateDescription(id, description) {
    const incident = this._mustLoad(id);
    this._mustNotBeSubmitted(incident);
    incident.description = String(description ?? '');
    this.repository.save(incident);
    return this.repository.get(id);
  }

  // -----------------------------------------------------------------------
  // Evidence management
  // -----------------------------------------------------------------------

  /**
   * Add evidence metadata to an incident.
   * @param {string} incidentId
   * @param {object} evidenceParams - Parameters for createEvidence
   * @returns {object} Updated incident
   */
  addEvidence(incidentId, evidenceParams) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    const evidence = createEvidence(evidenceParams);
    incident.evidence.push(evidence);
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  /**
   * Remove evidence and any linked facts, then re-derive contradictions.
   * @param {string} incidentId
   * @param {string} evidenceId
   * @returns {object} Updated incident
   */
  removeEvidence(incidentId, evidenceId) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    incident.evidence = incident.evidence.filter(item => item.id !== evidenceId);
    incident.facts = incident.facts.filter(item => item.evidenceId !== evidenceId);
    deriveContradictions(incident);
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  // -----------------------------------------------------------------------
  // Fact management
  // -----------------------------------------------------------------------

  /**
   * Add a fact with provenance to an incident, then re-derive contradictions.
   * @param {string} incidentId
   * @param {object} factParams - Parameters for createFact
   * @returns {object} Updated incident
   */
  addFact(incidentId, factParams) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    const fact = createFact(factParams);
    incident.facts.push(fact);
    deriveContradictions(incident);
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  /**
   * Confirm or unconfirm a fact.
   * @param {string} incidentId
   * @param {string} factId
   * @param {boolean} confirmed
   * @returns {object} Updated incident
   */
  confirmFact(incidentId, factId, confirmed) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    const fact = incident.facts.find(item => item.id === factId);
    if (!fact) throw new Error('Fact not found.');
    fact.userConfirmed = !!confirmed;
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  // -----------------------------------------------------------------------
  // Event (timeline) management
  // -----------------------------------------------------------------------

  /**
   * Add a timeline event to an incident.
   * @param {string} incidentId
   * @param {object} eventParams - Parameters for createEvent
   * @returns {object} Updated incident
   */
  addEvent(incidentId, eventParams) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    const event = createEvent(eventParams);
    incident.events.push(event);
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  /**
   * Confirm or unconfirm a timeline event.
   * @param {string} incidentId
   * @param {string} eventId
   * @param {boolean} confirmed
   * @returns {object} Updated incident
   */
  confirmEvent(incidentId, eventId, confirmed) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    const event = incident.events.find(item => item.id === eventId);
    if (!event) throw new Error('Event not found.');
    event.userConfirmed = !!confirmed;
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  // -----------------------------------------------------------------------
  // Contradiction resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve a contradiction by explicit user choice.
   * @param {string} incidentId
   * @param {string} contradictionId
   * @param {string} choice - A factId or 'unresolved'
   * @returns {object} Updated incident
   */
  resolveContradiction(incidentId, contradictionId, choice) {
    const incident = this._mustLoad(incidentId);
    this._mustNotBeSubmitted(incident);
    setContradictionResolution(incident, contradictionId, choice);
    this.repository.save(incident);
    return this.repository.get(incidentId);
  }

  // -----------------------------------------------------------------------
  // Readiness
  // -----------------------------------------------------------------------

  /**
   * Calculate the current readiness of an incident.
   * Pure computation — does not modify the incident.
   * @param {string} incidentId
   * @returns {{ state: string, missing: string[], criticalOpen: boolean, unconfirmedRequired: boolean, canSubmit: boolean }}
   */
  calculateReadiness(incidentId) {
    const incident = this._mustLoad(incidentId);
    return calculateReadiness(incident);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Load an incident or throw if not found. */
  _mustLoad(id) {
    const incident = this.repository.get(id);
    if (!incident) throw new Error(`Incident ${id} not found.`);
    return incident;
  }

  /** Prevent modification of submitted incidents. */
  _mustNotBeSubmitted(incident) {
    if (incident.submitted) {
      throw new Error('Cannot modify a submitted incident.');
    }
  }
}
