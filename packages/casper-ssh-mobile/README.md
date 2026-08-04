# Casper Roaming Ghost SSH (mobile)

A standalone Android SSH client for the Blood Sweat Code / Casper ecosystem. Connect to any SSH host with password or PEM private-key authentication, run commands, start an interactive shell, or browse remote directories over SFTP.

## Stack

- Expo + React Native
- `@bloodsweatcode/react-native-ssh-sftp-bsc` for SSH/SFTP native operations

## Features

- Password and private-key SSH auth (with optional passphrase)
- One-shot command execution
- Interactive XTERM shell session
- SFTP browsing, upload, download, rename, delete, and directory creation
- Secure-store-backed saved host profiles with opt-in credential persistence
- Android SHA256 host-key verification with OpenSSH `known_hosts` trust-on-first-use
- Changed-key blocking and saved trusted-host management
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

The app-owned native fork verifies remote server host keys on Android using an
OpenSSH-format `known_hosts` file in the app documents directory. Unknown keys
are shown with their actual key type and SHA256 fingerprint before they can be
accepted and appended. A changed key is blocked and requires explicit deletion
of the saved key before re-trusting.

NMSSH on iOS does not expose the SHA256 host-key material needed to implement
the same protocol, so the iOS transport capability remains honestly disabled;
the app does not fabricate fingerprints or claim cryptographic verification.

Saved host metadata is stored in AsyncStorage. Secrets are only written to Expo SecureStore when **SAVE CREDENTIALS** is enabled; disabling it or deleting a host clears the SecureStore entry. Credentials are never logged. If credentials are not saved, they remain in the current screen/session memory only.

Android shell output can use opt-in raw base64 byte events and PTY resize.
iOS remains limited to NMSSH string shell events.

## Usage

1. Enter host, port, username, and choose **Password** or **Private Key**.
2. Tap **CONNECT**.
3. Use **START SHELL** for an interactive session, **EXECUTE** for one-shot commands, or **SFTP LS** to list a remote path.
