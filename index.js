import core from '@actions/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GITHUB_API_VERSION = '2022-11-28';
const RE_COMMENT_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)#issuecomment-(\d+)$/;
const DEFAULT_CONFIG = {
  approvalStr: '{user} PR approved',
  referenceStr: 'Approval: {url}',
  autocloseMsg:
    'This PR was automatically closed because the reference to approval (issue) could not be found. Please open an issue first, get approval from the maintainer, and reference the approval comment URL in your PR body in the format `Approval: {url}`.',
  excludeContributors: false,
};
const ALLOWED_PERMISSIONS = new Set(['write', 'admin']);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCommentURL(prBody, referenceStr, owner, repo) {
  // Extract the URL from the body.
  const parts = referenceStr.split('{url}');
  const reUrl = RE_COMMENT_URL.source.replace(/^\^/, '').replace(/\$$/, '');
  const re = new RegExp(`${escapeRegExp(parts[0])}(${reUrl})${escapeRegExp(parts[1])}`);
  const match = prBody.match(re);
  if (!match?.[1]) {
    throw new Error('No approval comment URL found in the PR body.');
  }

  // Parse the URL into GitHub pieces.
  const commentUrl = match[1];
  const u = commentUrl.match(RE_COMMENT_URL);
  if (!u) {
    throw new Error('The referenced URL is not the correct GitHub issue comment URL.');
  }

  const pOwner = u[1].toLowerCase();
  const pRepo = u[2].toLowerCase();
  if (pOwner !== owner || pRepo !== repo) {
    throw new Error(
      `The referenced comment URL should belong to ${owner}/${repo}, not ${u[1]}/${u[2]}.`
    );
  }

  return {
    owner: pOwner,
    repo: pRepo,
    issue: u[3],
    commentId: u[4],
    commentUrl,
  };
}

function validateConfig(cfg) {
  if (!cfg.referenceStr.includes('{url}')) {
    core.setFailed('`reference_str` must contain the `{url}` placeholder.');
    return false;
  }

  if (!cfg.approvalStr.includes('{user}')) {
    core.setFailed('`approval_str` must contain the `{user}` placeholder.');
    return false;
  }

  return true;
}

// =====================

class PRApproval {
  constructor({ token, owner, repo, prNumber, prUser, prBody, cfg }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.prNumber = prNumber;
    this.prUser = prUser;
    this.prBody = prBody;
    this.cfg = cfg;
    this.api = `https://api.github.com/repos/${owner}/${repo}`;
  }

  _headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...extra,
    };
  }

  async _request(url, opts = {}) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      throw new Error(`error calling GitHub API: ${err.message}`);
    }

    let data = null;
    try {
      if (res.status !== 204) {
        data = await res.json();
      }
    } catch (_) {
      data = null;
    }

    return { status: res.status, ok: res.ok, data, headers: res.headers };
  }

  async _get(url) {
    return this._request(url, { method: 'GET', headers: this._headers(), });
  }

  async _send(method, url, body) {
    return this._request(url, {
      method,
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  // Close PR with a reason comment and fail the action.
  async _closePR(reason) {
    core.info(reason);
    try {
      const res = await this._send('POST', `${this.api}/issues/${this.prNumber}/comments`, {
        body: `${this.cfg.autocloseMsg}\n\n**Reason:** ${reason}`,
      });
      if (!res.ok) {
        core.info(`errror posting auto-close comment (status ${res.status}).`);
      }

      // Mark as closed.
      const closeRes = await this._send('PATCH', `${this.api}/pulls/${this.prNumber}`, { state: 'closed' });
      if (!closeRes.ok) {
        core.info(`errror closing PR #${this.prNumber} (status ${closeRes.status}).`);
      }
    } catch (_) {
      core.info('error closing PR');
    }
  }

  async _isContributor() {
    let page = 1;
    while (true) {
      const { status, data, headers } = await this._get(
        `${this.api}/contributors?per_page=100&page=${page}`
      );

      if (status !== 200 || !data) {
        return false;
      }
      if (data.some(c => c.login?.toLowerCase() === this.prUser)) {
        return true;
      }
      if (!(headers.get('link') || '').includes('rel="next"')) {
        return false;
      }
      page++;
    }
  }

  async check() {
    core.info(`verifying PR #${this.prNumber} by @${this.prUser} in ${this.owner}/${this.repo}`);

    // Skip validation for past contributors.
    if (this.cfg.excludeContribs) {
      core.info('exclude_past_contributors is enabled. Checking contributor list');
      try {
        if (await this._isContributor()) {
          core.info(`@${this.prUser} is a past contributor. Skipping approval check.`);
          return;
        }
        core.info(`@${this.prUser} is not a past contributor. Continue with approval check.`);
      } catch (err) {
        return core.setFailed(`error checking contributors: ${err.message}`);
      }
    }

    let parsed;
    try {
      parsed = extractCommentURL(this.prBody, this.cfg.referenceStr, this.owner, this.repo);
      core.info(`Found comment URL: ${parsed.commentUrl}`);
    } catch (err) {
      return core.setFailed(err.message);
    }

    // Fetch the comment.
    let comment;
    try {
      const { status, data } = await this._get(`${this.api}/issues/comments/${parsed.commentId}`);
      if (status === 404 || !data) {
        return this._closePR('The referenced PR approval comment was not found.');
      }
      if (status !== 200) {
        return core.setFailed(`GitHub API returned status ${status} while fetching comment.`);
      }
      comment = data;
    } catch (err) {
      return core.setFailed(`error fetching comment: ${err.message}`);
    }

    // Check if the issue is open.
    try {
      const { status, data: issue } = await this._get(comment.issue_url);
      if (status !== 200 || !issue)
        return core.setFailed(`error fetching issue (status ${status}).`);
      if (issue.state !== 'open')
        return this._closePR('The referenced PR approval comment issue is closed.');
    } catch (err) {
      return core.setFailed(`error checking issue state: ${err.message}`);
    }

    // Check approval string.
    const expected = this.cfg.approvalStr.replace('{user}', `@${this.prUser}`);
    if (!comment.body?.includes(expected)) {
      return this._closePR(`Approval string "${expected}" was not found in the referenced comment.`);
    }

    // Verify approver has write/admin access.
    const approver = comment.user?.login;
    if (!approver) {
      return core.setFailed('The referenced approval comment does not have a valid author.');
    }
    try {
      const { status, data } = await this._get(`${this.api}/collaborators/${approver}/permission`);
      if (status !== 200 || !data) {
        return core.setFailed(`error checking permissions for @${approver} (status ${status}).`);
      }
      if (!ALLOWED_PERMISSIONS.has(data.permission)) {
        return this._closePR(`@${approver} does not have write or admin access to this repository.`);
      }
    } catch (err) {
      return core.setFailed(`error checking approver permissions: ${err.message}`);
    }

    core.info(`PR #${this.prNumber} has valid approval from @${approver}. All checks passed.`);
  }
}

// =====================

async function run() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return core.setFailed('Missing GITHUB_EVENT_PATH.');

  let event;
  try {
    event = JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch (err) {
    return core.setFailed(`Could not read GitHub event payload: ${err.message}`);
  }

  const pr = event.pull_request;
  if (!pr) return core.setFailed('This action must be triggered by the `pull_request` event.');

  const token = core.getInput('github_token');
  if (!token) return core.setFailed('github_token input is required.');

  // If the repo owner and PR user are the same, shortcuit and just skip everything.
  if (pr.base.repo.owner.login.toLowerCase() === pr.user.login.toLowerCase()) {
    core.info('PR author is the same as the repo owner. Skipping approval checks.');
    return;
  }

  const cfg = {
    approvalStr: core.getInput('approval_str') || DEFAULT_CONFIG.approvalStr,
    referenceStr: core.getInput('reference_str') || DEFAULT_CONFIG.referenceStr,
    autocloseMsg: core.getInput('pr_autoclose_message') || DEFAULT_CONFIG.autocloseMsg,
    excludeContribs: core.getInput('exclude_past_contributors') === 'true',
  };
  if (!validateConfig(cfg)) return;

  const checker = new PRApproval({
    token,
    owner: pr.base.repo.owner.login.toLowerCase(),
    repo: pr.base.repo.name.toLowerCase(),
    prNumber: pr.number,
    prUser: pr.user.login.toLowerCase(),
    prBody: pr.body || '',
    cfg,
  });

  await checker.check();
}

export { run };

// Only run when executed directly (not when imported by tests).
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  run().catch(err => {
    core.setFailed(`Unhandled error: ${err.message}`);
  });
}
