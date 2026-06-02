# Rust+ Companion Documentation

## Current Scope

This documentation tracks the currently implemented local Rust+ companion application.

- Local Node backend using `@liamcottle/rustplus.js`
- Local browser GUI served by the backend
- Shared backend service path for GUI and non-GUI actions
- Persistent local state for servers, devices, groups, requirements, pairing sessions, notifications, and storage history
- Request queueing for Rust+ commands with per-server token budgeting
- Team message command path exposed through the same backend used by the GUI
- Device support for smart switches, smart alarms, cameras, turrets, and storage monitors
- Group support for switch groups, alarm groups, camera groups, turret groups, and storage groups
- Camera and turret rotation with pause, resume, and manual selection
- Smart alarm consolidation with configurable windows and per-device exclusions
- Storage group grand totals, subtotal definitions, include/exclude filtering, rolling history, and graph data endpoints
- Requirement engine with actions: notify, switch toggle, switch group toggle, and team message
- External automation API via HTTP routes and Server-Sent Events stream

## API Summary

- `GET /api/state`: full backend snapshot for GUI and script consumers
- `GET /api/events`: live event stream for state, notifications, storage, camera, rotation, and pairing updates
- `POST /api/pairing/import-config`: import pairing metadata from rustplus config files
- `POST /api/pairing/server`: manual server pairing
- `POST /api/pairing/device`: manual device pairing
- `POST /api/devices`: add typed devices
- `POST /api/groups`: add typed groups
- `POST /api/groups/:id/rotation/start|pause|resume`: camera and turret rotation controls
- `POST /api/groups/:id/alarm-consolidation`: configure alarm consolidation
- `POST /api/groups/:id/storage/subtotals`: configure storage subtotal definitions
- `GET /api/groups/:id/storage/metrics`: storage totals and subtotals
- `GET /api/groups/:id/storage/graph`: rolling graph points for items
- `POST /api/requirements`: create automation requirements

## Known Constraints

- The Rust+ library is Node-oriented, so browser code cannot directly use rustplus.js without backend mediation.
- Fully automated FCM/Expo pairing remains dependent on rustplus.js CLI and companion authentication flow; this app supports manual and config-import pairing workflows in both GUI and API.
- Some storage item categories are inferred heuristically from item names unless category metadata is provided.

## Document Index

- `AI_AGENT_CONTEXT_MASTER.md`: stable high-level architecture snapshot
- `AI_AGENT_CONTEXT_UPDATE.md`: agent-maintained updates and implementation notes
- `API_REFERENCE.md`: endpoint catalog with request and response examples for script authors

## Validation Commands

- `npm run test:store`: app state and persistence behavior checks
- `npm run test:api`: isolated API integration regression test
- `npm run test:api:coverage`: broad API coverage across typed devices/groups and automation endpoints
- `npm run test:rust-routes`: deterministic error-path checks for Rust-dependent routes on unreachable servers
- `npm run test:all`: full deterministic suite (no live Rust dependency)
- `npm run test:teamchat`: optional live Rust connectivity smoke test
- `npm run test:all:with-rust`: deterministic suite + live Rust team chat smoke