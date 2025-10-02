import { AuthLayout } from "@/ui/layout/auth-layout";
import { APP_DOMAIN, constructMetadata } from "@dub/utils";
import { redirect } from "next/navigation";
// import RegisterPageClient from "./page-client";

export const metadata = constructMetadata({
  title: `Create your ${process.env.NEXT_PUBLIC_APP_NAME} account`,
  canonicalUrl: `${APP_DOMAIN}/register`,
});

// export default function RegisterPage() {
//   return (
//     <AuthLayout showTerms="app">
//       <RegisterPageClient />
//     </AuthLayout>
//   );
// }
// Redirect all access to /register to /login
export default function RegisterPage() {
  redirect("/login");
}
