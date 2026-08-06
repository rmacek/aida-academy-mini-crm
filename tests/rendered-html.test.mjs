import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("builds a German, multi-user CRM shell", async () => {
  const [layout, workspace, page, repository, actions, documentRoute] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/opportunity-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/actions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/documents/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /<html lang="de"/i);
  assert.match(layout, /title: "AIDA CRM"/);
  assert.match(workspace, /AIDA CRM/);
  assert.match(workspace, /CRM-Benutzer/);
  assert.match(workspace, /Vorkonfigurierte KI-Assistenten/);
  assert.match(workspace, /Kunden-UseCase/);
  assert.match(workspace, /Pipeline-Dashboard/);
  assert.match(workspace, /Überfälliger Handlungsbedarf/);
  assert.match(workspace, /Nächste offene Aufgaben/);
  assert.match(workspace, /body\.action === "create-opportunity"/);
  assert.match(workspace, /newInitialPassword/);
  assert.match(actions, /update-activity/);
  assert.match(documentRoute, /export async function DELETE/);
  assert.match(repository, /canManageAssistants/);
  assert.match(page, /<OpportunityWorkspace \/>/);
  assert.doesNotMatch(`${layout}${workspace}${page}`, /Your site is taking shape|Starter Project|codex-preview/);
});

test("loads CRM assistants dynamically and keeps the AIDA token server-side", async () => {
  const [workspace, chat, database, assistantApi, packageJson] = await Promise.all([
    readFile(new URL("../app/opportunity-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/assistants/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /Aktive Verkaufschance/);
  assert.match(workspace, /Kontext geschützt/);
  assert.match(workspace, /KI-Arbeitsbereich/);
  assert.match(chat, /FROM assistant_definitions WHERE assistant_key=\$1 AND active/);
  assert.match(chat, /Work exclusively with the ACTIVE OPPORTUNITY SNAPSHOT/);
  assert.match(chat, /cloudProcessingConfirmed: false/);
  assert.match(database, /function assistantActionPrompt/);
  assert.match(database, /return `ACTION\n/);
  for (const heading of ["Act", "Context", "Task", "Instructions", "Output", "Narrowing"]) {
    assert.match(database, new RegExp(`\\n${heading}\\n`));
  }
  assert.match(assistantApi, /UPDATE assistant_definitions/);
  assert.match(assistantApi, /assistant\.update/);
  assert.doesNotMatch(chat, /switch\s*\(.*assistant|case\s+["']feasibility/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(workspace, /AIDA_SERVICE_TOKEN|authorization:\s*`Bearer/);
});

test("packages an independently installable PostgreSQL-backed Marketplace app", async () => {
  const [schema, manifest, deployment, runtimeSecret, values, nextConfig, exampleEnv, apiUser, documents] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../deploy/olares/aidacrm/OlaresManifest.yaml", import.meta.url), "utf8"),
    readFile(new URL("../deploy/olares/aidacrm/templates/app.yaml", import.meta.url), "utf8"),
    readFile(new URL("../deploy/olares/aidacrm/templates/runtime-secret.yaml", import.meta.url), "utf8"),
    readFile(new URL("../deploy/olares/aidacrm/values.yaml", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.dev.vars.example", import.meta.url), "utf8"),
    readFile(new URL("../app/api-user.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/documents.ts", import.meta.url), "utf8"),
  ]);
  assert.match(manifest, /allowMultipleInstall: true/);
  assert.match(manifest, /middleware:\n  postgres:/);
  assert.match(manifest, /AIDA_SERVICE_TOKEN/);
  assert.match(deployment, /automountServiceAccountToken: false/);
  assert.match(deployment, /runAsNonRoot: true/);
  assert.match(runtimeSecret, /CRM_POSTGRES_HOST/);
  assert.match(values, /repository: ghcr\.io\/rmacek\/aida-academy-mini-crm/);
  assert.match(schema, /kind varchar\(60\) NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS assistant_definitions/);
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(exampleEnv, /CRM_BOOTSTRAP_ADMIN_PASSWORD=iqx4academy2026\./);
  assert.match(apiUser, /CRM_PUBLIC_ORIGIN/);
  assert.match(apiUser, /x-forwarded-host/);
  assert.match(documents, /await import\("pdf-parse"\)/);
  assert.doesNotMatch(documents, /^import .* from "pdf-parse"/m);
});
