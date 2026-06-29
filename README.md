# Local File Locker

Local File Locker is an encrypted file manager that runs entirely within your browser. Files are encrypted on your device and stored using the browser's Origin Private File System. Encryption is performed using symmetric encryption (AES-GCM mode), and the process is executed via WASM.

This app is intended for hobby use, and the author assumes no responsibility for any damages resulting from its use.

You can access this app at https://sogo.dev/local-file-locker/

## Development

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) with the `wasm32-unknown-unknown` target
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/)

### Building the WASM crypto module

The WASM module must be built before running the Next.js app.

```bash
cd wasm-crypto
wasm-pack build --target web
```

This generates `wasm-crypto/pkg/`, which is imported by the Next.js app.

If you haven't installed the `wasm32-unknown-unknown` target yet, run:

```bash
rustup target add wasm32-unknown-unknown
```

### Running locally

```bash
pnpm install
pnpm dev
```

## Security maintenance policy (minimum)

- Dependency vulnerabilities are triaged with this baseline:
  - Critical: must be kept at 0
  - High: evaluated case-by-case based on real impact under this app's static export (`output: "export"`) and static hosting model
- Keep `next` and `eslint-config-next` up to date within the same major line unless a major upgrade is required for security reasons.
- Automated dependency update PRs are enabled via Dependabot (npm and GitHub Actions).
