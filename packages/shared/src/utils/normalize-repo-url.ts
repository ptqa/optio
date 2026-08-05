/**
 * Normalizes a git repository URL to a canonical HTTPS form.
 *
 * Handles common permutations:
 *   - https://github.com/foo/bar.git
 *   - https://github.com/foo/bar
 *   - https://github.com/foo/bar/
 *   - git@github.com:foo/bar.git
 *   - ssh://git@github.com/foo/bar
 *   - ssh://git@github.com:22/foo/bar.git
 *   - github.com/foo/bar
 *   - http://github.com/foo/bar
 *   - HTTPS://GitHub.com/Foo/Bar
 *   - https://token@bitbucket.org/foo/bar.git (userinfo stripped)
 *
 * Canonical form: https://github.com/foo/bar (lowercase host, no trailing slash, no .git,
 * no embedded credentials)
 */
export function normalizeRepoUrl(url: string): string {
  let u = url.trim();

  // SSH shorthand: git@host:owner/repo.git → https://host/owner/repo
  const sshShorthand = u.match(/^[\w-]+@([^:]+):(.+)$/);
  if (sshShorthand) {
    u = `https://${sshShorthand[1]}/${sshShorthand[2]}`;
  }

  // ssh://git@host(:port)/owner/repo → https://host/owner/repo
  const sshProto = u.match(/^ssh:\/\/[^@]+@([^:/]+)(?::\d+)?\/(.+)$/);
  if (sshProto) {
    u = `https://${sshProto[1]}/${sshProto[2]}`;
  }

  // http:// or HTTPS:// → https://
  u = u.replace(/^https?:\/\//i, "https://");

  // Add https:// if missing (e.g. "github.com/foo/bar")
  if (!u.startsWith("https://")) {
    u = `https://${u}`;
  }

  // Strip embedded credentials: https://user[:pass]@host/... → https://host/...
  // Bitbucket's clone links carry the access token as the userinfo component,
  // which would otherwise be persisted and break exact-match repo lookups.
  u = u.replace(/^https:\/\/[^/@]*@/, "https://");

  // Strip trailing slashes, then .git suffix (order matters for "foo.git/")
  u = u.replace(/\/+$/, "");
  u = u.replace(/\.git$/, "");
  u = u.replace(/\/+$/, "");

  // GitHub is case-insensitive for owner/repo, so lowercase everything for matching
  u = u.toLowerCase();

  // Strip trailing slash again (URL parsing may re-add it)
  u = u.replace(/\/+$/, "");

  return u;
}
