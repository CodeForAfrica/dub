import { POST } from "../../app/api/workspaces/[idOrSlug]/invites/route";
import { inviteUser } from "@/lib/api/users";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth", () => ({
  withWorkspace: (handler: Function) => async (req: Request) => {
    const workspace = {
      id: "ws_test",
      name: "Test Workspace",
      slug: "test-workspace",
      plan: "pro",
      planPeriod: "monthly",
      usersLimit: 10,
      users: [],
    };
    try {
      return await handler({
        req,
        workspace,
        session: { user: { id: "u1", email: "owner@example.com", name: "Owner" } },
        searchParams: {},
        permissions: [],
        token: null,
      });
    } catch (err: any) {
      const { NextResponse } = await import("next/server");
      const statusMap: Record<string, number> = {
        conflict: 409,
        internal_server_error: 500,
        bad_request: 400,
        not_found: 404,
        rate_limit_exceeded: 429,
        exceeded_limit: 402,
      };
      const status = err?.code ? (statusMap[err.code] ?? 500) : 500;
      return NextResponse.json(
        { error: { code: err?.code ?? "internal_server_error", message: err?.message } },
        { status },
      );
    }
  },
  hashToken: vi.fn(),
}));

vi.mock("@/lib/api/users", () => ({ inviteUser: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    projectUsers: { findMany: vi.fn(), count: vi.fn() },
    projectInvite: { count: vi.fn() },
  },
}));

vi.mock("@/lib/upstash", () => ({
  ratelimit: () => ({ limit: vi.fn().mockResolvedValue({ success: true }) }),
  redis: { del: vi.fn() },
}));

vi.mock("@/lib/api/workspaces/assert-role-plan", () => ({
  assertRoleAllowedForPlan: vi.fn(),
}));

const mockInviteUser = vi.mocked(inviteUser);

const post = (teammates: Array<{ email: string; role: "member" | "owner" }>) =>
  (POST as Function)(
    new Request("http://localhost/api/workspaces/ws_test/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teammates }),
    }),
  );

beforeEach(async () => {
  vi.resetAllMocks();
  const { prisma } = await import("@/lib/prisma");
  vi.mocked(prisma.projectUsers.findMany).mockResolvedValue([]);
  vi.mocked(prisma.projectUsers.count).mockResolvedValue(0);
  vi.mocked(prisma.projectInvite.count).mockResolvedValue(0);
  const { redis } = await import("@/lib/upstash");
  vi.mocked(redis.del).mockResolvedValue(1 as any);
});

describe("POST /api/workspaces/[idOrSlug]/invites — HTTP status codes", () => {
  it("returns 200 when all invites succeed", async () => {
    mockInviteUser.mockResolvedValue({ success: true, email: "user@example.com" });

    const res = await post([{ email: "user@example.com", role: "member" }]);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Invite(s) sent" });
  });

  it("returns 500 when Resend returns an error, never 'Invite(s) sent'", async () => {
    mockInviteUser.mockResolvedValue({ success: false, email: "user@example.com" });

    const res = await post([{ email: "user@example.com", role: "member" }]);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toContain("user@example.com");
  });

  it("returns 500 naming only the failed recipient in a mixed batch", async () => {
    mockInviteUser
      .mockResolvedValueOnce({ success: true, email: "ok@example.com" })
      .mockResolvedValueOnce({ success: false, email: "fail@example.com" });

    const res = await post([
      { email: "ok@example.com", role: "member" },
      { email: "fail@example.com", role: "member" },
    ]);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toContain("fail@example.com");
    expect(body.error.message).not.toContain("ok@example.com");
  });

  it("returns 409 for a duplicate invitation, not 500", async () => {
    const { DubApiError } = await import("@/lib/api/errors");
    mockInviteUser.mockRejectedValue(
      new DubApiError({
        code: "conflict",
        message: "User already@example.com has already been invited.",
      }),
    );

    const res = await post([{ email: "already@example.com", role: "member" }]);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
  });
});
