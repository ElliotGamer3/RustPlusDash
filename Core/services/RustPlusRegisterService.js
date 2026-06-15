const fs = require('fs');
const path = require('path');
const uuidv4 = require('uuid').v4;
const AndroidFCM = require('@liamcottle/push-receiver/src/android/fcm');


class RustPlusRegisterService {
    constructor({store, eventBus}) {
        this.rustConnectionConfigPath = process.env.RUST_PLUS_CONFIG_PATH || path.join(__dirname, '../data/rustplus-connection-config.json');
        console.log('Using RustConnectionPlus config path:', this.rustConnectionConfigPath);
        this.rustPlusConfigPath = process.env.RUST_PLUS_CONFIG_PATH || path.join(__dirname, '../../rustplus.config.json');
        console.log('Using RustPlus config path:', this.rustPlusConfigPath);
        this.steamAuthTokenPath = process.env.STEAM_AUTH_TOKEN_PATH || path.join(__dirname, '../data/steam-auth-token.json');
        console.log('Using Steam auth token path:', this.steamAuthTokenPath);
        this.store = store;
        this.eventBus = eventBus;
        this.config = null;
        this.rustConnectionConfig = null;
        this.steamAuthConfig = null;
    }

    initialRustConnectionConfig() {
        return {
            "desc":"These values are defined by rust and are not user specific. They are used to get required info inorder to work with the rustplus api.",
            "projectId":"rust-companion-app",
            "expoProjectId": "49451aca-a822-41e6-ad59-955718d0ff9c",
            "apiKey":"AIzaSyB5y2y-Tzqb4-I4Qnlsh_9naYv_TD8pCvY",
            "gcmSenderId":"976529667804",
            "gmsAppId":"1:976529667804:android:d6f1ddeb4403b338fea619",
            "androidPackageName":"com.facepunch.rust.companion",
            "androidPackageCert":"E28D05345FB78A7A1A63D70F4A302DBF426CA5AD",
            "rustPlusDeviceId":"rustplus.js",
            "authDomain":"",
            "senderId":"",
            "appId":"com.facepunch.rust.companion"
        };
    }

    async loadRustConnectionConfig() {
        // If the config file doesn't exist, create it with empty json to prevent errors
        const configData = await fs.promises.readFile(this.rustConnectionConfigPath, 'utf-8').catch(async err => {
            if (err.code === 'ENOENT') {
                const initialConfig = this.initialRustConnectionConfig();
                await fs.promises.writeFile(this.rustConnectionConfigPath, JSON.stringify(initialConfig), 'utf-8');
                return JSON.stringify(initialConfig);
            } else {
                console.error('Error reading Rust connection config file:', err);
                throw err;
            }
        });
        this.rustConnectionConfig = JSON.parse(await configData);
    }

    async loadSteamAuthConfig() {
        // If the steam auth token file doesn't exist, create it with empty json to prevent errors
        const steamAuthData = await fs.promises.readFile(this.steamAuthTokenPath, 'utf-8').catch(async err => {
            if (err.code === 'ENOENT') {
                this.eventBus.emit('steamauth:notLinked');
                console.error('Steam auth token file not found, emitting steamauth:notLinked event and canceling registration process');
                return null;
            }
        });

        if (steamAuthData) {
            this.steamAuthConfig = JSON.parse(steamAuthData);
            console.log('Steam auth token data loaded successfully');
        } else {
            console.error('Steam auth token data is null, link account before registering');
            return null;
        }
    }

    async writeSteamAuthToken(steamAuthToken, steamId) {
        return new Promise(async (resolve, reject) => {
            const tokenData = {
                "steamAuthToken": steamAuthToken,
                "steamId": steamId,
                "timestamp": new Date().toISOString()            
            };
            await fs.promises.writeFile(this.steamAuthTokenPath, JSON.stringify(tokenData), 'utf-8').catch(err => {
                console.error('Error writing steam auth token to file:', err);
                reject(err);
            });
            console.log('Steam auth token written to file successfully');
            resolve();
        });
    }

    async writeFinalConfig(fcmCredentials, expoPushToken, steamAuthToken) {
        const finalConfigData = {
            fcm_credentials: fcmCredentials,
            expo_push_token: expoPushToken,
            rustplus_auth_token: steamAuthToken,
        };
        await fs.promises.writeFile(this.rustPlusConfigPath, JSON.stringify(finalConfigData), 'utf-8').catch(err => {
            console.error('Error writing final config to file:', err);
            throw err;
        });
        console.log('Final config written to file successfully');
    }

    async isSteamLinked() {
        if (!fs.existsSync(this.steamAuthTokenPath)) {
            console.error('Steam auth token file does not exist, steam account is not linked');
            return false;
        }
        const steamAuthData = await fs.promises.readFile(this.steamAuthTokenPath, 'utf-8').catch(err => {
            console.error('Error reading steam auth token file:', err);
            throw err;
        });
        const steamAuthJson = JSON.parse(steamAuthData);
        if (!steamAuthJson.steamAuthToken || !steamAuthJson.steamId) {
            console.error('Steam auth token or steam ID is missing in the steam auth token file, steam account is not linked');
            return false;
        }
        // If the steam auth token is older than 14 days, it needs to be refreshed, so we consider the account not linked in that case as well
        const tokenTimestamp = new Date(steamAuthJson.timestamp);
        const now = new Date();
        const ttlInDays = 14;
        const ttl = ttlInDays * 24 * 60 * 60 * 1000; // Convert TTL from days to milliseconds
        if (now - tokenTimestamp > ttl) {
            console.error('Steam auth token is older than 14 days, it needs to be refreshed, steam account is not linked');
            return false;
        }
        console.log('Steam account is linked');
        return true;
    }

    async writeExpoPushToken(expoPushToken) {
        // check if it exists
        if (fs.existsSync(this.rustPlusConfigPath)) {
            // Write the expo push token to the config file, if the file already exists read the existing config and merge it with the new expo push token value to prevent overwriting other values in the config file
            const existingConfigData = await fs.promises.readFile(this.rustPlusConfigPath, 'utf-8').catch(err => {
                console.error('Error reading existing rust plus config file:', err);
                throw err;
            });
            let existingConfig = {};
            try {
                existingConfig = JSON.parse(existingConfigData);
            } catch (err) {
                console.error('Error parsing existing rust plus config file, it may be corrupted:', err);
                existingConfig = {};
            }
            const updatedConfig = {
                ...existingConfig,
                expo_push_token: expoPushToken,
            };
            await fs.promises.writeFile(this.rustPlusConfigPath, JSON.stringify(updatedConfig), 'utf-8').catch(err => {
                console.error('Error writing expo push token to rust plus config file:', err);
                throw err;
            });
            console.log('Expo push token written to rust plus config file successfully');
        } else {
            // If the config file doesn't exist, create it with the expo push token value
            const newConfig = {
                expo_push_token: expoPushToken,
            };
            await fs.promises.writeFile(this.rustPlusConfigPath, JSON.stringify(newConfig), 'utf-8').catch(err => {
                console.error('Error writing expo push token to new rust plus config file:', err);
                throw err;
            });
            console.log('Expo push token written to new rust plus config file successfully');
        }
    }

    async writeFcmCredentials(fcmCredentials) {
        // check if it exists
        if (fs.existsSync(this.rustPlusConfigPath)) {
            // Write the fcm credentials to the config file, if the file already exists read the existing config and merge it with the new fcm credentials value to prevent overwriting other values in the config file
            const existingConfigData = await fs.promises.readFile(this.rustPlusConfigPath, 'utf-8').catch(err => {
                console.error('Error reading existing rust plus config file:', err);
                throw err;
            });
            let existingConfig = {};
            try {
                existingConfig = JSON.parse(existingConfigData);
            } catch (err) {
                console.error('Error parsing existing rust plus config file, it may be corrupted:', err);
                existingConfig = {};
            }
            const updatedConfig = {
                ...existingConfig,
                fcm_credentials: fcmCredentials,
            };
            await fs.promises.writeFile(this.rustPlusConfigPath, JSON.stringify(updatedConfig), 'utf-8').catch(err => {
                console.error('Error writing fcm credentials to rust plus config file:', err);
                throw err;
            });
            console.log('FCM credentials written to rust plus config file successfully');
        } else {
            // If the config file doesn't exist, create it with the fcm credentials value
            const newConfig = {
                fcm_credentials: fcmCredentials,
            };
            await fs.promises.writeFile(this.rustPlusConfigPath, JSON.stringify(newConfig), 'utf-8').catch(err => {
                console.error('Error writing fcm credentials to new rust plus config file:', err);
                throw err;
            });
            console.log('FCM credentials written to new rust plus config file successfully');
        }
    }

    async writeRustPlusAuthToken(steamAuthToken) {
        // check if it exists
        if (fs.existsSync(this.rustPlusConfigPath)) {
            // Write the rust plus auth token to the config file, if the file already exists read the existing config and merge it with the new rust plus auth token value to prevent overwriting other values in the config file
            const existingConfigData = await fs.promises.readFile(this.rustPlusConfigPath, 'utf-8').catch(err => {
                console.error('Error reading existing rust plus config file:', err);
                throw err;
            });
            let existingConfig = {};
            try {
                existingConfig = JSON.parse(existingConfigData);
            } catch (err) {
                console.error('Error parsing existing rust plus config file, it may be corrupted:', err);
                existingConfig = {};
            }
            const updatedConfig = {
                ...existingConfig,
                rustplus_auth_token: steamAuthToken,
            };
            await fs.promises.writeFile(this.rustPlusConfigPath, JSON.stringify(updatedConfig), 'utf-8').catch(err => {
                console.error('Error writing rust plus auth token to rust plus config file:', err);
                throw err;
            });
            console.log('Rust plus auth token written to rust plus config file successfully');
        } else {
            // If the config file doesn't exist, create it with the rust plus auth token value
            const newConfig = {
                rustplus_auth_token: steamAuthToken,
            };
            await fs.promises.writeFile(this.rustPlusConfigPath, JSON.stringify(newConfig), 'utf-8').catch(err => {
                console.error('Error writing rust plus auth token to new rust plus config file:', err);
                throw err;
            });
            console.log('Rust plus auth token written to new rust plus config file successfully');
        }
    }

    async getFCMCredentials() {
        if (!this.rustConnectionConfig) {
            await this.loadRustConnectionConfig();
        }
        if (!this.rustConnectionConfig.apiKey || !this.rustConnectionConfig.projectId || !this.rustConnectionConfig.gcmSenderId || !this.rustConnectionConfig.gmsAppId || !this.rustConnectionConfig.androidPackageName || !this.rustConnectionConfig.androidPackageCert) {
            throw new Error('Missing required Rust connection config values for FCM credentials');
        }

        return await AndroidFCM.register(this.rustConnectionConfig.apiKey, this.rustConnectionConfig.projectId, this.rustConnectionConfig.gcmSenderId, this.rustConnectionConfig.gmsAppId, this.rustConnectionConfig.androidPackageName, this.rustConnectionConfig.androidPackageCert);
    }

    async getExpoPushToken(FCMCredentials) {
        if (!this.RustConnectionConfig) {
            await this.loadRustConnectionConfig();
        }
        if (!this.rustConnectionConfig.appId || !this.rustConnectionConfig.expoProjectId) {
            throw new Error('Missing required Rust connection config values for Expo push token');
        }
        if(!FCMCredentials || !FCMCredentials.fcm || !FCMCredentials.fcm.token) {
            throw new Error('Missing required FCM credentials for Expo push token');
        }
        const expoPushTokenJson = await fetch('https://exp.host/--/api/v2/push/getExpoPushToken', {
            method: 'POST',
            headers: {
                'device-type': 'android',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                type: 'fcm',
                deviceId: uuidv4(),
                development: false,
                appId: this.rustConnectionConfig.appId,
                deviceToken: FCMCredentials.fcm.token,
                projectId: this.rustConnectionConfig.expoProjectId
            })
        }).catch(err => {
            console.error('Error getting Expo push token:', err);
            throw err;
        });
        const expoPushToken = await expoPushTokenJson.json().then(data => data.data.expoPushToken).catch(err => {
            console.error('Error parsing Expo push token response:', err);
            throw err;
        });
        if (!expoPushToken) {
            throw new Error('Failed to get Expo push token');
        }
        return expoPushToken;
    }

    async getSteamAuthToken() {
        if (!this.steamAuthConfig) {
            await this.loadSteamAuthConfig();
        }
        if (!this.steamAuthConfig || !this.steamAuthConfig.steamAuthToken || !this.steamAuthConfig.steamId) {
            // Send an event to the frontend to notify the user that they need to link their steam account, this should trigger the page to redirect to the /register route
            this.eventBus.emit('steamauth:notLinked');
            throw new Error('Steam auth token or steam ID is missing, please link your steam account');
        }
        return {
            steamAuthToken: this.steamAuthConfig.steamAuthToken,
            steamId: this.steamAuthConfig.steamId,
            timestamp: this.steamAuthConfig.timestamp,
        };
    }

    async getRegistrationData() {
        const fcmCredentials = await this.getFCMCredentials().catch(err => {
            console.error('Error getting FCM credentials:', err);
            this.eventBus.emit('rustconnection:registrationFailed', { error: 'Failed to get FCM credentials' });
            return;
        });
        if (!fcmCredentials) {
            return;
        } else {
            console.log('FCM credentials obtained');
            this.writeFcmCredentials(fcmCredentials).catch(err => {
                console.error('Error writing FCM credentials to config file:', err);
                this.eventBus.emit('rustconnection:registrationFailed', { error: 'Failed to write FCM credentials to config file' });
                return;
            });
        }
        const expoPushToken = await this.getExpoPushToken(fcmCredentials).catch(err => {
            console.error('Error getting Expo push token:', err);
            this.eventBus.emit('rustconnection:registrationFailed', { error: 'Failed to get Expo push token' });
            return;
        });
        if (!expoPushToken) {
            console.error('Expo push token is null or undefined');
            this.eventBus.emit('rustconnection:registrationFailed', { error: 'Failed to get Expo push token' });
            return;
        } else {
            console.log('Expo push token obtained');
            this.writeExpoPushToken(expoPushToken).catch(err => {
                console.error('Error writing Expo push token to config file:', err);
                this.eventBus.emit('rustconnection:registrationFailed', { error: 'Failed to write Expo push token to config file' });
                return;
            });
        }
        const steamAuthTokenData = await this.getSteamAuthToken().catch(err => {
            console.error('Error getting Steam auth token:', err);
            this.eventBus.emit('rustconnection:registrationFailed', { error: 'Failed to get Steam auth token' });
            return;
        });
        if (!steamAuthTokenData || !steamAuthTokenData.steamAuthToken || !steamAuthTokenData.steamId) {
            console.error('Steam auth token data is missing required values');
            this.eventBus.emit('rustconnection:registrationFailed', { error: 'Failed to get Steam auth token' });
            return;
        } else {
            console.log('Steam auth token obtained');
            this.writeRustPlusAuthToken(steamAuthTokenData.steamAuthToken).catch(err => {
                console.error('Error writing RustPlus auth token to config file:', err);
                this.eventBus.emit('rustconnection:registrationFailed', { error: 'Failed to write RustPlus auth token to config file' });
                return;
            });
        }
        return {
            fcmCredentials: fcmCredentials,
            expoPushToken: expoPushToken,
            steamAuthToken: steamAuthTokenData.steamAuthToken,
        };
    }

    async register() {
        return new Promise(async (resolve, reject) => {
            try {
                const regData = await this.getRegistrationData();
            } catch (err) {
                console.error('Error getting registration data:', err);
                this.eventBus.emit('rustconnection:registrationFailed', { error: 'Failed to get registration data' });
                reject(err);
                return;
            }
            try {
                const regData = await this.getRegistrationData();
                if (!regData) {
                    console.error('Registration data is null or undefined');
                    this.eventBus.emit('rustconnection:registrationFailed', { error: 'Failed to get registration data' });
                    reject(new Error('Failed to get registration data'));
                    return;
                }
                const registrationResponse = await fetch('https://companion-rust.facepunch.com:443/api/push/register', {
                    method: 'POST',
                    headers: {
                        'device-type': 'android',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        AuthToken: regData.steamAuthToken,
                        DeviceId: this.rustConnectionConfig.rustPlusDeviceId,
                        PushKind: 3,
                        PushToken: regData.expoPushToken,
                    })
                }).then(res => res.json()).catch(err => {
                    console.error('Error registering with RustPlus API:', err);
                    throw err;
                });
                
                this.writeFinalConfig(regData.fcmCredentials, regData.expoPushToken, regData.steamAuthToken).catch(err => {
                    console.error('Error writing final config to file:', err);
                    this.eventBus.emit('rustconnection:registrationFailed', { error: 'Failed to write final config to file' });
                    return;
                });
                console.log('Registration successful with RustPlus API');
                this.eventBus.emit('rustconnection:registrationSuccess', { message: 'Registration successful' });
            } catch (err) {
                console.error('Error during registration process:', err);
                this.eventBus.emit('rustconnection:registrationFailed', { error: err.message });
                reject(err);
                return;
            }
            resolve();
        });
    }

    getSteamLinkStatus() {
        if (!this.steamAuthConfig) {
            return {
                status: 'unlinked',
                linked: false,
                message: 'Steam account not linked',
                ttl: null
            };
        }
        const tokenTimestamp = new Date(this.steamAuthConfig.timestamp);
        const now = new Date();
        const ttlInDays = 14;
        const ttl = ttlInDays * 24 * 60 * 60 * 1000; // Convert TTL from days to milliseconds
        if (now - tokenTimestamp > ttl) {
            return {
                status: 'expired',
                linked: false,
                message: 'Steam auth token is expired, please refresh your token',
                ttl: 0
            };
        }
        return {
            status: 'linked',
            linked: true,
            message: 'Steam account is linked',
            ttl: Math.round((ttl - (now - tokenTimestamp)) / (1000 * 60 * 60 * 24)) // Return TTL until expiration in days
        };
    }
}

module.exports = RustPlusRegisterService;
