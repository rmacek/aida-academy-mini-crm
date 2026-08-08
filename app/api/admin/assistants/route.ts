import { currentApiUser, forbidden, requireSameOrigin, unauthorized } from "../../../api-user";
import { query, transaction } from "../../../../db";

type Input = {
  key?: string;
  displayName?: string;
  description?: string;
  starterPrompt?: string;
  actionInstructions?: string;
  outputLabel?: string | null;
  createsArtifact?: boolean;
  usesProductKnowledge?: boolean;
  modelProfileName?: string | null;
  active?: boolean;
};

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const actor = await currentApiUser();
  if (!actor) return unauthorized();
  if (actor.role !== "admin" || actor.mustChangePassword) return forbidden();
  const input = await request.json().catch(() => ({})) as Input;
  const key = validKey(input.key);
  const displayName = validText(input.displayName, 2, 120);
  const description = validText(input.description, 10, 500);
  const starterPrompt = validText(input.starterPrompt, 10, 2000);
  const actionInstructions = validActionPrompt(input.actionInstructions);
  const outputLabel = optionalText(input.outputLabel, 180);
  const modelProfileName = optionalText(input.modelProfileName, 180);
  if (!key || !displayName || !description || !starterPrompt || !actionInstructions
      || typeof input.createsArtifact !== "boolean" || typeof input.usesProductKnowledge !== "boolean"
      || typeof input.active !== "boolean") {
    return Response.json({ error: "validation_failed", message: "Bitte prüfen Sie alle Assistentenfelder und die ACTION-Struktur." }, { status: 400 });
  }
  const existing = await query<{ key: string }>(
    "SELECT assistant_key AS key FROM assistant_definitions WHERE assistant_key=$1", [key]);
  if (!existing.rowCount) return Response.json({ error: "assistant_not_found" }, { status: 404 });
  await transaction(async client => {
    await client.query(
      `UPDATE assistant_definitions SET display_name=$1,description=$2,starter_prompt=$3,
       action_instructions=$4,output_label=$5,creates_artifact=$6,uses_product_knowledge=$7,
       model_profile_name=$8,active=$9,updated_at=now() WHERE assistant_key=$10`,
      [displayName, description, starterPrompt, actionInstructions, outputLabel,
        input.createsArtifact, input.usesProductKnowledge, modelProfileName, input.active, key],
    );
    await client.query(
      `INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,outcome,details)
       VALUES ($1,'assistant.update','assistant',$2,'succeeded',$3::jsonb)`,
      [actor.userId, key, JSON.stringify({ active: input.active, modelProfileName,
        createsArtifact: input.createsArtifact, usesProductKnowledge: input.usesProductKnowledge })],
    );
  });
  return Response.json({ ok: true });
}

function validKey(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9-]{2,59}$/.test(text) ? text : null;
}
function validText(value: unknown, min: number, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length >= min && text.length <= max ? text : null;
}
function optionalText(value: unknown, max: number) {
  if (value === null || value === undefined || value === "") return null;
  return validText(value, 1, max);
}
function validActionPrompt(value: unknown) {
  const text = validText(value, 80, 8_000);
  if (!text) return null;
  const headings = ["ACTION", "Act", "Context", "Task", "Instructions", "Output", "Narrowing"];
  return headings.every(heading => new RegExp(`(^|\\n)${heading}\\s*($|\\n)`, "i").test(text)) ? text : null;
}
