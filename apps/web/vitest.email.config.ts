import { fileURLToPath } from "node:url";

// Keep these mocked unit tests independent of Prisma generation and live services.
export default {
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "@dub/email": fileURLToPath(
        new URL("../../packages/email/src", import.meta.url),
      ),
      "@dub/utils": fileURLToPath(
        new URL("../../packages/utils/src", import.meta.url),
      ),
    },
  },
  test: {
    include: [
      "tests/email/resend-sender.test.ts",
      "tests/email/workspace-invite.test.ts",
      "tests/email/workspace-invite-route.test.ts",
    ],
    environment: "node",
  },
};
