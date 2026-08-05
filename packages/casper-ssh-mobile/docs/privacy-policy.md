# Casper Roaming Ghost SSH Privacy Policy

**Effective date:** 2026-08-04

Casper Roaming Ghost SSH is a direct-device SSH client. The app does not
operate a telemetry service or collect an account profile.

## Information stored on the device

- Host profiles are stored in the app's local storage.
- Passwords, private keys, and passphrases are stored only when the user
  explicitly opts in, using the operating system's secure keystore through
  Expo SecureStore.
- SSH `known_hosts` entries and trusted-host metadata are stored in the app's
  private document directory.
- Downloaded files remain in the app's private document directory until the
  user opens, shares, or deletes them.

## Information sent over the network

The app sends the connection details and credentials necessary to establish
an SSH/SFTP connection to the SSH host selected by the user. Interactive shell
input, commands, file transfers, and their results travel between the device
and that selected host. The app does not send this information to Blood Sweat
Code, Casper, or an analytics provider.

## Permissions

The Android build requests only `INTERNET`. The app does not request contacts,
location, microphone, camera, advertising ID, or background location access.

## Security

On Android, the app verifies SSH host keys using an OpenSSH-format `known_hosts`
file and supports SHA256 fingerprint pinning and trust-on-first-use. On iOS,
the bundled NMSSH API does not expose the SHA256 host-key material required for
the same protocol; the app labels that capability unavailable rather than
claiming verification.

## Your choices

Users can delete saved host profiles, secure credentials, trusted host keys,
and downloaded files from the app. Users can also choose not to save
credentials.

## Contact

For privacy questions, contact Blood Sweat Code through the support channel
listed on the app's current store page.
