import { Platform, NativeModules, NativeEventEmitter, DeviceEventEmitter } from 'react-native';
const { RNSSHClient } = NativeModules;
const RNSSHClientEmitter = new NativeEventEmitter(RNSSHClient);
const NATIVE_EVENT_SHELL = 'Shell';
const NATIVE_EVENT_SHELL_RAW = 'ShellRaw';
const NATIVE_EVENT_DOWNLOAD_PROGRESS = 'DownloadProgress';
const NATIVE_EVENT_UPLOAD_PROGRESS = 'UploadProgress';
/**
 * Represents the types of PTY (pseudo-terminal) for SSH connections.
 */
export var PtyType;
(function (PtyType) {
    PtyType["VANILLA"] = "vanilla";
    PtyType["VT100"] = "vt100";
    PtyType["VT102"] = "vt102";
    PtyType["VT220"] = "vt220";
    PtyType["ANSI"] = "ansi";
    PtyType["XTERM"] = "xterm";
})(PtyType || (PtyType = {}));
/**
 * Represents an SSH client that can connect to a remote server and perform various operations.
 * Instances of SSHClient are created using the following factory functions:
 * - SSHClient.connectWithKey()
 * - SSHClient.connectWithPassword()
 */
export default class SSHClient {
    static removeHostKey(host, port, knownHostsPath) {
        return new Promise((resolve, reject) => {
            if (!RNSSHClient.removeHostKey) {
                const error = new Error('Native host-key removal is unavailable');
                error.code = 'SSH_HOST_KEY_NATIVE_UNAVAILABLE';
                reject(error);
                return;
            }
            RNSSHClient.removeHostKey(host, port, knownHostsPath, (code, message) => {
                if (code) {
                    const error = new Error(message || code);
                    error.code = code;
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
    * Retrieves the details of an SSH key.
    * @param key - The SSH private key as a string.
    * @returns A Promise that resolves to the details of the key, including its type and size.
    */
    static getKeyDetails(key) {
        return new Promise((resolve, reject) => {
            RNSSHClient.getKeyDetails(key)
                .then((result) => {
                /* eslint-disable no-console */
                console.log(result);
                /* eslint-enable no-console */
                resolve({
                    keyType: result.keyType,
                    keySize: result.keySize || 0
                });
            })
                .catch((error) => {
                reject(error);
            });
        });
    }
    static generateKeyPair(type, passphrase, keySize, comment) {
        return new Promise((resolve, reject) => {
            RNSSHClient.generateKeyPair(type, passphrase, keySize, comment, (error, keys) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve({
                        privateKey: keys.privateKey,
                        publicKey: keys.publicKey,
                    });
                }
            });
        });
    }
    /**
     * Connects to an SSH server using a private key for authentication.
     *
     * @param host - The hostname or IP address of the SSH server.
     * @param port - The port number of the SSH server.
     * @param username - The username for authentication.
     * @param privateKey - The private key for authentication.
     * @param passphrase - The passphrase for the private key (optional).
     * @param callback - A callback function to handle the connection result (optional).
     *
     * @returns A Promise that resolves to an instance of SSHClient if the connection is successful.
     *          Otherwise, it rejects with an error.
     */
    static connectWithKey(host, port, username, privateKey, passphrase, optionsOrCallback, callback) {
        const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
        const connectionCallback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
        return new Promise((resolve, reject) => {
            const result = new SSHClient(host, port, username, { privateKey, passphrase }, options, (error, response) => {
                if (connectionCallback) {
                    connectionCallback(error, response);
                }
                if (error) {
                    return reject(error);
                }
                resolve(result);
            });
        });
    }
    /**
     * Connects to an SSH server using password authentication.
     *
     * @param host - The hostname or IP address of the SSH server.
     * @param port - The port number of the SSH server.
     * @param username - The username for authentication.
     * @param password - The password for authentication.
     * @param callback - Optional callback function to handle any errors during the connection process.
     * @returns A Promise that resolves to an instance of SSHClient if the connection is successful.
     * @throws If there is an error during the connection process.
     */
    static connectWithPassword(host, port, username, password, optionsOrCallback, callback) {
        const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
        const connectionCallback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
        return new Promise((resolve, reject) => {
            const result = new SSHClient(host, port, username, password, options, (error, response) => {
                if (connectionCallback) {
                    connectionCallback(error, response);
                }
                if (error) {
                    return reject(error);
                }
                resolve(result);
            });
        });
    }
    /**
     * Creates a new SSHClient instance.
     * Should not be called directly; use the `connectWithKey` or `connectWithPassword` factory functions instead.
     * @param host The hostname or IP address of the SSH server.
     * @param port The port number of the SSH server.
     * @param username The username for authentication.
     * @param passwordOrKey The password or private key for authentication.
     * @param callback The callback function to be called after the connection is established.
     */
    constructor(host, port, username, passwordOrKey, options, callback) {
        this._key = SSHClient.getRandomClientKey();
        this._listeners = {};
        this._counters = {
            download: 0,
            upload: 0,
        };
        this._activeStream = {
            sftp: false,
            shell: false,
        };
        this._handlers = {};
        this.host = host;
        this.port = port;
        this.username = username;
        this.connectionOptions = options;
        this.connect(passwordOrKey, options, callback);
    }
    /**
     * Generates a random client key, used to identify which callback match with which instance.
     *
     * @returns A string representing the random client key.
     */
    static getRandomClientKey() {
        // TODO This should be returned by the native code...
        // There's no need for actual randomness, just uniqueness.
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    /**
     * Handles a native event (callback).
     *
     * @param event The native event to handle.
     */
    handleEvent(event) {
        if (this._handlers[event.name] && this._key === event.key) {
            this._handlers[event.name](event.value);
        }
    }
    /**
     * Registers an event handler for the specified event.
     *
     * @param eventName - The name of the event.
     * @param handler - The event handler function.
     */
    on(eventName, handler) {
        this._handlers[eventName] = handler;
    }
    /**
     * Registers a native listener for the specified event name.
     *
     * @param eventName - The name of the event to listen for.
     */
    registerNativeListener(eventName) {
        const listenerInterface = Platform.OS === 'ios' ? RNSSHClientEmitter : DeviceEventEmitter;
        this._listeners[eventName] = listenerInterface.addListener(eventName, this.handleEvent.bind(this));
    }
    /**
     * Unregisters a native listener for the specified event name.
     * @param eventName - The name of the event.
     */
    unregisterNativeListener(eventName) {
        const listener = this._listeners[eventName];
        if (listener) {
            listener.remove();
            delete this._listeners[eventName];
        }
    }
    /**
     * Connects to the SSH server using the provided password or key.
     *
     * @param passwordOrKey - The password or key to authenticate with the server.
     * @param callback - The callback function to be called after the connection attempt.
     */
    connect(passwordOrKey, options, callback) {
        if (Platform.OS === 'android') {
            if (typeof passwordOrKey === 'string') {
                const nativeMethod = options ? RNSSHClient.connectToHostByPasswordWithOptions : RNSSHClient.connectToHostByPassword;
                const nativeCallback = (error, response) => {
                    if (!error && response) this.hostKeyInfo = response;
                    callback(error, response);
                };
                if (options) nativeMethod(this.host, this.port, this.username, passwordOrKey, options, this._key, nativeCallback);
                else nativeMethod(this.host, this.port, this.username, passwordOrKey, this._key, nativeCallback);
            }
            else {
                const nativeMethod = options ? RNSSHClient.connectToHostByKeyWithOptions : RNSSHClient.connectToHostByKey;
                const nativeCallback = (error, response) => {
                    if (!error && response) this.hostKeyInfo = response;
                    callback(error, response);
                };
                if (options) nativeMethod(this.host, this.port, this.username, passwordOrKey, options, this._key, nativeCallback);
                else nativeMethod(this.host, this.port, this.username, passwordOrKey, this._key, nativeCallback);
            }
            return;
        }
        // iOS...
        RNSSHClient.connectToHost(this.host, this.port, this.username, passwordOrKey, this._key, (error, response) => {
            if (!error && response) this.hostKeyInfo = response;
            callback(error, response);
        });
    }
    /**
     * Executes a command on the SSH server.
     * @param command The command to execute.
     * @param callback Optional callback function to handle the result asynchronously.
     * @returns A promise that resolves with the response from the server.
     */
    execute(command, callback) {
        return new Promise((resolve, reject) => {
            RNSSHClient.execute(command, this._key, (error, response) => {
                if (callback) {
                    callback(error, response);
                }
                if (error) {
                    return reject(error);
                }
                resolve(response);
            });
        });
    }
    /**
     * Starts a shell session on the SSH server.
     * @param ptyType - The type of pseudo-terminal to use for the shell session.
     * @param callback - Optional callback function to handle the response.
     * @returns A promise that resolves with the response from the server.
     */
    startShell(ptyType, optionsOrCallback, callback) {
        const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
        const shellCallback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
        if (this._activeStream.shell) {
            return Promise.resolve('');
        }
        return new Promise((resolve, reject) => {
            this.registerNativeListener(NATIVE_EVENT_SHELL);
            if (options?.rawOutput) this.registerNativeListener(NATIVE_EVENT_SHELL_RAW);
            const nativeCallback = (error, response) => {
                if (shellCallback) {
                    shellCallback(error, response);
                }
                if (error) {
                    return reject(error);
                }
                this._activeStream.shell = true;
                resolve(response);
            };
            if (options && RNSSHClient.startShellWithOptions) RNSSHClient.startShellWithOptions(this._key, ptyType, options, nativeCallback);
            else RNSSHClient.startShell(this._key, ptyType, nativeCallback);
        });
    }
    /**
     * Checks if the shell is active. If the shell is already active, it returns an empty string.
     * Otherwise, it starts a new shell and returns the result.
     * @param callback Optional callback function to handle errors.
     * @returns A promise that resolves to a string representing the result of the shell check.
     */
    checkShell(callback) {
        if (this._activeStream.shell) {
            return Promise.resolve('');
        }
        return this.startShell(PtyType.VANILLA)
            .then((res) => (res ? res + '\n' : ''))
            .catch((error) => {
            if (callback) {
                callback(error);
            }
            throw error;
        });
    }
    /**
     * Writes a command to the shell.
     * @param command - The command to write to the shell.
     * @param callback - Optional callback function to handle the response.
     * @returns A promise that resolves with the response from the shell.
     */
    writeToShell(command, callback) {
        return this.checkShell(callback)
            .then(() => new Promise((resolve, reject) => {
            RNSSHClient.writeToShell(command, this._key, (error, response) => {
                if (callback) {
                    callback(error, response);
                }
                if (error) {
                    return reject(error);
                }
                resolve(response);
            });
        }));
    }
    /**
     * Closes the SSH shell.
     */
    closeShell() {
        this.unregisterNativeListener(NATIVE_EVENT_SHELL);
        this.unregisterNativeListener(NATIVE_EVENT_SHELL_RAW);
        // TODO this should use a callback too
        RNSSHClient.closeShell(this._key);
        this._activeStream.shell = false;
    }

    setPtySize(cols, rows, widthPx = 0, heightPx = 0) {
        if (RNSSHClient.setPtySize) {
            RNSSHClient.setPtySize(this._key, cols, rows, widthPx, heightPx);
        }
    }
    /**
     * Connects to the SFTP server.
     *
     * It is not mandatory to call this method before calling any SFTP method.
     * @param callback - Optional callback function to be called after the connection is established.
     * @returns A promise that resolves when the connection is established successfully, or rejects with an error if the connection fails.
     */
    connectSFTP(callback) {
        if (this._activeStream.sftp) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            RNSSHClient.connectSFTP(this._key, (error) => {
                this._activeStream.sftp = true;
                this.registerNativeListener(NATIVE_EVENT_DOWNLOAD_PROGRESS);
                this.registerNativeListener(NATIVE_EVENT_UPLOAD_PROGRESS);
                if (callback) {
                    callback(error);
                }
                if (error) {
                    return reject(error);
                }
                resolve();
            });
        });
    }
    /**
     * Checks if SFTP is active. If not, it connects to SFTP.
     * @param callback - Optional callback function to handle errors.
     * @returns A promise that resolves when SFTP is active or rejects with an error.
     */
    checkSFTP(callback) {
        if (this._activeStream.sftp) {
            return Promise.resolve();
        }
        return this.connectSFTP()
            .catch((error) => {
            if (callback) {
                callback(error);
            }
            throw error;
        });
    }
    /**
     * Lists the files and directories in the specified path using SFTP.
     * @param path - The path to list.
     * @param callback - Optional callback function to handle the result asynchronously.
     * @returns A promise that resolves to the result of the SFTP listing operation.
     */
    sftpLs(path, callback) {
        return this.checkSFTP(callback)
            .then(() => new Promise((resolve, reject) => {
            RNSSHClient.sftpLs(path, this._key, (error, _response) => {
                const response = _response ? _response.map(p => {
                    // eslint-disable-next-line no-control-regex -- Control characters are removed from the response, because they can make JSON.parse fail
                    return JSON.parse(p.replace(/[\u0000-\u001F]/g, ''));
                }) : undefined;
                if (callback) {
                    callback(error, response);
                }
                if (error) {
                    return reject(error);
                }
                resolve(response);
            });
        }));
    }
    /**
     * Renames a file or directory on the remote server using SFTP.
     * @param oldPath The current path of the file or directory.
     * @param newPath The new path to rename the file or directory to.
     * @param callback An optional callback function to handle the result or error.
     * @returns A Promise that resolves when the file or directory is successfully renamed.
     */
    sftpRename(oldPath, newPath, callback) {
        return this.checkSFTP(callback)
            .then(() => new Promise((resolve, reject) => {
            RNSSHClient.sftpRename(oldPath, newPath, this._key, (error) => {
                if (callback) {
                    callback(error);
                }
                if (error) {
                    return reject(error);
                }
                resolve();
            });
        }));
    }
    /**
     * Creates a directory on the remote server using SFTP.
     * @param path - The path of the directory to create.
     * @param callback - An optional callback function to handle the result.
     * @returns A promise that resolves when the directory is created successfully.
     */
    sftpMkdir(path, callback) {
        return this.checkSFTP(callback)
            .then(() => new Promise((resolve, reject) => {
            RNSSHClient.sftpMkdir(path, this._key, (error) => {
                if (callback) {
                    callback(error);
                }
                if (error) {
                    return reject(error);
                }
                resolve();
            });
        }));
    }
    /**
     * Removes (unlinks) a file from the remote server using SFTP.
     * @param path - The path of the file to remove.
     * @param callback - An optional callback function to handle the result or error.
     * @returns A promise that resolves when the file is successfully removed.
     */
    sftpRm(path, callback) {
        return this.checkSFTP(callback)
            .then(() => new Promise((resolve, reject) => {
            RNSSHClient.sftpRm(path, this._key, (error) => {
                if (callback) {
                    callback(error);
                }
                if (error) {
                    return reject(error);
                }
                resolve();
            });
        }));
    }
    /**
     * Removes a directory on the remote server using SFTP.
     * @param path - The path of the directory to remove.
     * @param callback - Optional callback function to handle the result or error.
     * @returns A promise that resolves when the directory is successfully removed.
     */
    sftpRmdir(path, callback) {
        return this.checkSFTP(callback)
            .then(() => new Promise((resolve, reject) => {
            RNSSHClient.sftpRmdir(path, this._key, (error) => {
                if (callback) {
                    callback(error);
                }
                if (error) {
                    return reject(error);
                }
                resolve();
            });
        }));
    }
    /**
     * Changes the permissions of a file or directory on the remote server using SFTP.
     *
     * Only available on Android.
     * @param path - The path of the file or directory.
     * @param permissions - The new permissions to set.
     * @param callback - An optional callback function to handle the result or error.
     * @returns A Promise that resolves when the permissions are successfully changed.
     */
    sftpChmod(path, permissions, callback) {
        return this.checkSFTP(callback)
            .then(() => new Promise((resolve, reject) => {
            RNSSHClient.sftpChmod(path, permissions, this._key, (error) => {
                if (callback) {
                    callback(error);
                }
                if (error) {
                    return reject(error);
                }
                resolve();
            });
        }));
    }
    /**
     * Uploads a file from the local file system to the remote file system using SFTP.
     * @param localFilePath - The path of the file on the local file system.
     * @param remoteFilePath - The path of the file on the remote file system.
     * @param callback - An optional callback function to be called after the upload is complete or an error occurs.
     * @returns A Promise that resolves when the upload is complete or rejects with an error.
     */
    sftpUpload(localFilePath, remoteFilePath, callback) {
        return this.checkSFTP(callback)
            .then(() => new Promise((resolve, reject) => {
            ++this._counters.upload;
            RNSSHClient.sftpUpload(localFilePath, remoteFilePath, this._key, (error) => {
                --this._counters.upload;
                if (callback) {
                    callback(error);
                }
                if (error) {
                    return reject(error);
                }
                resolve();
            });
        }));
    }
    /**
     * Cancels the ongoing SFTP upload.
     */
    sftpCancelUpload() {
        if (this._counters.upload > 0) {
            RNSSHClient.sftpCancelUpload(this._key);
        }
    }
    /**
     * Downloads a file from the remote server using SFTP.
     * @param remoteFilePath - The path of the file on the remote server.
     * @param localFilePath - The path where the file will be saved locally.
     * @param callback - An optional callback function to handle the result of the download.
     * @returns A promise that resolves with the response string when the download is complete.
     */
    sftpDownload(remoteFilePath, localFilePath, callback) {
        return this.checkSFTP(callback)
            .then(() => new Promise((resolve, reject) => {
            ++this._counters.download;
            RNSSHClient.sftpDownload(remoteFilePath, localFilePath, this._key, (error, response) => {
                --this._counters.download;
                if (callback) {
                    callback(error, response);
                }
                if (error) {
                    return reject(error);
                }
                resolve(response);
            });
        }));
    }
    /**
     * Cancels the ongoing SFTP download operation.
     */
    sftpCancelDownload() {
        if (this._counters.download > 0) {
            RNSSHClient.sftpCancelDownload(this._key);
        }
    }
    /**
     * Disconnects the SFTP connection.
     *
     * @remarks
     * This method requires a fix in the native part. However, it still works since the native code's `disconnect()` method will actually close the SFTP stream. The only downside is that we can't explicitly close the SFTP channel.
     *
     * @example
     * ```typescript
     * disconnectSFTP();
     * ```
     */
    disconnectSFTP() {
        // TODO This require a fix in the native part. I don't care.
        // It actually still work since the native code disconnect() will actually
        // close the sftp stream.
        // Only downside is we can't *explicitly* close the sftp channel.
        if (Platform.OS !== 'ios') {
            this.unregisterNativeListener(NATIVE_EVENT_DOWNLOAD_PROGRESS);
            this.unregisterNativeListener(NATIVE_EVENT_UPLOAD_PROGRESS);
            RNSSHClient.disconnectSFTP(this._key);
            this._activeStream.sftp = false;
        }
    }
    /**
     * Disconnects the SSH client.
     * If a shell is active, it will be closed.
     * If an SFTP connection is active, it will be disconnected.
     * @returns void
     */
    disconnect() {
        if (this._activeStream.shell) {
            this.closeShell();
        }
        if (this._activeStream.sftp) {
            this.disconnectSFTP();
        }
        // TODO this should use a callback too
        RNSSHClient.disconnect(this._key);
    }
}
//# sourceMappingURL=sshclient.js.map