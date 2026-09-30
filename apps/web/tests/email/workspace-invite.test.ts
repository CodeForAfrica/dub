import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inviteUser } from "../../lib/api/users";

const mocks = vi.hoisted(() => ({
  createInvite: vi.fn(),
  createToken: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  hashToken: vi.fn().mockResolvedValue("hashed-token"),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    projectInvite: { create: mocks.createInvite },
    verificationToken: { create: mocks.createToken },
  },
}));
vi.mock("@dub/email", () => ({ sendEmail: mocks.send }));
vi.mock("@dub/email/templates/workspace-invite", () => ({
  default: vi.fn(() => null),
}));
vi.mock("@dub/utils", () => ({ TWO_WEEKS_IN_SECONDS: 1209600 }));

const args = {
  email: "member@example.org",
  workspace: { id: "ws_test", slug: "plus", name: "Plus" } as Parameters<
    typeof inviteUser
  >[0]["workspace"],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXTAUTH_URL", "https://app.example.org");
  mocks.createInvite.mockResolvedValue({});
  mocks.createToken.mockResolvedValue({});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("workspace invitation email failures", () => {
  it("accepts provider success", async () => {
    const result = { data: { id: "email-test" }, error: null };
    mocks.send.mockResolvedValue(result);
    await expect(inviteUser(args)).resolves.toEqual({
      status: "sent",
      email: args.email,
    });
    expect(mocks.createInvite).toHaveBeenCalledOnce();
    expect(mocks.createToken).toHaveBeenCalledOnce();
  });

  it.each([
    { data: null, error: { message: "sender forbidden", statusCode: 403 } },
    undefined,
  ])(
    "returns failed or unconfigured sending while retaining the invite",
    async (result) => {
      mocks.send.mockResolvedValue(result);
      await expect(inviteUser(args)).resolves.toMatchObject({
        status: "email_failed",
        message: expect.stringContaining(
          "was saved, but its email could not be sent",
        ),
      });
      expect(mocks.createInvite).toHaveBeenCalledOnce();
      expect(mocks.createToken).toHaveBeenCalledOnce();
    },
  );

  it("accepts the SMTP transport result", async () => {
    const result = { messageId: "smtp-test", accepted: [args.email] };
    mocks.send.mockResolvedValue(result);
    await expect(inviteUser(args)).resolves.toEqual({
      status: "sent",
      email: args.email,
    });
  });

  it("returns a failure for a rejected send", async () => {
    mocks.send.mockRejectedValue(new Error("provider unavailable"));
    await expect(inviteUser(args)).resolves.toMatchObject({
      status: "email_failed",
    });
  });

  it("preserves duplicate-invite protection", async () => {
    mocks.createInvite.mockRejectedValue({ code: "P2002" });
    await expect(inviteUser(args)).resolves.toMatchObject({
      status: "already_invited",
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not send when saving the invitation fails", async () => {
    mocks.createInvite.mockRejectedValue(new Error("database unavailable"));
    await expect(inviteUser(args)).rejects.toThrow("database unavailable");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.createToken).not.toHaveBeenCalled();
  });

  it("does not send if verification-token storage fails", async () => {
    mocks.createToken.mockRejectedValue(new Error("database unavailable"));
    await expect(inviteUser(args)).rejects.toThrow("database unavailable");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("preserves the requested role when sending fails", async () => {
    mocks.send.mockResolvedValue(undefined);
    await inviteUser({ ...args, role: "owner" });
    expect(mocks.createInvite).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: "owner", email: args.email }),
    });
  });

  it("does not log unrecognised provider error fields", async () => {
    mocks.send.mockRejectedValue({
      name: "secret-token",
      statusCode: "secret-token",
      message: "secret-token",
    });
    await inviteUser(args);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "secret-token",
    );
  });

  it("logs only safe provider diagnostics", async () => {
    mocks.send.mockResolvedValue({
      data: null,
      error: {
        name: "validation_error",
        statusCode: 403,
        message: "secret-token-and-recipient",
        request: { token: "secret-token" },
      },
    });
    const result = await inviteUser(args);
    expect(console.error).toHaveBeenCalledWith(
      "Workspace invitation email failed",
      {
        workspaceId: "ws_test",
        category: "validation_error",
        statusCode: 403,
      },
    );
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
});
