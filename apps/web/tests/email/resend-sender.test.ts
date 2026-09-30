import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendBatchEmailViaResend,
  sendEmailViaResend,
} from "../../../../packages/email/src/send-via-resend";

const mocks = vi.hoisted(() => ({ send: vi.fn(), batch: vi.fn() }));
vi.mock("../../../../packages/email/src/resend", () => ({
  resend: { emails: { send: mocks.send }, batch: { send: mocks.batch } },
}));

const message = {
  to: "member@example.org",
  subject: "Invitation",
  text: "Join us",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("EMAIL_REPLY_TO", "");
  mocks.send.mockResolvedValue({ data: { id: "email-test" }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("self-hosted Resend sender", () => {
  it.each(["primary", "notifications", "marketing"] as const)(
    "uses CFA defaults for %s",
    async (variant) => {
      await sendEmailViaResend({ ...message, variant });
      expect(mocks.send).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "Code for Africa <noreply@codeforafrica.org>",
          replyTo: "tech@codeforafrica.org",
          to: message.to,
        }),
      );
    },
  );

  it("uses configured sender and reply-to", async () => {
    vi.stubEnv("EMAIL_FROM", "CFA <mail@example.org>");
    vi.stubEnv("EMAIL_REPLY_TO", "help@example.org");
    await sendEmailViaResend(message);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "CFA <mail@example.org>",
        replyTo: "help@example.org",
      }),
    );
  });

  it("preserves explicit per-message overrides", async () => {
    vi.stubEnv("EMAIL_FROM", "default@example.org");
    vi.stubEnv("EMAIL_REPLY_TO", "default@example.org");
    await sendEmailViaResend({
      ...message,
      from: "custom@example.org",
      replyTo: "reply@example.org",
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "custom@example.org",
        replyTo: "reply@example.org",
      }),
    );
  });

  it("honours noreply even with a configured default", async () => {
    vi.stubEnv("EMAIL_REPLY_TO", "help@example.org");
    await sendEmailViaResend({ ...message, replyTo: "noreply" });
    expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("replyTo");
  });

  it("keeps preview emails away from real recipients", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "fix/email");
    await sendEmailViaResend(message);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "delivered@resend.dev",
        subject: "Invitation [fix/email]",
      }),
    );
  });

  it("applies configuration to batches without losing idempotency", async () => {
    vi.stubEnv("EMAIL_FROM", "mail@example.org");
    await sendBatchEmailViaResend([message], { idempotencyKey: "batch-test" });
    expect(mocks.batch).toHaveBeenCalledWith(
      [expect.objectContaining({ from: "mail@example.org" })],
      { idempotencyKey: "batch-test" },
    );
  });
});
