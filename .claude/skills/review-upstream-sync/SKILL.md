---
name: review-upstream-sync
description: Review an automated upstream-sync PR (dubinc/dub -> CodeForAfrica/dub, branch automation/sync-upstream-main-staging) before it merges into main-staging. Reports what upstream introduced, what CFA customizations it drops, schema/env/dependency/workflow risks, and whether it is safe for staging and production. Use when asked to review the sync PR, the automated PR, the weekly upstream sync, or "is the sync PR safe to merge".
---

# Review an upstream-sync PR

The weekly sync bot merges `dubinc/dub` `main` into a branch off `main-staging`.
**When upstream conflicts with fork code, the bot resets the whole tree to
upstream's**, which silently drops CFA customizations even in files that did
not conflict. Assume every sync PR may be missing CFA code until proven otherwise.

## 1. Gather facts

From the repo root (needs `gh` auth and `pnpm install` done):

```bash
REVIEW_DATABASE_URL='<PlanetScale TEST branch URL>' \
  bash .claude/skills/review-upstream-sync/scripts/review.sh [PR_NUMBER]
```

- No PR number: reviews the open PR from `automation/sync-upstream-main-staging`.
- `--base <ref>` re-reviews an old PR against the base it had at the time.
- `REVIEW_DATABASE_URL` must be a **test** branch. Ask the user for it if unset;
  never use a production URL. Without it the schema section is skipped.
- The script is read-only. It fetches refs explicitly because this repo's fetch
  refspec only tracks `main` (so `origin/main-staging` is otherwise stale).

## 2. Interpret each section

| Section | Blocking when |
|---|---|
| Bot status | `created_with_conflicts_resolved_to_upstream_tree` means CFA code was dropped. Expect LOST invariants. |
| Upstream commits | Not blocking. Read the largest commits' messages; a huge deletion commit (e.g. "Simplify Dub") changes what the product is. Summarise what was removed or added. |
| CFA invariants | Any `LOST`. Each line says what breaks. |
| Reverted / fork-only deleted | Any entry. Same fix as LOST. |
| Prisma schema | `ADD COLUMN`/`CREATE TABLE`/`MODIFY` mean prod needs a schema change before deploy. `DROP *` means **never** run `prisma db push` on this schema. For every dropped table, check it is empty on the test DB (`SELECT COUNT(*)`); non-empty means real data loss risk, flag it. |
| Env vars | Any `NEW` name: must be set in Vercel Preview and Production before deploy. Removed names are informational. |
| Dependencies | Removed workspace packages: check nothing CFA-specific imports them. |
| Stale workflows | Any entry: CI will fail. The bot keeps the fork's `.github/workflows`, so take upstream's version of that workflow (`git show <upstream-sha>:.github/workflows/<file>`). |
| New hardcoded dub.co URLs | Any entry in code paths users hit (links, emails, auth): needs the same env-driven treatment as `APP_DOMAIN`. |
| Merge simulation | Conflicts into main-staging, or main not an ancestor of main-staging (fix by merging `main` into `main-staging` via PR first). |

For anything surprising, read the actual diff (`git diff <base> refs/review/pr-<N> -- <path>`). Do not guess.

## 3. Optional: build and test (recommended for big syncs)

In a separate worktree off the PR head (so the user's checkout is untouched):

```bash
pnpm install --frozen-lockfile
pnpm turbo build --filter='./packages/*'
cd apps/web && pnpm prisma:generate
npx vitest run tests/misc/invite-route.test.ts tests/misc/invite-user.test.ts
DATABASE_URL="$REVIEW_DATABASE_URL" NODE_OPTIONS=--max-old-space-size=8192 pnpm build
```

Run the build in the background (10+ minutes). The default Node heap runs out
of memory locally. The build hits the DB through `generateStaticParams`, which
is what broke production before, so always point it at the test branch.

## 4. Report

```markdown
## Verdict: SAFE | NEEDS CFA RE-APPLY | BLOCKED
One sentence on why.

## What upstream brings
- headline changes (features added/removed), commit count, upstream date

## What would break
- each LOST invariant / reverted file / stale workflow, with its impact

## Database
- schema changes; whether db push is needed (usually NO); dropped tables + row counts

## Env and dependencies
- new env vars to set; notable removals

## Before merging
1. ordered actions
```

## 5. Fixing a PR that drops CFA code

Do not push to `automation/sync-upstream-main-staging`: the bot force-pushes it
every run, so extra commits get wiped. Instead:

1. Branch off the PR head: `git worktree add -b sync/upstream-<yyyy-mm>-with-cfa <dir> refs/review/pr-<N>`
2. Re-apply CFA changes: `git diff <last-synced-upstream> origin/main-staging -- <cfa files> | git apply --3way`
   (the script prints the last-synced upstream SHA). Hand-port anything that fails.
3. Fix stale workflows, re-run `review.sh <new PR>` and the build until clean.
4. Commit as a separate commit, open a PR into `main-staging`, close the bot PR as replaced.

## Hard rules

- Never `prisma db push`, and never `--accept-data-loss`, against any DB as part of a sync review.
- Never touch production: no prod DB URLs, no production deploys.
- PRs target `main-staging`; never push directly to `main-staging` or `main`.
- Merge sync PRs and `main-staging` -> `main` with **Create a merge commit**, never squash.
- No Claude attribution in commits, PR bodies or comments.
- When a new CFA customization lands, add a line to `cfa-invariants.tsv`.
