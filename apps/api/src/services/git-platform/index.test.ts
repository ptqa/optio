import { describe, it, expect } from "vitest";
import { createGitPlatform } from "./index.js";
import { BitbucketPlatform } from "./bitbucket.js";

const codeCommitToken = JSON.stringify({
  accessKeyId: "AKIA-test",
  secretAccessKey: "secret-test",
  region: "us-east-1",
});

describe("createGitPlatform", () => {
  it("creates a GitHub platform", () => {
    expect(createGitPlatform("github", "t").type).toBe("github");
  });

  it("creates a GitLab platform", () => {
    expect(createGitPlatform("gitlab", "t").type).toBe("gitlab");
  });

  it("creates a CodeCommit platform", () => {
    expect(createGitPlatform("codecommit", codeCommitToken).type).toBe("codecommit");
  });

  it("creates a Bitbucket platform", () => {
    const platform = createGitPlatform("bitbucket" as any, "t");

    expect(platform.type).toBe("bitbucket");
    expect(platform).toBeInstanceOf(BitbucketPlatform);
  });

  it("rejects unsupported platforms", () => {
    expect(() => createGitPlatform("nope" as any, "t")).toThrow(/Unsupported git platform/);
  });
});
