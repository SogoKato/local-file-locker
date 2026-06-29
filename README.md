# Local File Locker

Local File Locker is an encrypted file manager that runs entirely within your browser. Files are encrypted on your device and stored using the browser's Origin Private File System. Encryption is performed using symmetric encryption (AES-GCM mode), and the process is executed via WASM.

This app is intended for hobby use, and the author assumes no responsibility for any damages resulting from its use.

You can access this app at https://sogo.dev/local-file-locker/

## Security maintenance policy (minimum)

- Dependency vulnerabilities are triaged with this baseline:
  - Critical: must be kept at 0
  - High: evaluated case-by-case based on real impact under this app's static export (`output: "export"`) and static hosting model
- Keep `next` and `eslint-config-next` up to date within the same major line unless a major upgrade is required for security reasons.
- Automated dependency update PRs are enabled via Dependabot (npm and GitHub Actions).
