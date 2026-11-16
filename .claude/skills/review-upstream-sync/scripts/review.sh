#!/usr/bin/env bash
# Gathers facts about an upstream-sync PR. Read-only: fetches refs, never pushes,
# never writes to a database. Run from the repo root.
#
# Usage: review.sh [PR_NUMBER] [--base <ref>]
#   PR_NUMBER  defaults to the open PR from automation/sync-upstream-main-staging
#   --base     what the PR merges into (default origin/main-staging); override to
#              re-review an already merged PR against the base it had at the time
# Env:
#   REVIEW_DATABASE_URL  PlanetScale TEST branch URL for the schema dry run.
#                        Never point this at production.
set -uo pipefail

REPO="CodeForAfrica/dub"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INVARIANTS="$SKILL_DIR/cfa-invariants.tsv"

PR=""; BASE="origin/main-staging"
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    *) PR="$1"; shift ;;
  esac
done
if [ -z "$PR" ]; then
  PR=$(gh pr list --repo "$REPO" --head automation/sync-upstream-main-staging \
    --state open --json number -q '.[0].number')
fi
[ -n "$PR" ] || { echo "No open upstream-sync PR found. Pass a PR number."; exit 1; }

OUT="${TMPDIR:-/tmp}/review-upstream-sync-$PR"; mkdir -p "$OUT"

# This repo's fetch refspec only tracks main, so fetch everything explicitly.
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/dubinc/dub.git
git fetch -q origin "+refs/pull/$PR/head:refs/review/pr-$PR" \
  "+refs/heads/main-staging:refs/remotes/origin/main-staging" \
  "+refs/heads/main:refs/remotes/origin/main"
git fetch -q upstream main
H="refs/review/pr-$PR"

# Upstream tip carried by the PR: the newest upstream/main commit it contains.
if git merge-base --is-ancestor upstream/main "$H"; then U=$(git rev-parse upstream/main)
else U=$(git log --merges -1 --format=%P "$H" | awk '{print $2}'); fi
MB=$(git merge-base "$BASE" "$U")   # upstream commit the base last synced to

show() { git show "$1:$2" 2>/dev/null; }
exists() { git cat-file -e "$1:$2" 2>/dev/null; }
section() { printf '\n## %s\n' "$1"; }

echo "# Upstream sync review: PR #$PR"
echo "PR head:  $(git rev-parse --short "$H")"
echo "Base:     $BASE @ $(git rev-parse --short "$BASE")"
echo "Upstream: $(git rev-parse --short "$U")  (last synced: $(git rev-parse --short "$MB"))"
echo "Report dir: $OUT"

section "Bot status (from PR body)"
gh pr view "$PR" --repo "$REPO" --json body -q .body > "$OUT/pr-body.md"
grep -E 'Workflow result' "$OUT/pr-body.md" || echo "(no workflow result line)"
awk '/Conflicted files:/{f=1;next} f&&/^```/{c++; if(c==2)exit; next} f&&c==1' "$OUT/pr-body.md" \
  | sed 's/^/  conflicted: /'

section "Upstream commits"
echo "Commits in PR not in base: $(git rev-list --count "$BASE..$H")"
echo "Upstream non-merge commits: $(git rev-list --count --no-merges "$MB..$U")"
echo "Largest upstream commits (lines changed):"
git log --no-merges --shortstat --format='@%h %s' "$MB..$U" | awk '
  /^@/{c=$0; next}
  /changed/{n=0; for(i=1;i<=NF;i++) if($i ~ /insertion|deletion/) n+=$(i-1); print n"\t"c}' \
  | sort -rn | head -5 | sed 's/^/  /'

section "Diff size (base -> PR)"
git diff --shortstat "$BASE" "$H"
echo "Most-deleted areas:"
git diff --name-only --diff-filter=D "$BASE" "$H" | awk -F/ '{print $1"/"$2"/"$3}' \
  | sort | uniq -c | sort -rn | head -10

section "CFA invariants"
lost=0
while IFS=$'\t' read -r path pattern why; do
  case "$path" in ''|'#'*) continue ;; esac
  in_base=$(show "$BASE" "$path" | grep -cE "$pattern")
  in_head=$(show "$H" "$path" | grep -cE "$pattern")
  if [ "$in_base" -eq 0 ]; then st="n/a (not on base)"
  elif [ "$in_head" -gt 0 ]; then st="OK"
  else st="LOST"; lost=$((lost+1)); fi
  printf '%-18s %s [%s]%s\n' "$st" "$path" "$pattern" "$([ "$st" = LOST ] && echo " -> $why")"
done < "$INVARIANTS"
echo "Invariants lost: $lost"

section "CFA-modified files reverted to upstream"
# Files CFA changed relative to upstream, where the PR now has upstream's exact copy.
git diff --name-only "$MB" "$BASE" -- . ':!.github/workflows' | while IFS= read -r f; do
  exists "$MB" "$f" || continue          # fork-only files are handled below
  [ "$(git rev-parse -q "$H:$f" 2>/dev/null)" = "$(git rev-parse -q "$U:$f" 2>/dev/null)" ] \
    && echo "  REVERTED  $f"
done

section "Fork-only files deleted by the PR"
git diff --name-only --diff-filter=D "$BASE" "$H" | while IFS= read -r f; do
  exists "$MB" "$f" || echo "  DELETED   $f"
done

section "Prisma schema"
git diff --stat "$BASE" "$H" -- apps/web/prisma/schema | tail -1
if [ -n "${REVIEW_DATABASE_URL:-}" ]; then
  rm -rf "$OUT/schema" && mkdir -p "$OUT/schema"
  git archive "$H" apps/web/prisma/schema | tar -x -C "$OUT/schema"
  # pnpm exec uses the repo's pinned prisma and never downloads a different one.
  (cd apps/web && DATABASE_URL="$REVIEW_DATABASE_URL" pnpm exec prisma migrate diff \
    --from-url "$REVIEW_DATABASE_URL" \
    --to-schema-datamodel "$OUT/schema/apps/web/prisma/schema" --script) > "$OUT/schema.sql" 2>&1
  if grep -qiE '^(error|✘)|ERR_|command not found' "$OUT/schema.sql"; then
    echo "  ERROR: schema dry run failed (run 'pnpm install' first?). See $OUT/schema.sql"
  else
  for k in 'DROP TABLE' 'DROP COLUMN' 'DROP INDEX' 'ADD COLUMN' 'CREATE TABLE' 'MODIFY'; do
    printf '  %-13s %s\n' "$k" "$(grep -c "$k" "$OUT/schema.sql")"
  done
  echo "  Tables dropped: $(grep -oE '^DROP TABLE `[A-Za-z]+`' "$OUT/schema.sql" | awk '{print $3}' | tr -d '`' | tr '\n' ' ')"
  echo "  Full SQL: $OUT/schema.sql"
  fi
else
  echo "  REVIEW_DATABASE_URL not set: schema dry run skipped."
fi

section "Env vars"
git diff "$BASE" "$H" -- apps/web/.env.example | grep -E '^[+-][A-Z0-9_]+=' | sed 's/=.*//;s/^/  /'
echo "New process.env names in added code:"
git diff "$BASE" "$H" -- apps packages | grep -E '^\+[^+]' | grep -oE 'process\.env\.[A-Z0-9_]+' \
  | sort -u | while read -r v; do
    git grep -q "$v" "$BASE" -- apps packages || echo "  NEW  ${v#process.env.}"
  done

section "Dependencies"
git diff --diff-filter=M "$BASE" "$H" -- '*package.json' | grep -E '^[+-]\s+"[^"]+": "' | grep -vE '"(version|description)"' \
  | sed 's/^/  /' | head -40
git diff --name-only --diff-filter=D "$BASE" "$H" -- '*package.json' | sed 's/^/  workspace package removed: /'

section "Stale workflows (fork keeps its own .github/workflows)"
for wf in $(git ls-tree --name-only "$H" .github/workflows/); do
  # Repo-relative script paths only: skip URLs, absolute paths and build output.
  show "$H" "$wf" | grep -oE '(^|[[:space:]"=])[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+\.(ts|tsx|mjs|js|sh)\b' \
    | sed -E 's/^[[:space:]"=]//' | grep -vE '^(dist|node_modules)/|/dist/' | sort -u | while read -r p; do
    exists "$H" "$p" || exists "$H" "apps/web/$p" || echo "  $wf references missing file: $p"
  done
  for proj in $(show "$H" "$wf" | grep -oE -- '--project=[A-Za-z0-9_-]+' | cut -d= -f2 | sort -u); do
    show "$H" apps/web/playwright.config.ts | grep -q "name: \"$proj\"" \
      || echo "  $wf runs missing playwright project: $proj"
  done
done

section "New hardcoded dub.co URLs"
git diff "$BASE" "$H" -- apps packages | grep -E '^\+[^+]' \
  | grep -oE '(https?://)?(app|api|partners|admin)\.dub\.co[^"'"'"' )]*' | sort | uniq -c | head

section "Merge simulation"
for target in "$BASE" origin/main; do
  if git merge-tree --write-tree --name-only "$target" "$H" > "$OUT/mt.txt" 2>&1; then
    echo "  PR -> $target: clean"
  else
    echo "  PR -> $target: CONFLICTS"; sed -n '2,/^$/p' "$OUT/mt.txt" | grep -v '^$' | sed 's/^/    /'
  fi
done
git merge-base --is-ancestor origin/main "$BASE" \
  && echo "  main is an ancestor of $BASE (main-staging -> main will be clean)" \
  || echo "  WARNING: main is not an ancestor of $BASE (squash-merge divergence; merge main into main-staging first)"
