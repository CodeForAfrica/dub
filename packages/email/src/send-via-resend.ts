import { resend } from "./resend";
import { VARIANT_TO_FROM_MAP, RESEND_REPLY_TO } from "./resend/constants";
import { ResendEmailOptions } from "./resend/types";

const resendEmailForOptions = (opts: ResendEmailOptions) => {
  const {
    to,
    from,
    variant = "primary",
    bcc,
    replyTo = RESEND_REPLY_TO,
    subject,
    text,
    react,
    scheduledAt,
    headers,
    tags,
  } = opts;

  return {
    to,
    from: from || VARIANT_TO_FROM_MAP[variant],
    bcc: bcc,
    replyTo,
    subject,
    text,
    react,
    scheduledAt,
    tags,
    ...(variant === "marketing"
      ? {
          headers: {
            ...(headers || {}),
            "List-Unsubscribe": "https://app.dub.co/account/settings",
          },
        }
      : {
          headers,
        }),
  };
};

// Send email using Resend (Recommended for production)
export const sendEmailViaResend = async (opts: ResendEmailOptions) => {
  if (!resend) {
    console.info(
      "RESEND_API_KEY is not set in the .env. Skipping sending email.",
    );
    return;
  }

  return await resend.emails.send(resendEmailForOptions(opts));
};

export const sendBatchEmailViaResend = async (
  opts: ResendBulkEmailOptions,
  options?: { idempotencyKey?: string },
) => {
  if (!resend) {
    console.info(
      "RESEND_API_KEY is not set in the .env. Skipping sending email.",
    );

    return {
      data: null,
      error: null,
    };
  }

  if (opts.length === 0) {
    return {
      data: null,
      error: null,
    };
  }

  const payload = opts.map(resendEmailForOptions);

  const idempotencyKey = options?.idempotencyKey || undefined;

  return await resend.batch.send(
    payload,
    idempotencyKey ? { idempotencyKey } : undefined,
  );
};
