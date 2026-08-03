# Casper Roaming Ghost SSH (mobile)

A standalone Android SSH client for the Blood Sweat Code / Casper ecosystem. Connect to any SSH host with password or PEM private-key authentication, run commands, start an interactive shell, or browse remote directories over SFTP.

## Stack

- Expo + React Native
- `@dylankenneally/react-native-ssh-sftp` for SSH/SFTP native operations

## Features

- Password and private-key SSH auth (with optional passphrase)
- One-shot command execution
- Interactive XTERM shell session
- SFTP directory listing
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

The underlying `@dylankenneally/react-native-ssh-sftp` library does not yet verify remote server host keys (it disables `StrictHostKeyChecking` on Android and does not pin host keys on iOS). Treat connections as safe only on trusted networks, and prefer key-based authentication over passwords where possible. Credentials are held in memory only while the app is connected and are not persisted to disk.

## Usage

1. Enter host, port, username, and choose **Password** or **Private Key**.
2. Tap **CONNECT**.
3. Use **START SHELL** for an interactive session, **EXECUTE** for one-shot commands, or **SFTP LS** to list a remote path.
