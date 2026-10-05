# pick·pdf

Share a file behind a password. The first person to unlock it gets the file, and then it's deleted.

- **End-to-end encrypted.** Files are encrypted in the browser (AES-256-GCM, key from PBKDF2-SHA256 with 600k iterations). The server never sees the password, the file name or the contents.
- **Burn after reading.** A successful unlock deletes the file. Five wrong passwords also delete it, and so does the expiry you pick (1 hour, 1 day or 7 days).
- **Exactly once.** Each file has its own Durable Object, so two people unlocking at the same moment can't both get it.

Runs on Cloudflare Workers with R2 for the encrypted blobs and SQLite-backed Durable Objects for metadata.

## How it works

```
browser                                     worker                 storage
───────                                     ──────                 ───────
password + random salt
  └─ PBKDF2 → 64 bytes
       ├─ [0..32]  AES-GCM key  → encrypt(name, type, bytes)
       └─ [32..64] auth key → SHA-256 = authHash
POST /api/files  (ciphertext, salt, authHash, expiry) ──▶ R2.put(blob)
                                                         FileVault.create()  (alarm = expiry)

GET  /api/files/:id                                   ──▶ { salt, size, expiresAt, attemptsLeft }
POST /api/files/:id/claim { authKey }                 ──▶ FileVault.claim()
                                                           ├─ match  → mark claimed, stream blob, delete from R2
                                                           └─ no match → attempts++ (5th → destroy)
decrypt in browser → download
```

The server only stores `SHA-256(authKey)`. Offline guessing still costs one full PBKDF2 per guess, and online guessing is capped at 5 tries.

## Tooling

Everything is configured in one [`vite.config.ts`](./vite.config.ts) through [Vite+](https://viteplus.dev):

| Command            | What it does                                                          |
| ------------------ | --------------------------------------------------------------------- |
| `vp install`       | Install dependencies                                                  |
| `vp dev`           | Local dev server (Worker runs in workerd with local R2 + DO)          |
| `vp check`         | Oxfmt formatting, Oxlint (type-aware) and TypeScript checks           |
| `vp check --fix`   | Same, with auto-fix                                                   |
| `vp test`          | Unit tests and e2e tests                                              |
| `vp run test:unit` | Unit tests only (crypto, encoding, formatting)                        |
| `vp run test:e2e`  | Builds, serves the production bundle and drives it with Playwright    |
| `vp run ci`        | `vp check` then `vp test`                                             |
| `vp run typegen`   | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |
| `vp run deploy`    | Build and deploy to Cloudflare                                        |

The e2e tests need Chromium once: `vp exec playwright install chromium`.

## Deploy

```sh
vp exec wrangler login
vp exec wrangler r2 bucket create pick-pdf-files
vp run deploy
```

Recommended: add an R2 lifecycle rule that deletes objects older than 8 days. It's a safety net in case a Worker crashes mid-download and leaves a blob behind. The Durable Object alarm normally handles this.

## Limits

- 50 MB per file (Workers request bodies are capped at 100 MB, and the file is encrypted in memory).
- The share link and password should go through different channels. Anyone holding both can claim the file.
