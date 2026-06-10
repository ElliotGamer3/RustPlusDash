const EventBus = require('./EventBus');
const AppStateStore = require('../store/AppStateStore');
const RustConnectionManager = require('../services/RustConnectionManager');
const RateLimitCoordinator = require('../services/RateLimitCoordinator');
const DeviceService = require('../services/DeviceService');
const NotificationService = require('../services/NotificationService');
const PairingService = require('../services/PairingService');
const PairingListenerService = require('../services/PairingListenerService');
const SmartSwitchService = require('../services/SmartSwitchService');
const GroupService = require('../services/GroupService');
const CameraTurretService = require('../services/CameraTurretService');
const AlarmService = require('../services/AlarmService');
const StorageMonitorService = require('../services/StorageMonitorService');
const RequirementService = require('../services/RequirementService');
const TeamMessageService = require('../services/TeamMessageService');

class Application {
    constructor({ dataFilePath, host, port, skipRustConnect = false }) {
        this.host = host;
        this.port = port;
        this.skipRustConnect = skipRustConnect;
        this.eventBus = new EventBus();
        this.store = new AppStateStore({ dataFilePath, eventBus: this.eventBus });
        this.rateLimitCoordinator = new RateLimitCoordinator({ eventBus: this.eventBus });
        this.connectionManager = new RustConnectionManager({
            store: this.store,
            eventBus: this.eventBus,
            rateLimitCoordinator: this.rateLimitCoordinator
        });
        this.deviceService = new DeviceService({
            store: this.store,
            connectionManager: this.connectionManager
        });
        this.notificationService = new NotificationService({
            store: this.store,
            eventBus: this.eventBus
        });
        this.pairingService = new PairingService({
            store: this.store,
            deviceService: this.deviceService,
            eventBus: this.eventBus
        });
        this.pairingListenerService = new PairingListenerService({
            pairingService: this.pairingService,
            notificationService: this.notificationService,
            eventBus: this.eventBus
        });
        this.smartSwitchService = new SmartSwitchService({
            store: this.store,
            deviceService: this.deviceService,
            connectionManager: this.connectionManager,
            eventBus: this.eventBus
        });
        this.groupService = new GroupService({
            store: this.store,
            smartSwitchService: this.smartSwitchService,
            deviceService: this.deviceService
        });
        this.cameraTurretService = new CameraTurretService({
            store: this.store,
            eventBus: this.eventBus,
            groupService: this.groupService,
            deviceService: this.deviceService,
            connectionManager: this.connectionManager
        });
        this.alarmService = new AlarmService({
            store: this.store,
            eventBus: this.eventBus,
            deviceService: this.deviceService,
            groupService: this.groupService,
            notificationService: this.notificationService
        });
        this.storageMonitorService = new StorageMonitorService({
            store: this.store,
            eventBus: this.eventBus,
            deviceService: this.deviceService,
            groupService: this.groupService,
            notificationService: this.notificationService
        });
        this.teamMessageService = new TeamMessageService({
            store: this.store,
            connectionManager: this.connectionManager
        });
        this.requirementService = new RequirementService({
            store: this.store,
            eventBus: this.eventBus,
            groupService: this.groupService,
            storageMonitorService: this.storageMonitorService,
            notificationService: this.notificationService,
            smartSwitchService: this.smartSwitchService,
            teamMessageService: this.teamMessageService
        });
    }

    async start() {
        const activeServer = this.store.getActiveServer();
        const hasUsableServer = Boolean(
            activeServer &&
            String(activeServer.host || '').trim() &&
            String(activeServer.port || '').trim() &&
            String(activeServer.playerId || '').trim() &&
            String(activeServer.playerToken || '').trim()
        );

        if (!hasUsableServer) {
            return;
        }

        if (!this.skipRustConnect) {
            try {
                await this.connectionManager.start();
            } catch (error) {
                this.notificationService.log({
                    category: 'startup',
                    visible: false,
                    message: `Rust+ startup connect failed: ${error.message}`
                });
            }
            this.connectionManager.logInvokableMethods(this.store.getActiveServer().id);
        }

        try {
            await this.deviceService.primeExistingDevices();
            await this.smartSwitchService.primeExistingSwitches();
        } catch (error) {
            this.notificationService.log({
                category: 'startup',
                visible: false,
                message: `Device priming skipped: ${error.message}`
            });
        }

        this.cameraTurretService.startFromState();
    }

    getPublicState() {
        const state = this.store.getPublicState();
        const groupSummaries = this.groupService.getSummaries();
        const connectionStates = this.connectionManager.getConnectionStates();
        const requestStates = this.connectionManager.getRequestStates();

        return {
            ...state,
            connectionStates,
            requestStates,
            pairingListener: this.pairingListenerService.getStatus(),
            notifications: this.notificationService.getRecent(300),
            groups: groupSummaries
        };
    }

    getRouterContext() {
        return {
            eventBus: this.eventBus,
            store: this.store,
            connectionManager: this.connectionManager,
            rateLimitCoordinator: this.rateLimitCoordinator,
            deviceService: this.deviceService,
            notificationService: this.notificationService,
            pairingService: this.pairingService,
            pairingListenerService: this.pairingListenerService,
            smartSwitchService: this.smartSwitchService,
            groupService: this.groupService,
            cameraTurretService: this.cameraTurretService,
            alarmService: this.alarmService,
            storageMonitorService: this.storageMonitorService,
            requirementService: this.requirementService,
            teamMessageService: this.teamMessageService
        };
    }
}

module.exports = Application;