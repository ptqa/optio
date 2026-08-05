import type { OAuthProvider } from "./provider.js";
import { GitHubOAuthProvider } from "./github.js";
import { GoogleOAuthProvider } from "./google.js";
import { GitLabOAuthProvider } from "./gitlab.js";
import { GenericOIDCProvider } from "./oidc.js";

const providers: Record<string, OAuthProvider> = {
  github: new GitHubOAuthProvider(),
  google: new GoogleOAuthProvider(),
  gitlab: new GitLabOAuthProvider(),
  oidc: new GenericOIDCProvider(),
};

export function getOAuthProvider(name: string): OAuthProvider | undefined {
  return providers[name];
}

export interface EnabledProvider {
  name: string;
  displayName: string;
}

/** Returns providers that have their client ID configured. */
export function getEnabledProviders(): EnabledProvider[] {
  const result: EnabledProvider[] = [];
  if (process.env.GITHUB_OAUTH_CLIENT_ID || process.env.GITHUB_APP_CLIENT_ID) {
    result.push({ name: "github", displayName: "GitHub" });
  }
  if (process.env.GOOGLE_OAUTH_CLIENT_ID) {
    result.push({ name: "google", displayName: "Google" });
  }
  if (process.env.GITLAB_OAUTH_CLIENT_ID) {
    result.push({ name: "gitlab", displayName: "GitLab" });
  }
  if (process.env.OIDC_ISSUER_URL) {
    result.push({
      name: "oidc",
      displayName: process.env.OIDC_DISPLAY_NAME || "SSO",
    });
  }
  return result;
}

export function isAuthDisabled(): boolean {
  return process.env.OPTIO_AUTH_DISABLED === "true";
}

/** Splits a comma-separated env var into lowercased, non-empty entries. */
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Whether an OAuth identity is permitted to sign in.
 *
 * OAuth only proves who someone is, not that they belong here: any Google or
 * GitHub account can complete a flow against a publicly reachable deployment,
 * and the callback provisions a user on first sight. This gate is what makes a
 * public deployment safe.
 *
 * Configured via OPTIO_ALLOWED_EMAIL_DOMAINS (domain suffixes) and/or
 * OPTIO_ALLOWED_EMAILS (exact addresses); an address matching either is
 * admitted. When neither is set no policy is enforced and every address is
 * allowed, which keeps existing single-tenant installs working — so deployments
 * exposed to the internet must set at least one.
 *
 * Callers must only pass an address the provider has verified; an unverified
 * address would otherwise let anyone claim a privileged domain.
 */
export function isEmailAllowed(email: string): boolean {
  const domains = parseList(process.env.OPTIO_ALLOWED_EMAIL_DOMAINS).map((d) =>
    d.replace(/^[@.]/, ""),
  );
  const emails = parseList(process.env.OPTIO_ALLOWED_EMAILS);

  // No policy configured — preserve open sign-up.
  if (domains.length === 0 && emails.length === 0) return true;

  const normalized = email.trim().toLowerCase();
  if (emails.includes(normalized)) return true;

  // Take the last @ segment: "a@allowed.com@evil.com" must be judged on
  // evil.com, which is the domain the provider actually authenticated.
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return false;
  const domain = normalized.slice(at + 1);

  // Exact match only. Matching a suffix would admit "notlightningstep.com",
  // and subdomains are intentionally excluded.
  return domains.includes(domain);
}

export { type OAuthProvider } from "./provider.js";
