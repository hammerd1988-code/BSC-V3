# Google Play Store Listing Draft

## Short description

Secure, direct-device SSH and SFTP with host-key trust and a mobile terminal.

## Full description

Casper Roaming Ghost SSH gives you a focused SSH and SFTP client for connecting
directly from your phone to the servers you choose.

- Password and private-key authentication
- Android OpenSSH `known_hosts` verification
- SHA256 fingerprints and trust-on-first-use prompts
- Changed-host-key blocking
- Interactive terminal with ANSI styling and mobile key controls
- SFTP browsing, uploads, downloads, rename, delete, and folders
- Saved hosts with optional OS-keystore credential storage
- Trusted-host management and local download storage

The app has no telemetry and does not route your SSH traffic through Blood
Sweat Code. Network traffic goes to the SSH host you select.

## Data Safety answers

These answers must be checked against the final Play Console forms:

- **Does the app collect data?** No, the app does not collect data for
  developer-owned telemetry or advertising.
- **Does the app share data with third parties?** No.
- **Is data processed ephemerally?** SSH commands, terminal data, and file
  transfers are processed to provide the requested connection; they are not
  sent to a Blood Sweat Code analytics service.
- **Is data encrypted in transit?** Yes, when the selected SSH connection is
  successfully negotiated.
- **Is data encrypted at rest?** Credentials saved by the user use the
  platform secure keystore. Other local app data uses app-private storage.
- **Data types:** The app can handle user-provided credentials, files, host
  addresses, and shell commands solely to provide the SSH/SFTP feature.

The publisher must validate these answers against Google's current
questionnaire and the final implementation before submitting.

## Content rating notes

The app is a networking/productivity utility. It has no social feed, gambling,
sexual content, realistic violence, alcohol, tobacco, or user-generated
public content. The SSH capability can be used for many purposes, so the
publisher should answer the questionnaire based on the utility's actual
features rather than implying that the app controls remote systems.

## Release and signing checklist

- Create or link the EAS project and replace any placeholder project metadata.
- Configure Google Play App Signing in Play Console.
- Use EAS-managed credentials or upload an existing keystore through EAS.
- Do not commit a keystore, signing key, password, or service-account secret.
- Complete the privacy-policy URL, app access instructions, target audience,
  content rating, Data Safety form, screenshots, icon, and store contact
  details in Play Console.
- Submit the production profile as an Android App Bundle (`.aab`), not the
  internal preview APK.
