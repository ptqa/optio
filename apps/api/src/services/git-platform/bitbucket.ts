import type {
  GitPlatform,
  RepoIdentifier,
  PullRequest,
  CICheck,
  Review,
  InlineComment,
  IssueComment,
  Issue,
  RepoMetadata,
  RepoContent,
} from "@optio/shared";

/**
 * Bitbucket Cloud API v2.0 implementation of the GitPlatform interface.
 *
 * Capability notes:
 *  - Bitbucket Cloud has no PR labels, so `labels` is always `[]`.
 *  - The PR resource has no mergeability flag, so `mergeable` is always `null`.
 *  - Bitbucket Cloud has no issue labels; `createLabel()` and
 *    `addLabelsToIssue()` throw a clear error.
 *  - The issue tracker is disabled by default; a 404 from `listIssues()` maps to `[]`.
 */
export class BitbucketPlatform implements GitPlatform {
  readonly type = "bitbucket" as const;
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "User-Agent": "Optio",
    };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  private url(ri: RepoIdentifier, path: string): string {
    return `${ri.apiBaseUrl}/repositories/${ri.owner}/${ri.repo}${path}`;
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Bitbucket API error ${res.status}: ${body}`);
    }
    return (await res.json()) as T;
  }

  // ── PR/MR reads ───────────────────────────────────────────────────────────

  async getPullRequest(ri: RepoIdentifier, number: number): Promise<PullRequest> {
    const data = await this.fetchJson<any>(this.url(ri, `/pullrequests/${number}`), {
      headers: this.headers(),
    });
    return mapPr(data, ri);
  }

  async listOpenPullRequests(
    ri: RepoIdentifier,
    opts?: { branch?: string; perPage?: number },
  ): Promise<PullRequest[]> {
    const params = new URLSearchParams({
      state: "OPEN",
      pagelen: String(opts?.perPage ?? 50),
    });
    if (opts?.branch) params.set("q", `source.branch.name="${opts.branch}"`);

    const data = await this.fetchJson<{ values?: any[] }>(this.url(ri, `/pullrequests?${params}`), {
      headers: this.headers(),
    });
    return (data.values ?? []).map((pr) => mapPr(pr, ri));
  }

  async getCIChecks(ri: RepoIdentifier, commitSha: string): Promise<CICheck[]> {
    const data = await this.fetchJson<{ values?: any[] }>(
      this.url(ri, `/commit/${commitSha}/statuses?pagelen=100`),
      { headers: this.headers() },
    );
    return (data.values ?? []).map((status) => ({
      name: status.name ?? status.key ?? "",
      status: mapBuildStatus(status.state),
      conclusion: mapBuildConclusion(status.state),
    }));
  }

  async getReviews(ri: RepoIdentifier, prNumber: number): Promise<Review[]> {
    const reviews: Review[] = [];

    try {
      const pr = await this.fetchJson<any>(this.url(ri, `/pullrequests/${prNumber}`), {
        headers: this.headers(),
      });
      const participants = [...(pr.participants ?? [])].sort((a, b) =>
        (a.participated_on ?? "").localeCompare(b.participated_on ?? ""),
      );
      for (const participant of participants) {
        const state = participantState(participant);
        if (!state) continue;
        reviews.push({ author: bitbucketUser(participant.user), state, body: "" });
      }
    } catch {
      // Participant decisions are best-effort; comments may still be available.
    }

    try {
      const data = await this.fetchJson<{ values?: any[] }>(
        this.url(ri, `/pullrequests/${prNumber}/comments?pagelen=100`),
        { headers: this.headers() },
      );
      for (const comment of data.values ?? []) {
        const body = comment.content?.raw ?? "";
        if (comment.deleted || comment.inline || !body.trim()) continue;
        reviews.push({ author: bitbucketUser(comment.user), state: "COMMENTED", body });
      }
    } catch {
      // Comments are best-effort; participant decisions may still be available.
    }

    return reviews;
  }

  async getInlineComments(ri: RepoIdentifier, prNumber: number): Promise<InlineComment[]> {
    const data = await this.fetchJson<{ values?: any[] }>(
      this.url(ri, `/pullrequests/${prNumber}/comments?pagelen=100`),
      { headers: this.headers() },
    );
    return (data.values ?? [])
      .filter((comment) => comment.inline && !comment.deleted)
      .map((comment) => ({
        author: bitbucketUser(comment.user),
        path: comment.inline.path ?? "",
        line: comment.inline.to ?? comment.inline.from ?? null,
        body: comment.content?.raw ?? "",
        createdAt: comment.created_on ?? "",
      }));
  }

  async getIssueComments(
    ri: RepoIdentifier,
    issueOrPrNumber: number,
    resource: "issue" | "pull_request",
  ): Promise<IssueComment[]> {
    const path =
      resource === "issue"
        ? `/issues/${issueOrPrNumber}/comments?pagelen=100`
        : `/pullrequests/${issueOrPrNumber}/comments?pagelen=100`;
    const data = await this.fetchJson<{ values?: any[] }>(this.url(ri, path), {
      headers: this.headers(),
    });

    return (data.values ?? [])
      .filter((comment) => !comment.deleted && !comment.inline)
      .map((comment) => ({
        author: bitbucketUser(comment.user),
        body: comment.content?.raw ?? "",
        createdAt: comment.created_on ?? "",
      }));
  }

  // ── PR/MR writes ──────────────────────────────────────────────────────────

  async mergePullRequest(
    ri: RepoIdentifier,
    prNumber: number,
    method: "merge" | "squash" | "rebase",
  ): Promise<void> {
    await this.fetchJson(this.url(ri, `/pullrequests/${prNumber}/merge`), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({
        type: "pullrequest",
        merge_strategy: mapMergeStrategy(method),
        close_source_branch: true,
      }),
    });
  }

  async submitReview(
    ri: RepoIdentifier,
    prNumber: number,
    review: {
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body: string;
      comments?: { path: string; line?: number; side?: string; body: string }[];
    },
  ): Promise<{ url: string }> {
    if (review.event === "APPROVE") {
      await this.fetchJson(this.url(ri, `/pullrequests/${prNumber}/approve`), {
        method: "POST",
        headers: this.headers(true),
      });
    } else if (review.event === "REQUEST_CHANGES") {
      await this.fetchJson(this.url(ri, `/pullrequests/${prNumber}/request-changes`), {
        method: "POST",
        headers: this.headers(true),
      });
    }

    if (review.body.trim()) {
      await this.fetchJson(this.url(ri, `/pullrequests/${prNumber}/comments`), {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({ content: { raw: review.body } }),
      });
    }

    for (const comment of review.comments ?? []) {
      try {
        await this.fetchJson(this.url(ri, `/pullrequests/${prNumber}/comments`), {
          method: "POST",
          headers: this.headers(true),
          body: JSON.stringify({
            content: { raw: comment.body },
            inline: {
              path: comment.path,
              ...(comment.line !== undefined
                ? comment.side?.toUpperCase() === "LEFT"
                  ? { from: comment.line }
                  : { to: comment.line }
                : {}),
            },
          }),
        });
      } catch {
        // Individual inline comment failures are non-critical.
      }
    }

    return { url: pullRequestUrl(ri, prNumber) };
  }

  // ── Issue reads/writes ────────────────────────────────────────────────────

  async listIssues(
    ri: RepoIdentifier,
    opts?: { state?: string; perPage?: number; labels?: string },
  ): Promise<Issue[]> {
    const params = new URLSearchParams({
      pagelen: String(opts?.perPage ?? 50),
      sort: "-updated_on",
    });
    const stateQuery = issueStateQuery(opts?.state ?? "open");
    if (stateQuery) params.set("q", stateQuery);

    try {
      const data = await this.fetchJson<{ values?: any[] }>(this.url(ri, `/issues?${params}`), {
        headers: this.headers(),
      });
      return (data.values ?? []).map((issue) => mapIssue(issue, ri));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async createLabel(
    _ri: RepoIdentifier,
    _label: { name: string; color: string; description?: string },
  ): Promise<void> {
    throw new Error("Bitbucket does not support issue labels");
  }

  async addLabelsToIssue(
    _ri: RepoIdentifier,
    _issueNumber: number,
    _labels: string[],
  ): Promise<void> {
    throw new Error("Bitbucket does not support issue labels");
  }

  async createIssueComment(ri: RepoIdentifier, issueNumber: number, body: string): Promise<void> {
    await this.fetchJson(this.url(ri, `/issues/${issueNumber}/comments`), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ content: { raw: body } }),
    });
  }

  async closeIssue(ri: RepoIdentifier, issueNumber: number): Promise<void> {
    await this.fetchJson(this.url(ri, `/issues/${issueNumber}`), {
      method: "PUT",
      headers: this.headers(true),
      body: JSON.stringify({ state: "closed" }),
    });
  }

  // ── Repo reads ────────────────────────────────────────────────────────────

  async getRepoMetadata(ri: RepoIdentifier): Promise<RepoMetadata> {
    const data = await this.fetchJson<any>(this.url(ri, ""), { headers: this.headers() });
    return {
      fullName: data.full_name ?? `${ri.owner}/${ri.repo}`,
      defaultBranch: data.mainbranch?.name ?? "main",
      isPrivate: data.is_private ?? false,
    };
  }

  async listRepoContents(ri: RepoIdentifier, path = ""): Promise<RepoContent[]> {
    const metadata = await this.fetchJson<any>(this.url(ri, ""), { headers: this.headers() });
    const branch = encodeURIComponent(metadata.mainbranch?.name ?? "main");
    const encodedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const data = await this.fetchJson<{ values?: any[] }>(
      this.url(ri, `/src/${branch}/${encodedPath}?pagelen=100`),
      { headers: this.headers() },
    );
    return (data.values ?? []).map((item) => ({
      name: item.path?.split("/").pop() ?? "",
      type: item.type === "commit_directory" ? "dir" : "file",
    }));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pullRequestUrl(ri: RepoIdentifier, number: number): string {
  return `https://${ri.host}/${ri.owner}/${ri.repo}/pull-requests/${number}`;
}

function mapPr(data: any, ri: RepoIdentifier): PullRequest {
  return {
    number: data.id,
    title: data.title ?? "",
    body: data.description ?? "",
    state: mapPullRequestState(data.state),
    merged: data.state === "MERGED",
    mergeable: null,
    draft: data.draft ?? false,
    headSha: data.source?.commit?.hash ?? "",
    baseBranch: data.destination?.branch?.name ?? "",
    url: data.links?.html?.href ?? pullRequestUrl(ri, data.id),
    author: bitbucketUser(data.author),
    assignees: (data.reviewers ?? []).map(bitbucketUser),
    labels: [],
    createdAt: data.created_on ?? "",
    updatedAt: data.updated_on ?? "",
  };
}

function mapBuildStatus(state: string): CICheck["status"] {
  if (state === "SUCCESSFUL" || state === "FAILED" || state === "STOPPED") return "completed";
  if (state === "INPROGRESS") return "in_progress";
  return "queued";
}

function mapPullRequestState(state: string): PullRequest["state"] {
  return state === "OPEN" ? "open" : "closed";
}

function mapBuildConclusion(state: string): CICheck["conclusion"] {
  if (state === "SUCCESSFUL") return "success";
  if (state === "FAILED") return "failure";
  if (state === "STOPPED") return "cancelled";
  return null;
}

function participantState(participant: any): Review["state"] | null {
  if (participant.approved || participant.state?.toLowerCase() === "approved") return "APPROVED";
  if (participant.state?.toLowerCase() === "changes_requested") return "CHANGES_REQUESTED";
  return null;
}

function mapMergeStrategy(method: "merge" | "squash" | "rebase"): string {
  if (method === "merge") return "merge_commit";
  if (method === "rebase") return "rebase_fast_forward";
  return "squash";
}

function issueStateQuery(state: string): string {
  if (state === "all") return "";
  const states =
    state === "open"
      ? ["submitted", "new", "open", "on hold"]
      : state === "closed"
        ? ["resolved", "closed", "duplicate", "invalid", "wontfix"]
        : [state];
  return states.map((value) => `state="${value}"`).join(" OR ");
}

function mapIssue(issue: any, ri: RepoIdentifier): Issue {
  const number = issue.id;
  return {
    id: issue.id,
    number,
    title: issue.title ?? "",
    body: issue.content?.raw ?? "",
    state: mapIssueState(issue.state),
    url: issue.links?.html?.href ?? `https://${ri.host}/${ri.owner}/${ri.repo}/issues/${number}`,
    labels: [],
    author: bitbucketUser(issue.reporter),
    assignee: issue.assignee ? bitbucketUser(issue.assignee) : null,
    isPullRequest: false,
    createdAt: issue.created_on ?? "",
    updatedAt: issue.updated_on ?? "",
  };
}

function mapIssueState(state: string): Issue["state"] {
  return ["submitted", "new", "open", "on hold"].includes(state) ? "open" : "closed";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Bitbucket API error 404:");
}

function bitbucketUser(u: any): string {
  return u?.nickname ?? u?.display_name ?? "unknown";
}
