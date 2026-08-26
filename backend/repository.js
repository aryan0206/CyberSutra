// backend/repository.js
// Case persistence abstraction and in-memory MVP implementation.
//
// The repository interface is a simple contract:
//   get(id)    → incident or null
//   save(incident) → void
//   delete(id) → boolean
//   list()     → [incident, ...]
//
// The in-memory implementation satisfies the MVP requirement for
// minimal retention and dependency minimization. A future implementation
// can swap in SQLite or PostgreSQL without changing the domain layer.

/**
 * In-memory case repository.
 * Stores deep copies to prevent external mutation of repository state.
 */
export class InMemoryCaseRepository {
  /** @type {Map<string, object>} */
  #store = new Map();

  /**
   * Retrieve an incident by ID.
   * @param {string} id
   * @returns {object|null} A deep copy of the incident, or null if not found.
   */
  get(id) {
    const incident = this.#store.get(id);
    if (!incident) return null;
    return JSON.parse(JSON.stringify(incident));
  }

  /**
   * Persist an incident. Overwrites any existing incident with the same ID.
   * @param {object} incident - Must have an `id` property.
   */
  save(incident) {
    if (!incident?.id) {
      throw new Error('Cannot save an incident without an id.');
    }
    // Store a deep copy so the caller cannot mutate repository state.
    this.#store.set(incident.id, JSON.parse(JSON.stringify(incident)));
  }

  /**
   * Delete an incident by ID.
   * @param {string} id
   * @returns {boolean} True if the incident existed and was deleted.
   */
  delete(id) {
    return this.#store.delete(id);
  }

  /**
   * List all stored incidents.
   * @returns {object[]} Array of deep copies.
   */
  list() {
    return [...this.#store.values()].map(
      incident => JSON.parse(JSON.stringify(incident))
    );
  }

  /**
   * Return the number of stored incidents.
   * @returns {number}
   */
  get size() {
    return this.#store.size;
  }

  /**
   * Remove all incidents. Useful for testing.
   */
  clear() {
    this.#store.clear();
  }
}
