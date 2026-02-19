# Approve PR creation from GitHub Issue

This is a GitHub workflow Action that enforces PR authors to first open an issue, discuss, and get explicit approval from repo maintainers via an issue comment before opening a PR. The PR must include a reference to that approval comment in the body, otherwise the PR is auto-closed. The goal is to reduce the burden on repo maintainers by preventing unsolicited or undesirable PRs.

## How it works

1. A potential contributor opens an Issue proposing changes. A discussion happens.
2. A maintainer (with write/admin access) allows creation of a PR by commenting on the issue (e.g., `@contributor PR approved`).
3. The contributor opens a PR and includes the approval comment URL in the PR body (e.g., `Approval: https://github.com/owner/repo/issues/42#issuecomment-123456`).
4. The action validates the approval. Any PR that doesn't link to a valid approval is auto-closed.


## Config

| Input                       | Default                  | Description                                                                                                 |
| --------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `approval_str`              | `/pr-welcome {user}`     | Approval comment string to look for in the issue comment. Must include `{user}`.                            |
| `reference_str`             | `/pr-clearance {url}`    | Reference string in PR body pointing to the approval comment. Must include exactly one `{url}` placeholder. |
| `pr_autoclose_message`      | Built-in message         | Comment posted on the PR on auto-close/rejection.                                                           |
| `exclude_past_contributors` | `false`                  | Skip checks for users who have previously contributed commits to the repo.                                  |
| `github_token`              | `${{ github.token }}`    | GitHub token for API calls.                                                                                 |
| `github_api_url`            | `https://api.github.com` | GitHub API base URL. Useful for local testing with a mock server.                                           |
| `force_validate_owner_prs`  | `false`                  | Force validation for owner-authored PRs. Intended for testing only.                                         |
| `min_diff_files`            | `0`                      | Min number of changed files in the PR to apply checks. 0 always checks.                                     |
| `min_diff_lines`            | `0`                      | Min number of changed lines in the PR to apply checks. 0 always checks.                                     |

See the default values in [actions.yml](https://github.com/knadh/approve-pr-creation-from-issue/blob/master/action.yml)

## Usage

```yaml
name: Approve PR from Issue
on:
  pull_request:
    types: [opened, edited, reopened]

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
          # exclude_past_contributors: ''
          # github_token: ''
          # github_api_url: ''
          # force_validate_owner_prs: ''
          # min_diff_files: ''
          # min_diff_lines: ''
```

## License
Licensed under the MIT License.
