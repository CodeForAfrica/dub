export const VARIANT_TO_FROM_MAP = {
  primary: process.env.EMAIL_FROM_PRIMARY || "Dub.co <system@dub.co>",
  notifications: process.env.EMAIL_FROM_NOTIFICATIONS || "Dub.co <notifications@mail.dub.co>",
  marketing: process.env.EMAIL_FROM_MARKETING || "Steven from Dub.co <steven@ship.dub.co>",
};
