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
  const [workspace, chat, database, schema, assistantApi, packageJson] = await Promise.all([
    readFile(new URL("../app/opportunity-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
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
  assert.match(database, /definition\[7\]/);
  assert.match(schema, /WHEN 'offer-author' THEN true/);
  assert.match(schema, /ELSE false/);
  assert.match(chat, /function aidaErrorMessage/);
  assert.match(chat, /Object\.values\(candidate\.errors\)/);
  assert.match(chat, /application\/x-ndjson/);
  assert.match(chat, /type: "progress"/);
  assert.match(chat, /\.svc\\\.cluster\\\.local/);
  assert.match(workspace, /response\.body\.getReader\(\)/);
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
  const [schema, manifest, deployment, serviceAccount, runtimeSecret, values, nextConfig, exampleEnv, apiUser, documents, workflow, dockerfile] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../deploy/olares/aidacrm/OlaresManifest.yaml", import.meta.url), "utf8"),
    readFile(new URL("../deploy/olares/aidacrm/templates/app.yaml", import.meta.url), "utf8"),
    readFile(new URL("../deploy/olares/aidacrm/templates/service-account.yaml", import.meta.url), "utf8"),
    readFile(new URL("../deploy/olares/aidacrm/templates/runtime-secret.yaml", import.meta.url), "utf8"),
    readFile(new URL("../deploy/olares/aidacrm/values.yaml", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.dev.vars.example", import.meta.url), "utf8"),
    readFile(new URL("../app/api-user.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/documents.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deliver.yml", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  ]);
  assert.match(manifest, /allowMultipleInstall: true/);
  assert.match(manifest, /middleware:\n  postgres:/);
  assert.match(manifest, /AIDA_SERVICE_TOKEN/);
  assert.match(deployment, /serviceAccountName: \{\{ include "aidacrm\.fullname" \. \}\}/);
  assert.match(deployment, /automountServiceAccountToken: true/);
  assert.match(serviceAccount, /kind: ServiceAccount/);
  assert.doesNotMatch(serviceAccount, /kind: (Role|RoleBinding|ClusterRole)/);
  assert.doesNotMatch(deployment, /runAsUser: 0|hostPath:|CRM_DOCUMENT_ROOT/);
  assert.match(deployment, /runAsNonRoot: true/);
  assert.match(runtimeSecret, /CRM_POSTGRES_HOST/);
  assert.match(values, /repository: ghcr\.io\/rmacek\/aida-academy-mini-crm/);
  assert.match(schema, /kind varchar\(60\) NOT NULL/);
  assert.match(schema, /content bytea NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS assistant_definitions/);
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(exampleEnv, /CRM_BOOTSTRAP_ADMIN_PASSWORD=iqx4academy2026\./);
  assert.match(apiUser, /CRM_PUBLIC_ORIGIN/);
  assert.match(apiUser, /x-forwarded-host/);
  assert.match(documents, /await import\("pdf-parse"\)/);
  assert.match(documents, /declared === "application\/octet-stream"/);
  assert.match(documents, /return declared === inferred \? inferred : null/);
  assert.doesNotMatch(documents, /^import .* from "pdf-parse"/m);
  assert.match(workflow, /repository_name="\$\{GITHUB_REPOSITORY##\*\/\}"/);
  assert.match(workflow, /branches:\n\s+- 'aida\/release-\*'/);
  assert.match(workflow, /outputs:\n\s+version: \$\{\{ steps\.version\.outputs\.value \}\}/);
  assert.match(workflow, /VERSION: \$\{\{ needs\.validate\.outputs\.version \}\}/);
  assert.match(workflow, /image_repository="ghcr\.io\/\$\{GITHUB_REPOSITORY_OWNER,,\}\/\$\{repository_name,,\}"/);
  assert.match(workflow, /--build-arg SOURCE_URL="https:\/\/github\.com\/\$GITHUB_REPOSITORY"/);
  assert.match(dockerfile, /org\.opencontainers\.image\.source="\$\{SOURCE_URL\}"/);
});
