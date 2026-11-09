import { inviteUser } from "@/lib/api/users";
import { sendEmail } from "@dub/email";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@dub/email", () => ({ sendEmail: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    projectInvite: { create: vi.fn() },
    verificationToken: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  hashToken: vi.fn().mockResolvedValue("hashed-token"),
}));

const mockSendEmail = vi.mocked(sendEmail);

const workspace = {
  id: "ws_test",
  name: "Test Workspace",
  slug: "test-workspace",
  users: [],
} as any;

beforeEach(async () => {
  vi.resetAllMocks();
  const { prisma } = await import("@/lib/prisma");
  vi.mocked(prisma.projectInvite.create).mockResolvedValue({} as any);
  vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as any);
  const { hashToken } = await import("@/lib/auth");
  vi.mocked(hashToken).mockResolvedValue("hashed-token");
});

describe("inviteUser", () => {
  it("returns success:true when Resend returns data", async () => {
    mockSendEmail.mockResolvedValue({ data: { id: "email_123" }, error: null } as any);

    const result = await inviteUser({ email: "user@example.com", workspace });

    expect(result).toEqual({ success: true, email: "user@example.com" });
  });

  it("returns success:false when Resend returns an error object", async () => {
    mockSendEmail.mockResolvedValue({ data: null, error: { message: "Forbidden" } } as any);

    const result = await inviteUser({ email: "user@example.com", workspace });

    expect(result).toEqual({ success: false, email: "user@example.com" });
  });

  it("returns success:false when sendEmail returns undefined (no provider configured)", async () => {
    mockSendEmail.mockResolvedValue(undefined as any);

    const result = await inviteUser({ email: "user@example.com", workspace });

    expect(result).toEqual({ success: false, email: "user@example.com" });
  });

  it("rejects when sendEmail throws", async () => {
    mockSendEmail.mockRejectedValue(new Error("network error"));

    await expect(
      inviteUser({ email: "user@example.com", workspace }),
    ).rejects.toThrow("network error");
  });

  it("throws a conflict error for duplicate invitations", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.projectInvite.create).mockRejectedValue(
      Object.assign(new Error("Unique constraint"), { code: "P2002" }),
    );

    await expect(
      inviteUser({ email: "already@example.com", workspace }),
    ).rejects.toMatchObject({ code: "conflict" });

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("retains the saved invitation when email fails", async () => {
    const { prisma } = await import("@/lib/prisma");
    mockSendEmail.mockResolvedValue({ data: null, error: { message: "Forbidden" } } as any);

    const result = await inviteUser({ email: "user@example.com", workspace });

    expect(prisma.projectInvite.create).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
  });

  describe("mixed batch via Promise.allSettled", () => {
    it("identifies only the failed recipient when one of two sends fails", async () => {
      mockSendEmail
        .mockResolvedValueOnce({ data: { id: "email_1" }, error: null } as any)
        .mockResolvedValue({ data: null, error: { message: "Forbidden" } } as any);

      const results = await Promise.allSettled([
        inviteUser({ email: "ok@example.com", workspace }),
        inviteUser({ email: "fail@example.com", workspace }),
      ]);

      const failed = results.flatMap((r, i) => {
        if (r.status === "rejected") return [["ok@example.com", "fail@example.com"][i]];
        if (!r.value.success) return [r.value.email];
        return [];
      });

      expect(failed).toEqual(["fail@example.com"]);
      expect(failed).not.toContain("ok@example.com");
    });
  });
});
