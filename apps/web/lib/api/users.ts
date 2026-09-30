import { Session, hashToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WorkspaceWithUsers } from "@/lib/types";
import { sendEmail } from "@dub/email";
import WorkspaceInvite from "@dub/email/templates/workspace-invite";
import { TWO_WEEKS_IN_SECONDS } from "@dub/utils";
import { WorkspaceRole } from "@prisma/client";
import { randomBytes } from "crypto";

export type InviteUserResult =
  | { status: "sent"; email: string }
  | {
      status: "email_failed" | "already_invited";
      email: string;
      message: string;
    };

function emailFailure(
  email: string,
  workspaceId: string,
  error: unknown,
): InviteUserResult {
  const details = error && typeof error === "object" ? error : {};
  // Never log provider messages, request bodies, tokens, or recipient addresses.
  // The status and known error category are enough to locate the provider failure.
  const name = "name" in details ? details.name : undefined;
  const statusCode = "statusCode" in details ? details.statusCode : undefined;
  const allowedNames = [
    "validation_error",
    "missing_api_key",
    "invalid_api_key",
    "restricted_api_key",
    "rate_limit_exceeded",
    "application_error",
  ];
  console.error("Workspace invitation email failed", {
    workspaceId,
    category:
      typeof name === "string" && allowedNames.includes(name)
        ? name
        : "send_failed_or_unconfigured",
    ...(typeof statusCode === "number" &&
    Number.isInteger(statusCode) &&
    statusCode >= 400 &&
    statusCode <= 599
      ? { statusCode }
      : {}),
  });
  return {
    status: "email_failed",
    email,
    message: `Invitation for ${email} was saved, but its email could not be sent. Contact your workspace administrator. After email sending is fixed, revoke the pending invitation and re-invite with the same role.`,
  };
}

export async function inviteUser({
  email,
  role = "member",
  workspace,
  session,
}: {
  email: string;
  role?: WorkspaceRole;
  workspace: WorkspaceWithUsers;
  session?: Session;
}): Promise<InviteUserResult> {
  // same method of generating a token as next-auth
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + TWO_WEEKS_IN_SECONDS * 1000);

  // create a workspace invite record and a verification request token that lasts for a week
  // here we use a try catch to account for the case where the user has already been invited
  // for which `prisma.projectInvite.create()` will throw a unique constraint error
  try {
    await prisma.projectInvite.create({
      data: {
        email,
        role,
        expires,
        projectId: workspace.id,
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return {
        status: "already_invited",
        email,
        message: `User ${email} has already been invited to this workspace.`,
      };
    }
    throw error;
  }

  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: await hashToken(token, { secret: true }),
      expires,
    },
  });

  const params = new URLSearchParams({
    callbackUrl: `${process.env.NEXTAUTH_URL}/${workspace.slug}/invite`,
    email,
    token,
  });

  const url = `${process.env.NEXTAUTH_URL}/api/auth/callback/email?${params}`;

  let result: Awaited<ReturnType<typeof sendEmail>>;
  try {
    result = await sendEmail({
      subject: "You've been invited to join a workspace on Dub",
      to: email,
      react: WorkspaceInvite({
        email,
        url,
        workspaceName: workspace.name,
        workspaceUser: session?.user.name || null,
        workspaceUserEmail: session?.user.email || null,
      }),
    });
  } catch (error) {
    return emailFailure(email, workspace.id, error);
  }

  // Resend resolves with an error object instead of rejecting the promise.
  // Keep the invitation valid for direct acceptance, but do not report delivery success.
  if (!result || ("error" in result && result.error)) {
    return emailFailure(
      email,
      workspace.id,
      result && "error" in result ? result.error : undefined,
    );
  }

  return { status: "sent", email };
}
