import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BitbucketPlatform } from "./bitbucket.js";
import type { RepoIdentifier } from "@optio/shared";

const ri: RepoIdentifier = {
  platform: "bitbucket",
  host: "bitbucket.org",
  owner: "acme",
  repo: "widgets",
  apiBaseUrl: "https://api.bitbucket.org/2.0",
};

const repoUrl = "https://api.bitbucket.org/2.0/repositories/acme/widgets";
const mockFetch = vi.fn();

describe("BitbucketPlatform", () => {
  let platform: BitbucketPlatform;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    platform = new BitbucketPlatform("bb-test123");
    mockFetch.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockJsonResponse(data: any, ok = true, status = 200) {
    mockFetch.mockResolvedValueOnce({
      ok,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    });
  }

  it("has type bitbucket", () => {
    expect(platform.type).toBe("bitbucket");
  });

  describe("getPullRequest", () => {
    it("fetches and maps an open pull request", async () => {
      mockJsonResponse({
        id: 7,
        title: "Add feature",
        description: "Implements X",
        state: "OPEN",
        draft: true,
        source: { commit: { hash: "def456" } },
        destination: { branch: { name: "main" } },
        links: { html: { href: "https://bitbucket.org/acme/widgets/pull-requests/7" } },
        author: { nickname: "alice", display_name: "Alice" },
        reviewers: [{ nickname: "bob" }, { nickname: "carol" }],
        created_on: "2024-01-01",
        updated_on: "2024-01-02",
      });

      const pr = await platform.getPullRequest(ri, 7);

      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/pullrequests/7`);
      expect(mockFetch.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer bb-test123",
            "User-Agent": "Optio",
          }),
        }),
      );
      expect(pr).toEqual({
        number: 7,
        title: "Add feature",
        body: "Implements X",
        state: "open",
        merged: false,
        mergeable: null,
        draft: true,
        headSha: "def456",
        baseBranch: "main",
        url: "https://bitbucket.org/acme/widgets/pull-requests/7",
        author: "alice",
        assignees: ["bob", "carol"],
        labels: [],
        createdAt: "2024-01-01",
        updatedAt: "2024-01-02",
      });
    });

    it("maps a merged pull request and falls back to its web URL", async () => {
      mockJsonResponse({
        id: 8,
        title: "Merged feature",
        description: "Done",
        state: "MERGED",
        source: { commit: { hash: "abc123" } },
        destination: { branch: { name: "develop" } },
        author: { display_name: "Bob Smith" },
        reviewers: [],
        created_on: "2024-02-01",
        updated_on: "2024-02-02",
      });

      const pr = await platform.getPullRequest(ri, 8);

      expect(pr.state).toBe("closed");
      expect(pr.merged).toBe(true);
      expect(pr.mergeable).toBeNull();
      expect(pr.draft).toBe(false);
      expect(pr.author).toBe("Bob Smith");
      expect(pr.url).toBe("https://bitbucket.org/acme/widgets/pull-requests/8");
    });
  });

  describe("listOpenPullRequests", () => {
    it("sends open, pagination, and source-branch filters and maps values", async () => {
      mockJsonResponse({
        values: [
          {
            id: 9,
            title: "Task branch",
            description: "Body",
            state: "OPEN",
            source: { commit: { hash: "sha9" } },
            destination: { branch: { name: "main" } },
            author: { nickname: "alice" },
            reviewers: [],
            created_on: "2024-03-01",
            updated_on: "2024-03-02",
          },
        ],
      });

      const prs = await platform.listOpenPullRequests(ri, {
        branch: "optio/task-abc",
        perPage: 25,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain(`${repoUrl}/pullrequests?`);
      expect(url).toContain("state=OPEN");
      expect(url).toContain("pagelen=25");
      expect(decodeURIComponent(url)).toContain('source.branch.name="optio/task-abc"');
      expect(mockFetch.mock.calls[0][1].headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer bb-test123",
          "User-Agent": "Optio",
        }),
      );
      expect(prs).toHaveLength(1);
      expect(prs[0]).toEqual(
        expect.objectContaining({ number: 9, state: "open", headSha: "sha9" }),
      );
    });

    it("returns an empty array when values is empty", async () => {
      mockJsonResponse({ values: [] });

      await expect(platform.listOpenPullRequests(ri)).resolves.toEqual([]);
    });
  });

  describe("getCIChecks", () => {
    it("maps all Bitbucket build states and falls back from name to key", async () => {
      mockJsonResponse({
        values: [
          { key: "build", name: "Build", state: "SUCCESSFUL" },
          { key: "test", name: "Tests", state: "FAILED" },
          { key: "cancel", name: "Cancelled", state: "STOPPED" },
          { key: "deploy", name: "Deploy", state: "INPROGRESS" },
          { key: "waiting", state: "PENDING" },
        ],
      });

      const checks = await platform.getCIChecks(ri, "abc123");

      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/commit/abc123/statuses?pagelen=100`);
      expect(mockFetch.mock.calls[0][1].headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer bb-test123",
          "User-Agent": "Optio",
        }),
      );
      expect(checks).toEqual([
        { name: "Build", status: "completed", conclusion: "success" },
        { name: "Tests", status: "completed", conclusion: "failure" },
        { name: "Cancelled", status: "completed", conclusion: "cancelled" },
        { name: "Deploy", status: "in_progress", conclusion: null },
        { name: "waiting", status: "queued", conclusion: null },
      ]);
    });

    it("returns an empty array when there are no statuses", async () => {
      mockJsonResponse({ values: [] });

      await expect(platform.getCIChecks(ri, "abc123")).resolves.toEqual([]);
    });
  });

  describe("getReviews", () => {
    it("combines participant decisions and non-inline comments", async () => {
      mockJsonResponse({
        participants: [
          {
            user: { nickname: "carol" },
            approved: false,
            state: "changes_requested",
            participated_on: "2024-01-03",
          },
          {
            user: { nickname: "alice" },
            approved: true,
            state: null,
            participated_on: "2024-01-01",
          },
          {
            user: { nickname: "bob" },
            approved: false,
            state: "approved",
            participated_on: "2024-01-02",
          },
          { user: { nickname: "dave" }, approved: false, state: null },
        ],
      });
      mockJsonResponse({
        values: [
          { user: { nickname: "erin" }, content: { raw: "Looks good" } },
          {
            user: { nickname: "frank" },
            content: { raw: "Inline" },
            inline: { path: "src/index.ts", to: 4 },
          },
          { user: { nickname: "grace" }, content: { raw: "Deleted" }, deleted: true },
          { user: { nickname: "henry" }, content: { raw: "   " } },
        ],
      });

      const reviews = await platform.getReviews(ri, 7);

      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/pullrequests/7`);
      expect(mockFetch.mock.calls[1][0]).toBe(`${repoUrl}/pullrequests/7/comments?pagelen=100`);
      for (const call of mockFetch.mock.calls) {
        expect(call[1].headers).toEqual(
          expect.objectContaining({
            Authorization: "Bearer bb-test123",
            "User-Agent": "Optio",
          }),
        );
      }
      expect(reviews).toEqual([
        { author: "alice", state: "APPROVED", body: "" },
        { author: "bob", state: "APPROVED", body: "" },
        { author: "carol", state: "CHANGES_REQUESTED", body: "" },
        { author: "erin", state: "COMMENTED", body: "Looks good" },
      ]);
    });

    it("tolerates either endpoint failing and returns gathered reviews", async () => {
      mockJsonResponse({ message: "PR failed" }, false, 500);
      mockJsonResponse({
        values: [{ user: { nickname: "alice" }, content: { raw: "Comment only" } }],
      });

      await expect(platform.getReviews(ri, 7)).resolves.toEqual([
        { author: "alice", state: "COMMENTED", body: "Comment only" },
      ]);

      mockFetch.mockReset();
      mockJsonResponse({
        participants: [{ user: { nickname: "bob" }, approved: true, state: null }],
      });
      mockJsonResponse({ message: "Comments failed" }, false, 500);

      await expect(platform.getReviews(ri, 7)).resolves.toEqual([
        { author: "bob", state: "APPROVED", body: "" },
      ]);
    });
  });

  describe("getInlineComments", () => {
    it("maps inline comments, uses from as a line fallback, and excludes deleted comments", async () => {
      mockJsonResponse({
        values: [
          {
            user: { nickname: "alice" },
            content: { raw: "Change this" },
            inline: { path: "src/index.ts", to: 12, from: 10 },
            created_on: "2024-04-01",
          },
          {
            user: { nickname: "bob" },
            content: { raw: "Old line" },
            inline: { path: "src/old.ts", from: 8 },
            created_on: "2024-04-02",
          },
          {
            user: { nickname: "carol" },
            content: { raw: "No line" },
            inline: { path: "README.md" },
            created_on: "2024-04-03",
          },
          {
            user: { nickname: "dave" },
            content: { raw: "Deleted" },
            inline: { path: "deleted.ts", to: 1 },
            created_on: "2024-04-04",
            deleted: true,
          },
          { user: { nickname: "erin" }, content: { raw: "Top level" } },
        ],
      });

      const comments = await platform.getInlineComments(ri, 7);

      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/pullrequests/7/comments?pagelen=100`);
      expect(mockFetch.mock.calls[0][1].headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer bb-test123",
          "User-Agent": "Optio",
        }),
      );
      expect(comments).toEqual([
        {
          author: "alice",
          path: "src/index.ts",
          line: 12,
          body: "Change this",
          createdAt: "2024-04-01",
        },
        {
          author: "bob",
          path: "src/old.ts",
          line: 8,
          body: "Old line",
          createdAt: "2024-04-02",
        },
        {
          author: "carol",
          path: "README.md",
          line: null,
          body: "No line",
          createdAt: "2024-04-03",
        },
      ]);
    });
  });

  describe("getIssueComments", () => {
    it("uses the pull-request comments endpoint when explicitly requested", async () => {
      mockJsonResponse({
        values: [
          {
            user: { nickname: "alice" },
            content: { raw: "PR comment" },
            created_on: "2024-05-01",
          },
          {
            user: { nickname: "bob" },
            content: { raw: "Inline" },
            inline: { path: "src/index.ts", to: 1 },
            created_on: "2024-05-02",
          },
        ],
      });

      const comments = await platform.getIssueComments(ri, 7, "pull_request");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/pullrequests/7/comments?pagelen=100`);
      expect(mockFetch.mock.calls[0][1].headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer bb-test123",
          "User-Agent": "Optio",
        }),
      );
      expect(comments).toEqual([{ author: "alice", body: "PR comment", createdAt: "2024-05-01" }]);
    });

    it("uses the issue comments endpoint even when a PR has the same ID", async () => {
      mockJsonResponse({
        values: [
          {
            user: { nickname: "carol" },
            content: { raw: "Issue comment" },
            created_on: "2024-05-03",
          },
        ],
      });

      const comments = await platform.getIssueComments(ri, 42, "issue");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/issues/42/comments?pagelen=100`);
      for (const call of mockFetch.mock.calls) {
        expect(call[1].headers).toEqual(
          expect.objectContaining({
            Authorization: "Bearer bb-test123",
            "User-Agent": "Optio",
          }),
        );
      }
      expect(comments).toEqual([
        { author: "carol", body: "Issue comment", createdAt: "2024-05-03" },
      ]);
    });
  });

  describe("mergePullRequest", () => {
    it.each([
      ["merge", "merge_commit"],
      ["squash", "squash"],
      ["rebase", "rebase_fast_forward"],
    ] as const)("maps %s to the %s merge strategy", async (method, mergeStrategy) => {
      mockJsonResponse({});

      await platform.mergePullRequest(ri, 7, method);

      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/pullrequests/7/merge`);
      expect(mockFetch.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer bb-test123",
            "User-Agent": "Optio",
            "Content-Type": "application/json",
          }),
        }),
      );
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        type: "pullrequest",
        merge_strategy: mergeStrategy,
        close_source_branch: true,
      });
    });
  });

  describe("submitReview", () => {
    it("approves and posts the body and inline comments", async () => {
      mockJsonResponse({});
      mockJsonResponse({});
      mockJsonResponse({});
      mockJsonResponse({});

      const result = await platform.submitReview(ri, 7, {
        event: "APPROVE",
        body: "Ship it",
        comments: [
          { path: "src/index.ts", line: 12, side: "LEFT", body: "Fix this" },
          { path: "README.md", body: "Clarify this" },
        ],
      });

      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/pullrequests/7/approve`);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      expect(mockFetch.mock.calls[1][0]).toBe(`${repoUrl}/pullrequests/7/comments`);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        content: { raw: "Ship it" },
      });
      expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
        content: { raw: "Fix this" },
        inline: { path: "src/index.ts", from: 12 },
      });
      const commentWithoutLine = JSON.parse(mockFetch.mock.calls[3][1].body);
      expect(commentWithoutLine).toEqual({
        content: { raw: "Clarify this" },
        inline: { path: "README.md" },
      });
      expect(commentWithoutLine.inline).not.toHaveProperty("to");
      for (const call of mockFetch.mock.calls) {
        expect(call[1].headers).toEqual(
          expect.objectContaining({
            Authorization: "Bearer bb-test123",
            "User-Agent": "Optio",
            "Content-Type": "application/json",
          }),
        );
      }
      expect(result).toEqual({ url: "https://bitbucket.org/acme/widgets/pull-requests/7" });
    });

    it("requests changes through the request-changes endpoint", async () => {
      mockJsonResponse({});

      await platform.submitReview(ri, 7, {
        event: "REQUEST_CHANGES",
        body: "",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/pullrequests/7/request-changes`);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    });

    it("does not call an approval endpoint for a comment review", async () => {
      mockJsonResponse({});

      await platform.submitReview(ri, 7, {
        event: "COMMENT",
        body: "Just a comment",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/pullrequests/7/comments`);
      expect(mockFetch.mock.calls[0][0]).not.toContain("/approve");
      expect(mockFetch.mock.calls[0][0]).not.toContain("/request-changes");
    });

    it("does not reject when an individual inline comment fails", async () => {
      mockJsonResponse({ message: "Bad inline" }, false, 500);
      mockJsonResponse({});

      await expect(
        platform.submitReview(ri, 7, {
          event: "COMMENT",
          body: "",
          comments: [
            { path: "broken.ts", line: 1, body: "Broken" },
            { path: "working.ts", line: 2, body: "Working" },
          ],
        }),
      ).resolves.toEqual({ url: "https://bitbucket.org/acme/widgets/pull-requests/7" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        content: { raw: "Working" },
        inline: { path: "working.ts", to: 2 },
      });
    });
  });

  describe("listIssues", () => {
    it("filters open-ish states and maps issue fields and states", async () => {
      const states = [
        "submitted",
        "new",
        "open",
        "on hold",
        "resolved",
        "closed",
        "duplicate",
        "invalid",
        "wontfix",
      ];
      mockJsonResponse({
        values: states.map((state, index) => ({
          id: index + 1,
          title: `Issue ${index + 1}`,
          content: { raw: `Body ${index + 1}` },
          state,
          links: { html: { href: `https://bitbucket.org/acme/widgets/issues/${index + 1}` } },
          reporter: { nickname: "alice" },
          assignee: index === 0 ? { nickname: "bob" } : null,
          created_on: "2024-06-01",
          updated_on: "2024-06-02",
        })),
      });

      const issues = await platform.listIssues(ri, { state: "open", perPage: 25 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain(`${repoUrl}/issues?`);
      expect(url).toContain("pagelen=25");
      expect(url).toContain("sort=-updated_on");
      expect(decodeURIComponent(url)).toContain('state="submitted"');
      expect(decodeURIComponent(url)).toContain('state="new"');
      expect(decodeURIComponent(url)).toContain('state="open"');
      expect(mockFetch.mock.calls[0][1].headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer bb-test123",
          "User-Agent": "Optio",
        }),
      );
      expect(issues.map((issue) => issue.state)).toEqual([
        "open",
        "open",
        "open",
        "open",
        "closed",
        "closed",
        "closed",
        "closed",
        "closed",
      ]);
      expect(issues[0]).toEqual({
        id: 1,
        number: 1,
        title: "Issue 1",
        body: "Body 1",
        state: "open",
        url: "https://bitbucket.org/acme/widgets/issues/1",
        labels: [],
        author: "alice",
        assignee: "bob",
        isPullRequest: false,
        createdAt: "2024-06-01",
        updatedAt: "2024-06-02",
      });
      expect(issues[1].assignee).toBeNull();
    });

    it("returns an empty array on 404 when the issue tracker is disabled", async () => {
      mockJsonResponse({ message: "Not Found" }, false, 404);

      await expect(platform.listIssues(ri)).resolves.toEqual([]);
      expect(mockFetch.mock.calls[0][0]).toContain("pagelen=50");
    });

    it("still throws on a 500 response", async () => {
      mockJsonResponse({ message: "Server Error" }, false, 500);

      await expect(platform.listIssues(ri)).rejects.toThrow(/Bitbucket API error 500/);
    });
  });

  describe("issue writes", () => {
    it("rejects unsupported label operations without fetching", async () => {
      await expect(platform.createLabel(ri, { name: "bug", color: "ff0000" })).rejects.toThrow(
        /Bitbucket does not support issue labels/,
      );
      await expect(platform.addLabelsToIssue(ri, 10, ["bug"])).rejects.toThrow(
        /Bitbucket does not support issue labels/,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("creates an issue comment", async () => {
      mockJsonResponse({});

      await platform.createIssueComment(ri, 10, "Investigating");

      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/issues/10/comments`);
      expect(mockFetch.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer bb-test123",
            "User-Agent": "Optio",
            "Content-Type": "application/json",
          }),
        }),
      );
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        content: { raw: "Investigating" },
      });
    });

    it("closes an issue", async () => {
      mockJsonResponse({});

      await platform.closeIssue(ri, 10);

      expect(mockFetch.mock.calls[0][0]).toBe(`${repoUrl}/issues/10`);
      expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
      expect(mockFetch.mock.calls[0][1].headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer bb-test123",
          "User-Agent": "Optio",
          "Content-Type": "application/json",
        }),
      );
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ state: "closed" });
    });
  });

  describe("getRepoMetadata", () => {
    it("maps repository metadata", async () => {
      mockJsonResponse({
        full_name: "acme/widgets",
        mainbranch: { name: "develop" },
        is_private: true,
      });

      const metadata = await platform.getRepoMetadata(ri);

      expect(mockFetch.mock.calls[0][0]).toBe(repoUrl);
      expect(mockFetch.mock.calls[0][1].headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer bb-test123",
          "User-Agent": "Optio",
        }),
      );
      expect(metadata).toEqual({
        fullName: "acme/widgets",
        defaultBranch: "develop",
        isPrivate: true,
      });
    });

    it("falls back to main when the default branch is absent", async () => {
      mockJsonResponse({ full_name: "acme/widgets", is_private: false });

      await expect(platform.getRepoMetadata(ri)).resolves.toEqual({
        fullName: "acme/widgets",
        defaultBranch: "main",
        isPrivate: false,
      });
    });
  });

  describe("listRepoContents", () => {
    it("resolves the default branch and lists root contents", async () => {
      mockJsonResponse({ mainbranch: { name: "main" } });
      mockJsonResponse({
        values: [
          { path: "README.md", type: "commit_file" },
          { path: "src", type: "commit_directory" },
        ],
      });

      const contents = await platform.listRepoContents(ri);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe(repoUrl);
      expect(mockFetch.mock.calls[1][0]).toBe(`${repoUrl}/src/main/?pagelen=100`);
      for (const call of mockFetch.mock.calls) {
        expect(call[1].headers).toEqual(
          expect.objectContaining({
            Authorization: "Bearer bb-test123",
            "User-Agent": "Optio",
          }),
        );
      }
      expect(contents).toEqual([
        { name: "README.md", type: "file" },
        { name: "src", type: "dir" },
      ]);
    });

    it("uses basenames when listing a nested path", async () => {
      mockJsonResponse({ mainbranch: { name: "develop" } });
      mockJsonResponse({
        values: [
          { path: "src/index.ts", type: "commit_file" },
          { path: "src/services", type: "commit_directory" },
        ],
      });

      const contents = await platform.listRepoContents(ri, "src");

      expect(mockFetch.mock.calls[1][0]).toBe(`${repoUrl}/src/develop/src?pagelen=100`);
      expect(contents).toEqual([
        { name: "index.ts", type: "file" },
        { name: "services", type: "dir" },
      ]);
    });
  });

  describe("error handling", () => {
    it("throws a status-bearing error on a non-ok response", async () => {
      mockJsonResponse({ message: "Not Found" }, false, 404);

      await expect(platform.getPullRequest(ri, 999)).rejects.toThrow(/Bitbucket API error 404/);
    });
  });
});
