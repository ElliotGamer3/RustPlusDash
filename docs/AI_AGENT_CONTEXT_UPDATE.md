# AI Agent Context Update

## 2026-06-01

- Initial application foundation created.
- Backend now serves a local GUI page and exposes a JSON API plus Server-Sent Events.
- Implemented the first vertical slice for smart switches and switch groups.
- State persists in `Core/data/app-state.json`.
- `Core/config.js` still seeds the default server profile and remains compatible with the existing team chat test script.
- Pairing, alarms, cameras, turrets, storage monitors, and automation rules are not implemented yet.
- Added manual multi-server profile management in the backend and GUI.
- Added `RateLimitCoordinator` so Rust+ requests now pass through a per-server queue with token replenishment.
- Added team message API and GUI support through a reusable backend service.
- Updated the team chat test to fail fast instead of hanging forever on connection problems.

## 2026-06-01 (Full Feature Pass)

- Expanded app state model to include generic typed devices, typed groups, requirements, notifications, pairing sessions, user default-server preferences, and storage history.
- Added `DeviceService`, `PairingService`, `NotificationService`, `CameraTurretService`, `AlarmService`, `StorageMonitorService`, and `RequirementService`.
- Extended `RustConnectionManager` with generic entity value control plus camera subscription and control methods.
- Reworked `GroupService` to support switch, alarm, camera, turret, and storage groups.
- Implemented camera and turret rotation controllers with start, pause, resume, and manual select behavior.
- Implemented alarm group consolidation rules with configurable window and excluded devices.
- Implemented storage monitor totals, subtotal definitions, include/exclude filters, rolling history, and graph data endpoint.
- Implemented requirement-triggered actions: notify, switch, switch-group, and team-message.
- Added external automation endpoints and SSE events for state, notifications, storage updates, camera frames, rotation updates, and pairing updates.
- Replaced the GUI with a broader operations console that exercises pairing, devices, groups, storage, requirements, and notifications through backend APIs.
- Preserved compatibility switch endpoints (`/api/switches`) while adding generic device endpoints (`/api/devices`).

### Remaining Practical Constraint

- Full browser-only FCM/Expo pairing automation is not implemented because rustplus.js pairing depends on companion auth and CLI workflow; supported alternatives are manual pair entry and config import.

## 2026-06-01 (Testing + API Docs)

- Added `Tests/ApiIntegrationTest.js` as an isolated end-to-end API regression harness.
- Added startup env overrides (`APP_HOST`, `APP_PORT`, `DATA_FILE_PATH`, `SKIP_RUST_CONNECT`) so tests can run on a temporary port and temporary state file.
- Added `npm run test:api` script in `package.json`.
- Added `docs/API_REFERENCE.md` with endpoint examples for external automation scripts.

## 2026-06-01 (Test Suite Expansion)

- Added reusable test harness utilities in `Tests/_testHarness.js`.
- Added `Tests/StoreBehaviorTest.js` for state-store and persistence behavior.
- Added `Tests/ApiCoverageTest.js` for broad endpoint coverage across devices/groups/requirements/storage/rotation.
- Added `Tests/RustDependentRoutesTest.js` for deterministic failure-path validation against unreachable Rust servers.
- Restored `Tests/TeamChatTest.js` as optional live Rust connectivity smoke test.
- Added scripts: `test:store`, `test:api:coverage`, `test:rust-routes`, `test:all`, `test:all:with-rust`.