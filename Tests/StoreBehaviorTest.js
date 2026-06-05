const assert = require('assert');
const path = require('path');
const { createTempDir, removeDir } = require('./_testHarness');
const EventBus = require('../Core/app/EventBus');
const AppStateStore = require('../Core/store/AppStateStore');

function run() {
    const tempDir = createTempDir('rust-game-store-test-');
    const dataFilePath = path.join(tempDir, 'state.json');

    try {
        const eventBus = new EventBus();
        const store = new AppStateStore({ dataFilePath, eventBus });

        const initial = store.getState();
        assert.ok(initial.servers.length >= 1, 'initial state should include default server');

        const server = store.addServer({
            name: 'Store Test Server',
            host: '10.0.0.1',
            port: '28083',
            playerId: '123',
            playerToken: '456'
        });

        store.setActiveServer(server.id);
        store.setDefaultServer(server.id);

        const userPref = store.upsertUserPreference({ userId: 'qa-user', defaultServerId: server.id });
        assert.equal(userPref.defaultServerId, server.id, 'user preference should point to new default server');

        const switchDevice = store.addDevice({
            serverId: server.id,
            type: 'switch',
            name: 'Switch A',
            entityId: '1111',
            metadata: { zone: 'A' }
        });

        const storageDevice = store.addDevice({
            serverId: server.id,
            type: 'storage-monitor',
            name: 'Storage A',
            entityId: '2222',
            metadata: {}
        });

        const cameraDevice = store.addDevice({
            serverId: server.id,
            type: 'camera',
            name: 'Cam A',
            cameraId: 'OILRIG1',
            metadata: {}
        });

        store.updateDeviceState(switchDevice.id, { lastKnownState: true });
        const updatedSwitch = store.getDevice(switchDevice.id);
        assert.equal(updatedSwitch.lastKnownState, true, 'switch should be marked on');

        const switchGroup = store.addGroup({
            type: 'switch-group',
            name: 'Power',
            serverId: server.id,
            deviceIds: [switchDevice.id],
            config: { rotation: null }
        });

        const storageGroup = store.addGroup({
            type: 'storage-group',
            name: 'Storage',
            serverId: server.id,
            deviceIds: [storageDevice.id],
            config: {}
        });

        store.updateGroup(storageGroup.id, {
            config: {
                subtotals: [{ id: 'core', name: 'Core', excludedCategories: ['weapons'] }]
            }
        });

        const requirement = store.addRequirement({
            groupId: storageGroup.id,
            target: { scope: 'group' },
            condition: { operator: 'above', value: 100 },
            actions: [{ type: 'notify', message: 'test' }]
        });

        store.updateRequirement(requirement.id, { enabled: false });

        const note = store.addNotification({
            category: 'test',
            message: 'hello',
            visible: true
        });
        assert.ok(note.id, 'notification should have id');

        store.appendStorageHistory(storageDevice.id, {
            timestamp: new Date().toISOString(),
            capacity: 24,
            items: [{ itemId: 'sulfur_ore', quantity: 123, category: 'resources' }]
        });

        const history = store.getStorageHistory(storageDevice.id);
        assert.equal(history.length, 1, 'storage history should include appended entry');

        const session = store.addPairingSession({
            type: 'manual',
            status: 'completed',
            details: { ok: true }
        });
        assert.equal(session.status, 'completed', 'pairing session should be added');

        store.updatePairingMeta({ importedAt: new Date().toISOString(), sourceConfigFile: 'x.json' });

        store.removeRequirement(requirement.id);
        store.removeGroup(switchGroup.id);
        store.removeDevice(cameraDevice.id);

        const removedCount = store.removeDevicesByServer(server.id);
        assert.equal(removedCount, 2, 'server wipe should remove remaining server devices');

        const finalState = store.getState();
        assert.ok(finalState.devices.every((device) => device.serverId !== server.id), 'server devices should be cleared');
        assert.equal(finalState.groups.find((group) => group.id === storageGroup.id).deviceIds.length, 0, 'storage group should be emptied');
        assert.ok(finalState.requirements.length === 0, 'requirement should be removed');

        console.log('Store behavior test passed');
    } finally {
        removeDir(tempDir);
    }
}

try {
    run();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
