# HCS dependency review

Reviewed: 2026-09-01

All direct dependencies are exact versions and are installed with `--ignore-scripts`. Registry metadata and the generated lockfile are reviewed before use.

| Package | Version | Purpose | License | Source | Install lifecycle finding |
| --- | ---: | --- | --- | --- | --- |
| `fastify` | 5.12.1 | HTTP server and streaming response lifecycle | MIT | `fastify/fastify` | No `install` or `postinstall` script |
| `pg` | 8.23.0 | PostgreSQL pool, transactions and migrations | MIT | `brianc/node-postgres` | No `install` or `postinstall` script |
| `jose` | 6.2.10 | JWT signing and verification | MIT | `panva/jose` | No lifecycle script reported by the registry |
| `typebox` | 1.3.24 | Runtime schema construction and checking | MIT | `sinclairzx81/typebox` | No lifecycle script reported by the registry |
| `hash-wasm` | 4.12.0 | Argon2id password hashing through packaged WASM | MIT | `Daninet/hash-wasm` | Build and `prepublishOnly` exist upstream; no consumer `install`/`postinstall`, native compilation, or downloaded binary step |
| `vitest` | 4.1.11 | Unit and integration tests | MIT | `vitest-dev/vitest` | No consumer install script in the direct package |
| `typescript` | 5.9.3 | Reproducible server compilation | Apache-2.0 | `microsoft/TypeScript` | No consumer install script |
| `@types/node` | 24.12.4 | Node type declarations aligned with this repository | MIT | `DefinitelyTyped/DefinitelyTyped` | No lifecycle script |
| `@types/pg` | 8.23.1 | PostgreSQL type declarations | MIT | `DefinitelyTyped/DefinitelyTyped` | No lifecycle script |

`hash-wasm` is selected instead of a native Argon2 addon so `npm ci --ignore-scripts` remains functional on Linux. S0 verifies an Argon2id hash/verify round trip after a clean ignored-script install. The lockfile review records any transitive package marked with `hasInstallScript`; such scripts remain disabled in development and CI.

Lockfile result: only optional macOS watcher package `fsevents@2.3.3` is marked `hasInstallScript`; it is not installed on Linux and all lifecycle execution remains disabled. A post-install Argon2id encoded-hash/verify round trip passed with `hash-wasm@4.12.0` after `npm ci --ignore-scripts`.
