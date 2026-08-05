import { describe, it, expect } from "vitest";
import { normalizeRepoUrl } from "./normalize-repo-url.js";

describe("normalizeRepoUrl", () => {
  const canonical = "https://github.com/foo/bar";

  it.each([
    ["https://github.com/foo/bar", "HTTPS with no suffix"],
    ["https://github.com/foo/bar.git", "HTTPS with .git"],
    ["https://github.com/foo/bar/", "HTTPS with trailing slash"],
    ["https://github.com/foo/bar.git/", "HTTPS with .git and trailing slash"],
    ["http://github.com/foo/bar", "HTTP"],
    ["git@github.com:foo/bar.git", "SSH shorthand with .git"],
    ["git@github.com:foo/bar", "SSH shorthand without .git"],
    ["ssh://git@github.com/foo/bar.git", "SSH protocol with .git"],
    ["ssh://git@github.com/foo/bar", "SSH protocol without .git"],
    ["ssh://git@github.com:22/foo/bar.git", "SSH protocol with port"],
    ["github.com/foo/bar", "bare host"],
    ["github.com/foo/bar.git", "bare host with .git"],
    ["HTTPS://GitHub.COM/foo/bar", "mixed case host"],
    ["https://github.com/Foo/Bar", "mixed case owner/repo"],
    ["git@github.com:FOO/BAR.git", "SSH shorthand with upper case path"],
  ])("normalizes %s (%s)", (input) => {
    expect(normalizeRepoUrl(input)).toBe(canonical);
  });

  it("handles whitespace", () => {
    expect(normalizeRepoUrl("  https://github.com/foo/bar  ")).toBe(canonical);
  });

  it("preserves different hosts", () => {
    expect(normalizeRepoUrl("https://gitlab.com/foo/bar.git")).toBe("https://gitlab.com/foo/bar");
  });

  it.each([
    ["https://x-token-auth@bitbucket.org/foo/bar.git", "Bitbucket token clone link"],
    ["https://ATBBsecrettoken@bitbucket.org/foo/bar", "Bitbucket access token as user"],
    ["https://user:password@bitbucket.org/foo/bar.git", "user:password"],
    ["x-token-auth@bitbucket.org/foo/bar.git", "userinfo without scheme"],
  ])("strips embedded credentials from %s (%s)", (input) => {
    expect(normalizeRepoUrl(input)).toBe("https://bitbucket.org/foo/bar");
  });

  it("keeps @ inside the repo path", () => {
    expect(normalizeRepoUrl("https://github.com/foo/@bar")).toBe("https://github.com/foo/@bar");
  });
});
