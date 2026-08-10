# Upgrading the CodeForAfrica dub fork from upstream

## Background

This repo (`CodeForAfrica/dub`) is a fork of `dubinc/dub`. Dub has no semver
tags or GitHub releases — it ships continuously off `main`. So there is no
"version number" to bump; "upgrading" means merging upstream's `main` into
ours.

The fork has **no custom application code** — only 3 dependabot security
bumps (`yaml`, `lodash`, `fast-xml-parser`). Confirmed via:

```bash
gh api repos/CodeForAfrica/dub/compare/dubinc:main...CodeForAfrica:main --jq '.commits[]'
grep -ril "codeforafrica" apps/web/app apps/web/lib   # no hits
```

This means syncing is low-risk: there's no branding/config layer that can
get clobbered, just dependency-version reconciliation.

## 2026-07-13 sync

| | |
|---|---|
| Fork point | `499ce6599` — 2025-11-13 |
| Old `main` | `ab8ac0e8e0` |
| `upstream/main` | `7f9920b082` |
| Commits behind | 2,903 |
| Merge commit (local branch `sync-upstream-2026-07-13`) | `4d5c6b4f25` |

This was done **entirely locally** — nothing was pushed to `origin` or
`upstream`. `main` was left untouched; the merge lives on branch
`sync-upstream-2026-07-13` until someone reviews and decides to push/PR it.

## Procedure

```bash
# 1. This clone was shallow (depth 1) and sparse (only root files +
#    packages/tinybird/ checked out) — both need to go before a real
#    merge/build is possible.
git fetch --unshallow origin
git sparse-checkout disable

# 2. Get upstream history and branch off main.
git fetch upstream main
git checkout -b sync-upstream-<date> main
git merge upstream/main --no-edit
```

### Conflicts (only 2 files, both expected)

- **`apps/web/package.json`** — conflicted only on the 3 packages CFA had
  bumped via dependabot (`date-fns`, `dub`, `fast-xml-parser` region).
  Resolution rule used: **take upstream's version for anything CFA didn't
  touch on purpose; keep CFA's version where it was a deliberate security
  bump and it's newer than upstream's.** Concretely: took upstream's
  `date-fns` (^4.1.0) and `dub` (^0.72.0) bumps, kept CFA's
  `fast-xml-parser` (^5.7.0) since it's newer than upstream's ^5.0.6.
- **`pnpm-lock.yaml`** — generated file, don't hand-resolve. Took upstream's
  version wholesale and regenerated:

  ```bash
  git checkout --theirs pnpm-lock.yaml
  git add apps/web/package.json pnpm-lock.yaml
  pnpm install --no-frozen-lockfile
  git add -A && git commit --no-edit
  ```

## Validation performed (no DB/secrets available locally)

Full `next build` needs a live database and ~30 secrets, so it wasn't run.
Instead, the checks that don't need runtime infra:

```bash
pnpm install                                          # workspace deps resolve
pnpm --filter web prisma:generate                     # schema is structurally valid
pnpm turbo build --filter=@dub/utils --filter=@dub/ui --filter=@dub/embed-react
cd apps/web && npx tsc --noEmit -p tsconfig.json       # 0 errors
```

Result: **0 TypeScript errors** across all of `apps/web` after building the
workspace packages it depends on. This is the strongest signal available
without live infra that the merge integrated cleanly.

`next lint` was not usable — there's no ESLint config in `apps/web` on
either branch, so this is a pre-existing gap, not something the merge broke.

## Full local run (with a real DB) — 2026-07-13

The static checks above don't prove the app actually boots and serves
pages, so this was also run for real, entirely locally, no external
accounts needed for the core flow. Setup followed the standard local dev
guide — see [README.md § Contributing](../README.md#contributing) and
[dub.co/docs/local-development](https://dub.co/docs/local-development)
(docker-compose MySQL/Mailhog, `.env` from `.env.example`, generated
`NEXTAUTH_SECRET`/`CRON_SECRET`/`ENCRYPTION_KEY`, `prisma:push`, then
[the dev seed script](../README.md#dev-seed-script)) — nothing
sync-specific about that part.

Result: server boots (`✓ Ready in ~3s` on `http://localhost:8888`),
`/login` renders, and a full NextAuth credentials login
(`owner@dub-internal-test.com` / `password`) returns a real session and
loads the `/acme/links` dashboard (HTTP 200, no error page). Confirms the
merge works at runtime against a real database, not just at the type level.

**Left unconfigured** (`TINYBIRD_API_KEY`, `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN`, `QSTASH_*`, `RESEND_API_KEY`) — these need free
external accounts (tinybird.co, upstash.com) and weren't needed to validate
the merge. They fail lazily at request time (logged, not thrown), so login
and the dashboard load fine without them; analytics charts and
redis-cached paths will error if exercised. Fill these in if testing those
features specifically.

### Seeded login credentials (local only)

Workspace slug: `acme`. All passwords: `password`.

| Email | Role |
|---|---|
| `owner@dub-internal-test.com` | owner |
| `member@dub-internal-test.com` | member |
| `viewer@dub-internal-test.com` | viewer |
| `billing@dub-internal-test.com` | billing |
| `partner1@dub-internal-test.com` … `partner5@…` | partner |

### No version indicator in the UI

Checked — dub has no footer/about page/`/api/version` endpoint showing
build info, consistent with there being no version concept at all. The
only way to know what's deployed is git (`git log -1`, or diffing against
`upstream/main` as done above). Adding a small footer/admin page with the
git SHA + last-sync date would make this discoverable without shelling in
— flagged as a follow-up, not done as part of this sync.

## What production needs before/after deploying this

### New required env vars (diffed `.env.example`, old vs merged)

```
AXIOM_DATASET                  DYNADOT_COUPON              PLAIN_API_KEY
AXIOM_TOKEN                    E2E_PARTNER_EMAIL           PLAIN_WEBHOOK_SECRET
DUB_SLACK_ASSISTANT_BOT_TOKEN  E2E_PARTNER_PASSWORD        PLANETSCALE_SERVICE_TOKEN
ENCRYPTION_KEY                 INTERCOM_CLIENT_ID          QSTASH_URL
RESEND_WEBHOOK_SECRET          INTERCOM_CLIENT_SECRET      SCRAPECREATORS_API_KEY
STRIPE_APP_SECRET_KEY_SANDBOX  STRIPE_CONNECT_V2_WEBHOOK_SECRET
STRIPE_CONNECT_WEBHOOK_SECRET  TREMENDOUS_API_KEY          TWITTER_CLIENT_ID
TWITTER_CLIENT_SECRET          UNSUBSCRIBE_TOKEN_SECRET    UPSTASH_VECTOR_REST_TOKEN
UPSTASH_VECTOR_REST_URL        VERCEL_API_KEY              VERIFF_API_KEY
VERIFF_SHARED_SECRET           YOUTUBE_API_KEY
```

`ENCRYPTION_KEY` in particular looks load-bearing (AES-256-GCM encryption of
sensitive DB fields per `.env.example` comment) — treat as required, not
optional, before deploying.

Vars removed/renamed upstream (safe to leave stale in prod, but clean up
eventually): `AUTH_BEARER_TOKEN`, `NEXT_PUBLIC_APP_DOMAIN`,
`NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_SHORT_DOMAIN`, `NEXT_PUBLIC_IS_DUB`,
`PROJECT_ID_VERCEL`, `SINGULAR_WEBHOOK_TOKEN`, `X_CLIENT_ID`,
`X_CLIENT_SECRET`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`.

### Database

No Prisma migration files in this repo — schema changes are applied with
`prisma db push` (see `apps/web/package.json`'s `prisma:push` script), not
tracked migrations. Nearly every schema file changed. Run `prisma:push`
against a staging DB copy first and diff the generated SQL before touching
production data.

### `apps/web/vercel.json`

Cron job list changed substantially — several old cron endpoints were
removed and ~10 new ones added (webhooks, bounties, sitemaps, etc.), and
`maxDuration` for cron functions went 300s → 600s. Vercel picks this up
automatically on deploy, but confirm the plan's cron limits/frequency are
still satisfied.

### Tooling

`packageManager` pin moved `pnpm@8.6.10` → `pnpm@9.15.9`. Any CI/deploy
image pinning pnpm explicitly needs to match.

## Rollback

The merge is isolated to branch `sync-upstream-2026-07-13`; `main` was never
touched. To discard: `git branch -D sync-upstream-2026-07-13`. To ship it:
review the branch, open a PR into `main` the normal way, deploy to a preview
environment with the new env vars set, and validate against a staging DB
before promoting to production.
