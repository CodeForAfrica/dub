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
vi.mock("../../lib/api/errors", () => ({
  DubApiError: class extends Error {
    code: string;
    constructor({ code, message }: { code: string; message: string }) {
      super(message);
      this.code = code;
    }
  },
}));

const args = {
  email: "member@example.org",
  workspace: { id: "ws_test", slug: "plus", name: "Plus" } as Parameters<
    typeof inviteUser
  >[0]["workspace"],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXTAUTH_URL", "https://app.example.org");
  mocks.createInvite.mockResolvedValue({});
  mocks.createToken.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("workspace invitation email failures", () => {
  it("accepts provider success", async () => {
    const result = { data: { id: "email-test" }, error: null };
    mocks.send.mockResolvedValue(result);
    await expect(inviteUser(args)).resolves.toEqual(result);
    expect(mocks.createInvite).toHaveBeenCalledOnce();
    expect(mocks.createToken).toHaveBeenCalledOnce();
  });

  it.each([
    { data: null, error: { message: "sender forbidden", statusCode: 403 } },
    undefined,
  ])(
    "rejects failed or unconfigured sending while retaining the invite",
    async (result) => {
      mocks.send.mockResolvedValue(result);
      await expect(inviteUser(args)).rejects.toMatchObject({
        code: "bad_request",
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
    await expect(inviteUser(args)).resolves.toEqual(result);
  });

  it("propagates a rejected send", async () => {
    mocks.send.mockRejectedValue(new Error("provider unavailable"));
    await expect(inviteUser(args)).rejects.toThrow("provider unavailable");
  });

  it("preserves duplicate-invite protection", async () => {
    mocks.createInvite.mockRejectedValue({ code: "P2002" });
    await expect(inviteUser(args)).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not send when saving the invitation fails", async () => {
    mocks.createInvite.mockRejectedValue(new Error("database unavailable"));
    await expect(inviteUser(args)).rejects.toThrow("database unavailable");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.createToken).not.toHaveBeenCalled();
  });
});
