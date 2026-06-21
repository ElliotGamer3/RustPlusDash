# API Reference

Base URL: `http://127.0.0.1:3030`

All request bodies are JSON.

## Health and State

### GET /health
Returns backend liveness.

Response:
```json
{ "ok": true }
```

### GET /api/state
Returns full application snapshot for GUI and automation clients.

## Event Stream

### GET /api/events
Server-Sent Events stream.

Events currently emitted:
- `state`
- `connection`
- `notification`
- `storage-group-updated`
- `camera-frame`
- `rotation-updated`
- `pairing-updated`

## Server Profiles

### POST /api/servers
Create server profile.

Request:
```json
{
  "name": "NA Main",
  "host": "1.2.3.4",
  "port": "28083",
  "playerId": "7656119...",
  "playerToken": "-12345",
  "isDefault": false
}
```

### POST /api/servers/active
Set active server.

Request:
```json
{ "serverId": "default-server" }
```

### POST /api/servers/default
Set default server.

Request:
```json
{ "serverId": "default-server" }
```

### DELETE /api/servers/:serverId
Delete server profile.

## Pairing Workflows

### POST /api/pairing/import-config
Import pairing metadata from a rustplus config file.

Request:
```json
{ "configPath": "C:/path/to/rustplus.config.json" }
```

### POST /api/pairing/server
Manual server pairing.

Request:
```json
{
  "name": "EU Duo",
  "host": "2.3.4.5",
  "port": "28083",
  "playerId": "7656119...",
  "playerToken": "-98765",
  "isDefault": false
}
```

### POST /api/pairing/device
Manual device pairing.

Request:
```json
{
  "serverId": "default-server",
  "type": "switch",
  "name": "Furnace Block",
  "entityId": "1234567",
  "cameraId": null,
  "metadata": {}
}
```

## Devices
### POST /api/devices/export
Exports all paired devices as a JSON file that can be imported using the `/api/devices/import` endpoint.
Request:
```json
{
  "serverId": "default-server",
  "types": ["switch", "alarm"],
  "includeMetadata": true
}
```

### POST /api/devices/import
Imports devices from a JSON export created by the `/api/devices/export` endpoint. This allows users to bulk import devices without needing to pair each one manually.
Request:
```json
{
  "serverId": "default-server",
  "devices": [
    {
      "type": "switch",
      "name": "Furnace Block",
      "entityId": "1234567",
      "cameraId": null,
      "metadata": {}
    },
    {
      "type": "alarm",
      "name": "Main Door Alarm",
      "entityId": "2345678",
      "cameraId": null,
      "metadata": {}
    }
  ]
}
```

### POST /api/devices
Add typed device.

Request:
```json
{
  "serverId": "default-server",
  "type": "camera",
  "name": "Oil Cam",
  "cameraId": "OILRIG1"
}
```

Supported types:
- `switch`
- `alarm`
- `camera`
- `turret`
- `storage-monitor`

### PATCH /api/devices/:deviceId
Update mutable device fields.

### DELETE /api/devices/:deviceId
Delete device.

### Compatibility endpoints
- `POST /api/switches`
- `POST /api/switches/:deviceId/on`
- `POST /api/switches/:deviceId/off`
- `DELETE /api/switches/:deviceId`

## Groups

### POST /api/groups
Create typed group.

Request:
```json
{
  "serverId": "default-server",
  "type": "storage-group",
  "name": "Main Storage",
  "deviceIds": ["device-1", "device-2"]
}
```

Supported types:
- `switch-group`
- `alarm-group`
- `camera-group`
- `turret-group`
- `storage-group`

### PATCH /api/groups/:groupId
Update group fields.

### DELETE /api/groups/:groupId
Delete group.

### Switch group actions
- `POST /api/groups/:groupId/on`
- `POST /api/groups/:groupId/off`

## Camera and Turret Rotation

### POST /api/groups/:groupId/rotation/start
Request:
```json
{ "intervalMs": 5000 }
```

### POST /api/groups/:groupId/rotation/pause
### POST /api/groups/:groupId/rotation/resume
### POST /api/groups/:groupId/rotation/select
Request:
```json
{ "deviceId": "camera-device-id" }
```

### GET /api/groups/:groupId/view
Returns current active device and latest frame metadata.

### POST /api/cameras/:deviceId/subscribe
Subscribe to device camera feed.

### POST /api/cameras/:deviceId/control
Request:
```json
{
  "command": "move",
  "payload": { "buttons": 0, "x": 0, "y": 5 }
}
```

Supported commands:
- `move`
- `shoot`
- `reload`
- `zoom`

## Alarm Consolidation

### POST /api/groups/:groupId/alarm-consolidation
Request:
```json
{
  "enabled": true,
  "windowMs": 2000,
  "excludedDeviceIds": ["alarm-device-id"]
}
```

## Storage Monitor Analytics

### POST /api/groups/:groupId/storage/subtotals
Request:
```json
{
  "subtotals": [
    {
      "id": "core",
      "name": "Core Materials",
      "excludedCategories": ["weapons"]
    }
  ]
}
```

### POST /api/groups/:groupId/storage/delta
Request:
```json
{
  "enabled": true,
  "includeItems": ["sulfur_ore"],
  "includeCategories": ["resources"]
}
```

### GET /api/groups/:groupId/storage/metrics
Returns grand totals, subtotals, and history.

### GET /api/groups/:groupId/storage/graph?item=sulfur_ore&minutes=60
Returns rolling graph points for a given item.

## Requirements and Automation

### POST /api/requirements
Create requirement.

Request:
```json
{
  "groupId": "storage-group-id",
  "target": { "scope": "item", "itemId": "sulfur_ore", "metric": "quantity" },
  "condition": { "operator": "below", "value": 2000 },
  "actions": [
    { "type": "notify", "message": "Sulfur low" },
    { "type": "team-message", "serverId": "default-server", "message": "Sulfur is low" }
  ],
  "etaEnabled": true,
  "enabled": true
}
```

### PATCH /api/requirements/:requirementId
Update requirement fields.

### DELETE /api/requirements/:requirementId
Delete requirement.

### POST /api/requirements/:requirementId/estimate
Request:
```json
{ "mode": "rolling" }
```

Modes:
- `rolling`
- `instant`

## Team Chat

### POST /api/team/messages
Request:
```json
{
  "serverId": "default-server",
  "message": "Raid starts in 5"
}
```

## Notifications

### GET /api/notifications?limit=200
Returns recent backend notification records.

## Notes for Script Authors

- Prefer `/api/devices` and `/api/groups` for new automation scripts.
- Use `/api/events` for low-latency updates instead of polling `/api/state`.
- Pairing via config import and manual entry is supported in-app; full FCM/Expo automation remains external to this backend.
