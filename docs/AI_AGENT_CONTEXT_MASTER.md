# AI Agent Context Master

## Purpose

This file is the human-maintained overview of the Rust+ companion codebase. Agents should read it for baseline context and must not update it after initial creation.

## Codebase Overview

The application is a local Node-hosted Rust+ companion tool. It is designed so that the backend owns all Rust+ communication and business logic while the browser GUI acts as a thin client that calls backend endpoints and subscribes to backend events.

## Current Architecture

- `Core/main.js`: application bootstrap and HTTP server startup
- `Core/app/Application.js`: composition root that wires store, services, and event bus
- `Core/store/AppStateStore.js`: persistent state for servers, devices, and groups
- `Core/services/RustConnectionManager.js`: Rust+ connection lifecycle and entity broadcast routing
- `Core/services/SmartSwitchService.js`: smart switch CRUD and control operations
- `Core/services/GroupService.js`: switch group creation and group power actions
- `Core/http/server.js`: local HTTP API, static file serving, and Server-Sent Events stream
- `Core/public/index.html`: local GUI page
- `Core/public/app.js`: browser-side rendering and API calls

## Design Rules

- GUI actions and non-GUI actions must share the same backend services.
- Rust+ requests should be centralized in backend services rather than spread across the UI.
- State should be driven by backend events and persisted locally.
- New device types should follow the service-plus-view-module pattern rather than modify unrelated code.

## Current Functional Coverage

- One or more server profiles can exist in state, with one active server selected.
- Smart switches can be added, removed, turned on, and turned off through the backend API.
- Switch groups can be created and toggled as a unit.
- Live state updates flow to the browser via Server-Sent Events.

## Pending Major Work

- Pairing workflow in GUI and non-GUI
- Camera and turret rotation groups
- Alarm consolidation
- Storage monitor aggregation, delta history, and requirement engine
- External automation API expansion
- Rate-limit queueing and deeper validation