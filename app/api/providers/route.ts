import { getProviderStatuses } from "@/app/api/_lib/providers";

export async function GET() {
  return Response.json({ providers: getProviderStatuses() });
}
