class CameraTurretService {
    constructor({ store, eventBus, groupService, deviceService, connectionManager }) {
        this.store = store;
        this.eventBus = eventBus;
        this.groupService = groupService;
        this.deviceService = deviceService;
        this.connectionManager = connectionManager;
        this.rotationTimers = new Map();
    }

    async subscribeDevice(deviceId) {
        const device = this.deviceService.findDevice(deviceId);
        if (!['camera', 'turret'].includes(device.type)) {
            throw new Error(`Device ${deviceId} is not camera or turret`);
        }

        if (!device.cameraId) {
            throw new Error('Camera or turret devices require cameraId');
        }

        try {
            const cameraRecord = await this.connectionManager.subscribeCamera(device.serverId, device.cameraId);

            this.store.updateDevice(device.id, {
                metadata: {
                    ...(device.metadata || {}),
                    subscribed: true,
                    subscribeError: null,
                    latestFrameAt: cameraRecord.latestFrameAt
                }
            });

            return {
                deviceId,
                serverId: device.serverId,
                cameraId: device.cameraId,
                subscribed: true
            };
        } catch (error) {
            const subscribeError = error && (error.error || error.message || String(error)) || 'Unknown camera subscribe failure';

            this.store.updateDevice(device.id, {
                metadata: {
                    ...(device.metadata || {}),
                    subscribed: false,
                    subscribeError,
                    latestFrameAt: null
                }
            });

            return {
                deviceId,
                serverId: device.serverId,
                cameraId: device.cameraId,
                subscribed: false,
                error: subscribeError
            };
        }
    }

    async controlDevice(deviceId, command, payload = {}) {
        const device = this.deviceService.findDevice(deviceId);

        if (!device.cameraId) {
            throw new Error('Camera identifier is required for control');
        }

        if (command === 'move') {
            await this.connectionManager.cameraMove(device.serverId, device.cameraId, payload.buttons || 0, payload.x || 0, payload.y || 0);
        }

        if (command === 'shoot') {
            await this.connectionManager.cameraShoot(device.serverId, device.cameraId);
        }

        if (command === 'reload') {
            await this.connectionManager.cameraReload(device.serverId, device.cameraId);
        }

        if (command === 'zoom') {
            await this.connectionManager.cameraZoom(device.serverId, device.cameraId);
        }

        return {
            ok: true,
            command,
            deviceId
        };
    }

    startRotation(groupId, intervalMs) {
        const group = this.groupService.getGroup(groupId);

        if (!['camera-group', 'turret-group'].includes(group.type)) {
            throw new Error(`Group ${groupId} does not support rotation`);
        }

        const nextGroup = this.groupService.setRotationConfig(group.id, {
            enabled: true,
            intervalMs,
            paused: false,
            pausedByUser: false,
            activeDeviceId: group.config?.rotation?.activeDeviceId || group.deviceIds[0] || null
        });

        this.#ensureRotationTimer(nextGroup.id);
        this.eventBus.emit('rotation:updated', { groupId: nextGroup.id });
        return nextGroup;
    }

    pauseRotation(groupId, pausedByUser = true) {
        const group = this.groupService.getGroup(groupId);
        const nextGroup = this.groupService.setRotationConfig(group.id, {
            ...(group.config?.rotation || {}),
            enabled: true,
            paused: true,
            pausedByUser
        });
        this.#clearRotationTimer(groupId);
        this.eventBus.emit('rotation:updated', { groupId: nextGroup.id });
        return nextGroup;
    }

    resumeRotation(groupId) {
        const group = this.groupService.getGroup(groupId);
        const nextGroup = this.groupService.setRotationConfig(group.id, {
            ...(group.config?.rotation || {}),
            enabled: true,
            paused: false,
            pausedByUser: false
        });
        this.#ensureRotationTimer(groupId);
        this.eventBus.emit('rotation:updated', { groupId: nextGroup.id });
        return nextGroup;
    }

    manualSelect(groupId, deviceId) {
        const group = this.groupService.getGroup(groupId);

        if (!group.deviceIds.includes(deviceId)) {
            throw new Error(`Device ${deviceId} is not part of group ${groupId}`);
        }

        const nextGroup = this.groupService.setRotationConfig(group.id, {
            ...(group.config?.rotation || {}),
            activeDeviceId: deviceId,
            paused: true,
            pausedByUser: true,
            enabled: true
        });

        this.#clearRotationTimer(groupId);
        this.eventBus.emit('rotation:updated', { groupId: nextGroup.id });
        return nextGroup;
    }

    getCurrentView(groupId) {
        const group = this.groupService.getGroup(groupId);
        const activeDeviceId = group.config?.rotation?.activeDeviceId || group.deviceIds[0] || null;

        if (!activeDeviceId) {
            return {
                groupId,
                activeDevice: null,
                frame: null
            };
        }

        const activeDevice = this.deviceService.findDevice(activeDeviceId);
        const latestFrame = activeDevice.cameraId
            ? this.connectionManager.getLatestCameraFrame(activeDevice.serverId, activeDevice.cameraId)
            : null;

        return {
            groupId,
            activeDevice,
            frame: latestFrame
        };
    }

    startFromState() {
        const groups = this.store.getGroups().filter((group) => {
            const rotation = group.config?.rotation;
            return rotation && rotation.enabled && !rotation.paused;
        });

        for (const group of groups) {
            this.#ensureRotationTimer(group.id);
        }
    }

    #ensureRotationTimer(groupId) {
        this.#clearRotationTimer(groupId);
        const group = this.groupService.getGroup(groupId);
        const intervalMs = Math.max(1000, Number(group.config?.rotation?.intervalMs) || 5000);

        const timerId = setInterval(async () => {
            const latest = this.groupService.getGroup(groupId);
            const rotation = latest.config?.rotation;

            if (!rotation || rotation.paused || !rotation.enabled) {
                this.#clearRotationTimer(groupId);
                return;
            }

            if (latest.deviceIds.length === 0) {
                return;
            }

            const currentIndex = latest.deviceIds.indexOf(rotation.activeDeviceId);
            const nextIndex = currentIndex < 0
                ? 0
                : (currentIndex + 1) % latest.deviceIds.length;
            const nextDeviceId = latest.deviceIds[nextIndex];

            this.groupService.setRotationConfig(groupId, {
                ...rotation,
                activeDeviceId: nextDeviceId,
                paused: false,
                pausedByUser: false
            });

            try {
                await this.subscribeDevice(nextDeviceId);
            } catch (error) {
                this.eventBus.emit('rotation:error', {
                    groupId,
                    deviceId: nextDeviceId,
                    error: error.message
                });
            }

            this.eventBus.emit('rotation:updated', { groupId });
        }, intervalMs);

        this.rotationTimers.set(groupId, timerId);
    }

    #clearRotationTimer(groupId) {
        const timerId = this.rotationTimers.get(groupId);
        if (timerId) {
            clearInterval(timerId);
            this.rotationTimers.delete(groupId);
        }
    }
}

module.exports = CameraTurretService;
