import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/workspaces/[idOrSlug]/invites/route";

const mocks = vi.hoisted(() => ({ invite: vi.fn() }));
vi.mock("@/lib/auth", () => ({ withWorkspace: (handler: unknown) => handler }));
vi.mock("@/lib/api/users", () => ({ inviteUser: mocks.invite }));
vi.mock("@/lib/api/errors", () => ({ DubApiError: Error }));
vi.mock("@/lib/api/workspaces/assert-role-plan", () => ({
  assertRoleAllowedForPlan: vi.fn(),
}));
vi.mock("@/lib/exceeded-limit-error", () => ({ exceededLimitError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    projectUsers: { findMany: async () => [], count: async () => 0 },
    projectInvite: { count: async () => 0 },
  },
}));
vi.mock("@/lib/upstash", () => ({
  ratelimit: () => ({ limit: async () => ({ success: true }) }),
  redis: { del: vi.fn() },
}));
vi.mock("@/lib/zod/schemas/invites", () => ({
  inviteTeammatesSchema: { parse: (value: unknown) => value },
}));
vi.mock("@/lib/zod/schemas/workspaces", () => ({
  getWorkspaceUsersQuerySchema: {},
  workspaceUserSchema: {},
}));
vi.mock("@dub/utils", () => ({ pluralize: (word: string) => word }));
vi.mock("@prisma/client", () => ({ WorkspaceRole: {} }));
vi.mock("zod/v4", () => ({ object: vi.fn(), email: vi.fn(), enum: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, options?: ResponseInit) =>
      Response.json(body, options),
  },
}));

const emails = ["one@example.org", "two@example.org"];
const request = () =>
  (POST as unknown as (context: unknown) => Promise<Response>)({
    req: {
      json: async () => ({
        teammates: emails.map((email) => ({ email, role: "member" })),
      }),
    },
    workspace: { id: "ws_test", usersLimit: 10 },
    session: {},
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("workspace invite response", () => {
  it("returns server failure when no emails can be sent", async () => {
    mocks.invite.mockImplementation(async ({ email }) => ({
      status: "email_failed",
      email,
      message: "Invitation saved; email failed.",
    }));
    const response = await request();
    expect(response.status).toBe(500);
    expect((await response.json()).error.message).toContain("0 of 2");
  });
  it("reports success only when every email is accepted", async () => {
    mocks.invite.mockImplementation(async ({ email }) => ({
      status: "sent",
      email,
    }));
    const response = await request();
    expect(response.status).toBe(200);
    expect((await response.json()).results).toHaveLength(2);
  });

  it("returns server failure and per-recipient outcomes for partial success", async () => {
    mocks.invite
      .mockResolvedValueOnce({ status: "sent", email: emails[0] })
      .mockResolvedValueOnce({
        status: "email_failed",
        email: emails[1],
        message: "Invitation saved; email failed.",
      });
    const response = await request();
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_server_error");
    expect(body.error.message).toContain("1 of 2");
    expect(
      body.results.map((result: { status: string }) => result.status),
    ).toEqual(["sent", "email_failed"]);
  });

  it("returns conflict for duplicate invitations without throwing", async () => {
    mocks.invite.mockImplementation(async ({ email }) => ({
      status: "already_invited",
      email,
      message: "Already invited.",
    }));
    expect((await request()).status).toBe(409);
  });

  it("does not expose unexpected database errors", async () => {
    mocks.invite.mockRejectedValue(
      new Error("private database connection string"),
    );
    const response = await request();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private database",
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private database",
    );
  });
});
