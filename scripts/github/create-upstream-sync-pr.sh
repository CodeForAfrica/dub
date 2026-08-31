#!/usr/bin/env bash
set -euo pipefail

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git remote add upstream "https://github.com/${UPSTREAM_REPO}.git"
git fetch origin "${BASE_BRANCH}"
git fetch origin "${COMPARE_BRANCH}"
git fetch upstream "${UPSTREAM_BRANCH}"
git fetch origin "${SYNC_BRANCH}:refs/remotes/origin/${SYNC_BRANCH}" || true

# Measure drift from the branch that represents production/source-of-truth.
# This count is informational; it does not decide where the generated PR lands.
read -r ahead behind < <(git rev-list --left-right --count "origin/${COMPARE_BRANCH}...upstream/${UPSTREAM_BRANCH}")
echo "ahead=${ahead}" >> "$GITHUB_OUTPUT"
echo "behind=${behind}" >> "$GITHUB_OUTPUT"

# Capture exact SHAs so reviewers can see which branch tips were compared and
# which branch tip the generated sync PR started from.
upstream_sha="$(git rev-parse "upstream/${UPSTREAM_BRANCH}")"
base_sha="$(git rev-parse "origin/${BASE_BRANCH}")"
compare_sha="$(git rev-parse "origin/${COMPARE_BRANCH}")"
echo "upstream_sha=${upstream_sha}" >> "$GITHUB_OUTPUT"
echo "base_sha=${base_sha}" >> "$GITHUB_OUTPUT"
echo "compare_sha=${compare_sha}" >> "$GITHUB_OUTPUT"

# If upstream has no commits missing from the compare branch, stay quiet. The
# workflow will also skip Slack because behind=0.
if [ "${behind}" = "0" ]; then
  echo "status=current" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Start the generated sync PR from the staging branch, even though the drift
# calculation above used main.
git switch -C "${SYNC_BRANCH}" "origin/${BASE_BRANCH}"

sync_status="created"
conflict_files="None"

# This is the important history-preserving step: the generated PR contains a
# real merge from upstream, not a copied tree or squashed replacement commit.
if ! git merge --no-ff --no-edit "upstream/${UPSTREAM_BRANCH}"; then
  sync_status="created_with_conflicts_resolved_to_upstream_tree"
  conflict_files="$(git diff --name-only --diff-filter=U | sed -n '1,80p')"

  # Keep upstream history, but resolve the sync branch to the upstream tree so
  # the sync PR does not introduce CFA custom code. Preserve this workflow and
  # script so future scheduled syncs continue to run after the PR is merged.
  git read-tree --reset -u "upstream/${UPSTREAM_BRANCH}"

  for path in \
    ".github/workflows/upstream-sync.yml" \
    "scripts/github/create-upstream-sync-pr.sh"
  do
    if git cat-file -e "origin/${BASE_BRANCH}:${path}" 2>/dev/null; then
      git restore --source "origin/${BASE_BRANCH}" --staged --worktree -- "${path}"
    fi
  done

  git commit --no-edit
fi

{
  echo "conflict_files<<EOF"
  printf '%s\n' "${conflict_files}"
  echo "EOF"
} >> "$GITHUB_OUTPUT"

# Guardrail: prove the generated branch really contains the upstream branch in
# its history. This is the check that prevents the old "copied files" problem.
git merge-base --is-ancestor "upstream/${UPSTREAM_BRANCH}" HEAD

git push --force-with-lease origin "HEAD:${SYNC_BRANCH}"

# Reuse the existing automation PR if it is already open; otherwise create one.
# This keeps the monthly workflow from opening duplicate PRs.
existing_pr_url="$(
  gh pr list \
    --base "${BASE_BRANCH}" \
    --head "${SYNC_BRANCH}" \
    --state open \
    --json url \
    --jq '.[0].url // ""'
)"

body_file="$(mktemp)"
{
  # The generated PR body should make the review process clear without needing
  # reviewers to inspect the workflow internals.
  printf '%s\n\n' "This PR was created by the monthly upstream sync workflow."
  printf '%s\n' "It syncs \`${UPSTREAM_REPO}/${UPSTREAM_BRANCH}\` into \`${BASE_BRANCH}\` using a real merge so upstream commit history is preserved."
  printf '%s\n' "Behind/ahead counts are measured against \`${COMPARE_BRANCH}\`, because that is the production/default branch."
  printf '%s\n\n' "It does not auto-merge."
  printf '%s\n\n' "## Sync status"
  printf '%s\n' "- Fork commits ahead of upstream: ${ahead}"
  printf '%s\n' "- Upstream commits missing from the fork: ${behind}"
  printf '%s\n' "- Compare branch: \`${COMPARE_BRANCH}\` at \`${compare_sha}\`"
  printf '%s\n' "- Base branch: \`${BASE_BRANCH}\` at \`${base_sha}\`"
  printf '%s\n' "- Upstream branch: \`${UPSTREAM_REPO}/${UPSTREAM_BRANCH}\` at \`${upstream_sha}\`"
  printf '%s\n\n' "- Workflow result: \`${sync_status}\`"
  printf '%s\n\n' "## Merge conflicts"
  if [ "${sync_status}" = "created" ]; then
    printf '%s\n\n' "No merge conflicts were detected by the workflow."
  else
    printf '%s\n\n' "Merge conflicts were detected. To keep this PR upstream-clean, the workflow preserved merge ancestry and resolved the sync branch to the upstream tree, while keeping this workflow file and helper script."
    printf '%s\n\n' "Conflicted files:"
    printf '```text\n%s\n```\n\n' "${conflict_files}"
  fi
  printf '%s\n\n' "## Review and merge process"
  printf '%s\n' "1. Confirm this PR contains upstream commits only; CFA-specific changes should go in a separate PR."
  printf '%s\n' "2. Merge this PR into \`${BASE_BRANCH}\` with a merge commit. Do not squash or rebase it, otherwise the upstream history will not be preserved."
  printf '%s\n' "3. Test the staging branch after merge."
  printf '%s\n' "4. Promote \`${BASE_BRANCH}\` to \`main\` only after staging looks good."
} > "${body_file}"

if [ -n "${existing_pr_url}" ]; then
  pr_url="${existing_pr_url}"
  gh pr edit "${existing_pr_url}" \
    --title "chore: sync upstream ${UPSTREAM_REPO} ${UPSTREAM_BRANCH} into ${BASE_BRANCH}" \
    --body-file "${body_file}"
else
  pr_url="$(
    gh pr create \
      --base "${BASE_BRANCH}" \
      --head "${SYNC_BRANCH}" \
      --title "chore: sync upstream ${UPSTREAM_REPO} ${UPSTREAM_BRANCH} into ${BASE_BRANCH}" \
      --body-file "${body_file}"
  )"
fi

echo "status=${sync_status}" >> "$GITHUB_OUTPUT"
echo "pull_request_url=${pr_url}" >> "$GITHUB_OUTPUT"
