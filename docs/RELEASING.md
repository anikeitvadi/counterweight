# Releasing

## How a release happens

1. Bump `version` in `package.json`, add the notes to `CHANGELOG.md`, commit.
2. Tag and push: `git tag v0.3.0 && git push origin main --tags`.
3. The **Release** workflow builds on a Windows runner (NSIS installer + zip) and a macOS runner (arm64 + x64
   dmg), and attaches everything to the GitHub release for that tag together with the update manifests
   (`latest.yml`, `latest-mac.yml`).
4. Installed apps check GitHub every six hours (and on Help → Check for updates…), download in the background,
   and install on the next restart. Windows updates work today; macOS updates need a signed build (see below).

A push to `main` deploys the web app to Vercel on its own; no step is needed for that.

## What the user downloads

- **Windows:** `Counterweight-Setup-<version>.exe` (one-click, per-user, no admin prompt). The zip is still
  attached for anyone who prefers a portable copy, but only the installer receives automatic updates.
- **macOS:** `Counterweight-<version>-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel).

## Signing (turns off the SmartScreen and Gatekeeper prompts)

The workflow signs automatically when these repository secrets exist; nothing else changes.

**Windows.** Either a code-signing certificate exported as a password-protected `.pfx` (an OV certificate from
Sectigo, DigiCert, SSL.com and the like; EV certificates sit on hardware tokens and do not fit CI), stored as
`CSC_LINK` (the file base64-encoded) and `CSC_KEY_PASSWORD`; or Azure Trusted Signing, which is cheaper and
cloud-based (set `win.azureSignOptions` in `package.json` and the `AZURE_*` secrets, see electron-builder's
docs). SmartScreen reputation still builds over the first downloads even with a valid signature.

**macOS.** An Apple Developer Program membership. Export the "Developer ID Application" certificate as a `.p12`
into `CSC_LINK` / `CSC_KEY_PASSWORD`, and add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` so the
build is notarised. Hardened runtime and entitlements are already configured in `package.json` and
`build/entitlements.mac.plist`.

## Local builds

`npm run dist:win` produces only the zip on this Mac (NSIS needs an Intel toolchain), `npm run dist:mac` the two dmgs.
Neither publishes; they are for checking a build by hand. `COUNTERWEIGHT_SHOT=/tmp/shot.png npx electron .` takes a
screenshot of the running shell and quits.
