export const VARIANT_TO_FROM_MAP = {
  primary: process.env.EMAIL_FROM_PRIMARY || "Support from CfA <support@codeforafrica.org>",
  notifications: process.env.EMAIL_FROM_NOTIFICATIONS || "Support from CfA <support@codeforafrica.org>",
  marketing: process.env.EMAIL_FROM_MARKETING || "Support from CfA <support@codeforafrica.org>",
};
