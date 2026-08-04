# Casper Roaming Ghost SSH (mobile)

A standalone Android SSH client for the Blood Sweat Code / Casper ecosystem. Connect to any SSH host with password or PEM private-key authentication, run commands, start an interactive shell, or browse remote directories over SFTP.

## Stack

- Expo + React Native
- `@dylankenneally/react-native-ssh-sftp` for SSH/SFTP native operations

## Features

- Password and private-key SSH auth (with optional passphrase)
- One-shot command execution
- Interactive XTERM shell session
- SFTP browsing, upload, download, rename, delete, and directory creation
- Secure-store-backed saved host profiles with opt-in credential persistence
- Explicit per-host unverified-host acknowledgement
- Casper cyberpunk dark UI
- Android package: `org.bloodsweatcode.casperssh`

## Development

```bash
cd packages/casper-ssh-mobile
npm install
npm run start
```

Use an Expo development build or `expo run:android` (requires Android SDK). The native SSH library does not run in Expo Go because it includes native code.

## Build APK

With EAS (cloud build):

```bash
npm install -g eas-cli
eas build --platform android --profile production
```

With a local Android SDK:

```bash
npm run build:apk
```

## Security note

The underlying `@dylankenneally/react-native-ssh-sftp` library does not verify remote server host keys: it disables `StrictHostKeyChecking` on Android and does not pin host keys on iOS. The app never fakes a fingerprint or claims cryptographic verification. On first connection to each host and port, it requires an explicit acknowledgement and permanently labels the active connection **UNVERIFIED** until a transport with real host-key support is added.

Saved host metadata is stored in AsyncStorage. Secrets are only written to Expo SecureStore when **SAVE CREDENTIALS** is enabled; disabling it or deleting a host clears the SecureStore entry. Credentials are never logged. If credentials are not saved, they remain in the current screen/session memory only.

The current native library also line-buffers Android shell output, so the terminal provides ANSI SGR styling and control-key input but cannot provide full raw-byte terminal fidelity, resize/window-change support, or host-key prompts yet.

## Usage

1. Enter host, port, username, and choose **Password** or **Private Key**.
2. Tap **CONNECT**.
3. Use **START SHELL** for an interactive session, **EXECUTE** for one-shot commands, or **SFTP LS** to list a remote path.
