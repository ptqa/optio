import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retrieveSecretWithFallback: vi.fn(),
  getGitHubToken: vi.fn(),
  getCodeCommitCredentials: vi.fn(),
  createGitPlatform: vi.fn(),
}));

vi.mock("./secret-service.js", () => ({
  retrieveSecretWithFallback: mocks.retrieveSecretWithFallback,
}));
vi.mock("./github-token-service.js", () => ({
  getGitHubToken: mocks.getGitHubToken,
}));
vi.mock("./codecommit-credential-service.js", () => ({
  getCodeCommitCredentials: mocks.getCodeCommitCredentials,
}));
vi.mock("./git-platform/index.js", () => ({
  createGitPlatform: mocks.createGitPlatform,
}));

import { getGitPlatformForRepo, getGitToken } from "./git-token-service.js";

const originalEnv = { ...process.env };

describe("getGitToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BITBUCKET_TOKEN;
    delete process.env.GITLAB_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves the global BITBUCKET_TOKEN secret", async () => {
    mocks.retrieveSecretWithFallback.mockImplementation(async (name: string) => {
      if (name === "BITBUCKET_TOKEN") return "bitbucket-secret";
      throw new Error("unexpected secret");
    });

    await expect(getGitToken("bitbucket" as any, { workspaceId: "workspace-1" })).resolves.toBe(
      "bitbucket-secret",
    );
    expect(mocks.retrieveSecretWithFallback).toHaveBeenCalledWith(
      "BITBUCKET_TOKEN",
      "global",
      "workspace-1",
    );
  });

  it("tries the user-scoped Bitbucket token first", async () => {
    mocks.retrieveSecretWithFallback.mockImplementation(async (name: string) => {
      if (name === "BITBUCKET_USER_ACCESS_TOKEN") return "user-bitbucket-token";
      throw new Error("unexpected secret");
    });

    await expect(
      getGitToken("bitbucket" as any, { userId: "user-1", workspaceId: "workspace-1" }),
    ).resolves.toBe("user-bitbucket-token");
    expect(mocks.retrieveSecretWithFallback).toHaveBeenNthCalledWith(
      1,
      "BITBUCKET_USER_ACCESS_TOKEN",
      "user:user-1",
      "workspace-1",
    );
  });

  it("falls back to the BITBUCKET_TOKEN environment variable", async () => {
    process.env.BITBUCKET_TOKEN = "bitbucket-env-token";
    mocks.retrieveSecretWithFallback.mockRejectedValue(new Error("secret unavailable"));

    await expect(getGitToken("bitbucket" as any, {})).resolves.toBe("bitbucket-env-token");
  });

  it("reports when no Bitbucket token is available", async () => {
    mocks.retrieveSecretWithFallback.mockRejectedValue(new Error("secret unavailable"));

    await expect(getGitToken("bitbucket" as any, {})).rejects.toThrow(/BITBUCKET_TOKEN/);
  });

  it("delegates GitHub token resolution", async () => {
    mocks.getGitHubToken.mockResolvedValue("github-token");

    await expect(getGitToken("github" as any, { server: true })).resolves.toBe("github-token");
    expect(mocks.getGitHubToken).toHaveBeenCalledWith({ server: true, workspaceId: undefined });
  });

  it("delegates CodeCommit credential resolution", async () => {
    mocks.getCodeCommitCredentials.mockResolvedValue("codecommit-token");

    await expect(getGitToken("codecommit" as any, { workspaceId: "workspace-1" })).resolves.toBe(
      "codecommit-token",
    );
    expect(mocks.getCodeCommitCredentials).toHaveBeenCalledWith("workspace-1");
  });

  it("still resolves the global GITLAB_TOKEN secret", async () => {
    mocks.retrieveSecretWithFallback.mockImplementation(async (name: string) => {
      if (name === "GITLAB_TOKEN") return "gitlab-secret";
      throw new Error("unexpected secret");
    });

    await expect(getGitToken("gitlab" as any, { workspaceId: "workspace-1" })).resolves.toBe(
      "gitlab-secret",
    );
    expect(mocks.retrieveSecretWithFallback).toHaveBeenCalledWith(
      "GITLAB_TOKEN",
      "global",
      "workspace-1",
    );
  });

  it("still falls back to the GITLAB_TOKEN environment variable", async () => {
    process.env.GITLAB_TOKEN = "gitlab-env-token";
    mocks.retrieveSecretWithFallback.mockRejectedValue(new Error("secret unavailable"));

    await expect(getGitToken("gitlab" as any, {})).resolves.toBe("gitlab-env-token");
  });

  it("rejects an unknown runtime platform instead of treating it as GitLab", async () => {
    await expect(getGitToken("unknown" as any, {})).rejects.toThrow(
      "Unsupported git platform: unknown",
    );
    expect(mocks.retrieveSecretWithFallback).not.toHaveBeenCalled();
  });
});

describe("getGitPlatformForRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retrieveSecretWithFallback.mockResolvedValue("bitbucket-token");
    mocks.createGitPlatform.mockReturnValue({ type: "bitbucket" });
  });

  it("parses a Bitbucket repo, resolves its token, and creates its platform", async () => {
    const result = await getGitPlatformForRepo("https://bitbucket.org/acme/widgets", {
      server: true,
    });

    expect(result.ri.platform).toBe("bitbucket");
    expect(result.ri.owner).toBe("acme");
    expect(result.ri.repo).toBe("widgets");
    expect(mocks.createGitPlatform).toHaveBeenCalledWith("bitbucket", "bitbucket-token");
  });
});
