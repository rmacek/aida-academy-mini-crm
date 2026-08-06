export function GET() {
  return Response.json({ status: "live", version: process.env.CRM_VERSION || "development" }, {
    headers: { "cache-control": "no-store" },
  });
}
