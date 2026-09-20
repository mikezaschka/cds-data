// Entry point for the federation management API (ADR 0017).
//
// Loaded automatically when `requires.data-federation.management.reuse.api`
// (or `.console`) is set, or imported directly for a project-owned setup:
//
//     using from 'cds-data-federation/management.cds';
//
// Deliberately separate from index.cds, which carries the user-facing
// `replicated` aspect — importing an aspect must not serve an API.
using from './srv/FederationManagementService';
