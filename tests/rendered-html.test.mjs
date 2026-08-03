import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("builds the German Opportunity Copilot shell", async () => {
  const [layout, workspace, page] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/opportunity-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /<html lang="de"/i);
  assert.match(layout, /title: "AIDA Opportunity Copilot"/);
  assert.match(workspace, /AIDA Opportunity Copilot/);
  assert.match(workspace, /geschützte Arbeitsbereich/);
  assert.match(page, /<OpportunityWorkspace \/>/);
  assert.doesNotMatch(`${layout}${workspace}${page}`, /Your site is taking shape|Starter Project|codex-preview/);
});

test("keeps context isolation and ACTION instructions in server-only code", async () => {
  const [workspace, chat, page, packageJson] = await Promise.all([
    readFile(new URL("../app/opportunity-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /Aktive Verkaufschance/);
  assert.match(workspace, /Kontext geschützt/);
  assert.match(workspace, /KI-Arbeitsbereich/);
  assert.match(chat, /ACTION\\n\\nAim/);
  assert.match(chat, /Work exclusively with the ACTIVE OPPORTUNITY SNAPSHOT/);
  assert.match(chat, /cloudProcessingConfirmed: false/);
  assert.match(page, /<OpportunityWorkspace \/>/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(workspace, /AIDA_SERVICE_TOKEN|authorization:\s*`Bearer/);
});
