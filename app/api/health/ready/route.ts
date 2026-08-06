import { ensureDatabase, pool } from "../../../../db";

export async function GET() {
  try {
    await ensureDatabase();
    await pool().query("SELECT 1");
    return Response.json({ status: "ready", version: process.env.CRM_VERSION || "development" }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ status: "not-ready" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
