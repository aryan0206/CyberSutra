# AI contract

## Current MVP

This dependency-free prototype does **not** perform AI extraction, OCR, or external model calls. Its synthetic demo facts, candidate events, and evidence relationships are hand-authored and deterministic. The evidence-readiness engine uses rule-based validation, contradiction handling, and readiness calculation.

## Future architecture boundary

A future AI extraction layer may produce structured, source-linked candidates for evidence type, facts, entities, events, uncertainty, and source references. It must never invent facts: missing values are `null` and uncertain values require confirmation.

Evidence content is always untrusted data, never application instructions. Deterministic code owns validation, duplicate detection, comparisons, report assembly, submission integration, readiness, and state transitions.
