/**
 * Mint an installation token for the repository's GitHub App (T-1502, #719).
 *
 * ADR-0036 decided that a bot merge opens a pull request rather than pushing,
 * because `main` requires a `lint` context that no push can produce. That
 * decision rests on an assumption nobody has measured: **that a pull request
 * opened by an App triggers the checks at all.** If `on: pull_request` does not
 * fire for one, the rebuild pull request is green with nothing having run,
 * which is #722's empty runner in a new place — the exact defect the design is
 * meant to avoid, reintroduced by the design.
 *
 * This mints the token that measurement needs. It is written here rather than
 * taken from an action so the repository owns the one credential path it has:
 * a dependency that mints tokens is a dependency that can mint tokens.
 *
 * Reads `COMMITLORE_BOT_APP_ID` and `COMMITLORE_BOT_KEY` from the environment
 * and writes the token to stdout. Nothing else is printed there, so a caller
 * can capture it without parsing.
 */

import { createSign } from 'node:crypto';

const die = (message) => {
  process.stderr.write(`app-installation-token: ${message}\n`);
  process.exit(2);
};

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * A JWT the App signs for itself. Ten minutes is GitHub's ceiling; sixty
 * seconds of backdating absorbs clock skew between this runner and GitHub,
 * which rejects a token issued in its own future.
 */
const appJwt = (appId, privateKey) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  let signature;
  try {
    signature = signer.sign(privateKey);
  } catch (error) {
    die(`the private key could not sign — is COMMITLORE_BOT_KEY a full PEM? (${error.message})`);
  }
  return `${header}.${payload}.${base64url(signature)}`;
};

const api = async (path, token, init = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'commitlore-app-token',
      ...(init.headers ?? {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    // The message is the useful part and never contains the token; the token is
    // only ever in the request header, which is not echoed here.
    die(`${init.method ?? 'GET'} ${path} → ${response.status} ${body.slice(0, 300)}`);
  }
  return body === '' ? {} : JSON.parse(body);
};

const appId = (process.env.COMMITLORE_BOT_APP_ID ?? '').trim();
const privateKey = process.env.COMMITLORE_BOT_KEY ?? '';
const repository = (process.env.GITHUB_REPOSITORY ?? '').trim();

if (appId === '') die('COMMITLORE_BOT_APP_ID is empty');
if (privateKey.trim() === '') die('COMMITLORE_BOT_KEY is empty');
if (!repository.includes('/')) die('GITHUB_REPOSITORY is not owner/name');

const jwt = appJwt(appId, privateKey);

// The installation is looked up by repository rather than listed, so a token
// minted here can only ever reach the repository this ran in.
const installation = await api(`/repos/${repository}/installation`, jwt);
if (typeof installation.id !== 'number') {
  die(`no installation for ${repository} — install the App on it before running this`);
}

// Asked for narrowly rather than taken whole. A body-less request mints a
// token carrying every permission the installation holds on every repository
// it is installed on -- and this token is handed to a job whose input came
// from a rebuild of somebody else's change. The installation may grow later
// (another repository, another permission) and a token minted without a scope
// would grow with it silently.
//
// These two are what the caller does and nothing else: push the rebuilt branch,
// and open or update the pull request that carries it.
const minted = await api(`/app/installations/${installation.id}/access_tokens`, jwt, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    repositories: [repository.slice(repository.indexOf('/') + 1)],
    permissions: { contents: 'write', pull_requests: 'write' },
  }),
});
if (typeof minted.token !== 'string') die('the installation token response carried no token');

process.stderr.write(
  `app-installation-token: installation ${installation.id}, expires ${minted.expires_at}\n`,
);
process.stdout.write(minted.token);
