# Approve PR creation from GitHub Issue

This is a GitHub workflow Action that enforces PR authors to first open an issue, discuss, and get explicit approval from repo maintainers via an issue comment before opening a PR. The PR must include a reference to that approval comment in the body, otherwise the PR is auto-closed. The goal is to reduce the burden on repo maintainers by preventing unsolicited or undesirable PRs.

## How it works

1. A potential contributor opens an Issue proposing changes. A discussion happens.
2. A maintainer (with write/admin access) allows creation of a PR by commenting on the issue (e.g., `/pr-welcome @contributor`).
3. The contributor opens a PR and includes the approval comment URL in the PR body (e.g., `/pr-clearance https://github.com/owner/repo/issues/42#issuecomment-123456`).
4. The action validates the approval. Any PR that doesn't link to a valid approval is auto-closed.


## Config

| Input                       | Default                  | Description                                                                                                 |
| --------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `allowed_paths`             | Empty                    | File paths or globs relative to the root (one per line) to allow. If empty, all paths are allowed. Except for repo owners, any changed path outside this list closes the PR immediately without proceeding to the approval flow. |
| `require_approval`          | `true`                   | Require issue approval after path checks pass. Repo owners are exempt from all checks. Contributor and diff-size exemptions apply only to approval checks. |
| `approval_str`              | `/pr-welcome {user}`     | Approval comment string to look for in the issue comment. Must include `{user}`.                            |
| `reference_str`             | `/pr-clearance {url}`    | Reference string in PR body pointing to the approval comment. Must include exactly one `{url}` placeholder. |
| `pr_autoclose_message`      | Built-in message         | Comment posted on the PR on auto-close/rejection.                                                           |
| `exclude_past_contributors` | `false`                  | Skip checks for users who have previously contributed commits to the repo.                                  |
| `github_token`              | `${{ github.token }}`    | GitHub token for API calls.                                                                                 |
| `min_diff_files`            | `0`                      | Min number of changed files in the PR to apply checks. 0 always checks.                                     |
| `min_diff_lines`            | `0`                      | Min number of changed lines in the PR to apply checks. 0 always checks.                                     |

See the default values in [actions.yml](https://github.com/knadh/approve-pr-creation-from-issue/blob/master/action.yml)

### Path restrictions

| `allowed_paths` | `require_approval` | Behavior |
| --- | --- | --- |
| Empty | `true` (default) | Existing approval flow. |
| Configured | `true` | Close PRs that don't match allowed paths. Otherwise, run the existing approval flow. |
| Configured | `false` | Close PRs that don't match allowed paths. Otherwise, allow without issue approval. |
| Empty | `false` | No path restriction or issue approval checks. |

Repo owners are exempt from both path restrictions and approval checks. For everyone else, path restrictions run before approval exemptions for past contributors and small diffs. Every changed file must match at least one pattern. Renames must match both the old and new paths; deleted files are checked too. If the file list cannot be fully retrieved, the action fails without closing the PR.

Use repository-relative paths with `/` separators, one per line. Exact paths match individual files; `docs/**` matches files under `docs/` recursively, while `docs/*` matches only direct children. Matching uses Node's `path.posix.matchesGlob`; dotfiles need explicit patterns (for example, `.github/**`). Patterns are alternatives, not an ordered include/exclude list.

For example, allow only documentation changes without requiring issue approval:

```yaml
with:
  allowed_paths: |
    docs/**
    README.md
  require_approval: 'false'
```

Set `require_approval: 'true'` to also require the existing approval flow for these paths. Include `synchronize` in workflow triggers so new commits are checked as well.

## Usage

```yaml
name: Approve PR from Issue
on:
  pull_request:
    types: [opened, edited, reopened, synchronize]

permissions:
  pull-requests: write
  issues: read

jobs:
  check-approval:
    runs-on: ubuntu-latest
    steps:
      - uses: knadh/approve-pr-from-issue@v1
        with:
          exclude_past_contributors: 'true'
          # approval_str: ''
          # reference_str: ''
          # pr_autoclose_message: ''
          # min_diff_files: ''
          # min_diff_lines: ''
```

## License
Licensed under the MIT License.
