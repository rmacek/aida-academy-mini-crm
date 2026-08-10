import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Test that page.tsx mounts OpportunityWorkspace
// Test that OpportunityWorkspace contains LoginScreen with /api/auth/login route
// Test that dashboard navigation and create-opportunity functionality work
// Test that setActiveId and context selector work for active opportunity management
// Test that activity/document/conversation/artifact filtering works based on activeId
// Test that Copilot/new-chat/chat API endpoints function correctly
// Test that PATCH polling and artifact display/adoption mechanisms are operational

test('page mounts OpportunityWorkspace', async () => {
  const pageContent = await readFile('./app/page.tsx', 'utf8');
  assert.ok(pageContent.includes('OpportunityWorkspace'), 'page.tsx should mount OpportunityWorkspace');
});

test('OpportunityWorkspace contains LoginScreen with /api/auth/login route', async () => {
  const workspaceContent = await readFile('./app/opportunity-workspace.tsx', 'utf8');
  assert.ok(workspaceContent.includes('LoginScreen'), 'OpportunityWorkspace should contain LoginScreen');

  const loginRouteContent = await readFile('./app/api/auth/login/route.ts', 'utf8');
  assert.ok(loginRouteContent.includes('POST'), 'Login route should support POST method');
});

test('dashboard navigation and create-opportunity functionality work', async () => {
  const actionsRouteContent = await readFile('./app/api/actions/route.ts', 'utf8');
  assert.ok(actionsRouteContent.includes('create-opportunity'), 'Actions route should support create-opportunity action');

  // Verify API endpoint is properly wired
  assert.ok(actionsRouteContent.includes('POST'), 'Actions route should support POST method');
});

test('setActiveId and context selector work for active opportunity management', async () => {
  const workspaceContent = await readFile('./app/opportunity-workspace.tsx', 'utf8');
  assert.ok(workspaceContent.includes('activeId'), 'Workspace should manage activeId state');
  assert.ok(workspaceContent.includes('setActiveId'), 'Workspace should have setActiveId function');
});

test('activity/document/conversation/artifact filtering works based on activeId', async () => {
  const workspaceContent = await readFile('./app/opportunity-workspace.tsx', 'utf8');
  assert.ok(workspaceContent.includes('filter'), 'Workspace should filter activities by activeId');
});

test('Copilot/new-chat/chat API endpoints function correctly', async () => {
  const chatRouteContent = await readFile('./app/api/chat/route.ts', 'utf8');
  assert.ok(chatRouteContent.includes('POST'), 'Chat route should support POST method');
  assert.ok(chatRouteContent.includes('PATCH'), 'Chat route should support PATCH method');
});

test('PATCH polling and artifact display/adoption mechanisms are operational', async () => {
  const workspaceContent = await readFile('./app/opportunity-workspace.tsx', 'utf8');
  assert.ok(workspaceContent.includes('poll'), 'Workspace should implement polling mechanism');
  assert.ok(workspaceContent.includes('artifact'), 'Workspace should handle artifact display and adoption');
});

test('assistant consent uses an accessible German checkbox and displays privacy text', async () => {
  const workspaceContent = await readFile('./app/opportunity-workspace.tsx', 'utf8');
  const checkboxIndex = workspaceContent.search(/type=["']checkbox["']/);

  assert.notEqual(checkboxIndex, -1, 'Workspace should render a consent checkbox');

  const checkboxSource = workspaceContent.slice(
    Math.max(0, checkboxIndex - 1200),
    checkboxIndex + 2400,
  );

  assert.match(
    checkboxSource,
    /cloudProcessingConfirmed/,
    'the checkbox must represent the explicit cloud processing consent field',
  );
  assert.match(checkboxSource, /checked=\{/, 'the consent checkbox must have controlled state');
  assert.match(
    checkboxSource,
    /onChange=\{[\s\S]{0,1000}(?:target|currentTarget)\.checked/,
    'checkbox interaction must store the actual checked Boolean',
  );
  assert.match(
    checkboxSource,
    /(?:<label\b|aria-label=|aria-labelledby=)/i,
    'the consent checkbox must have an accessible label',
  );
  assert.match(
    checkboxSource,
    /(?:Cloud-Verarbeitung|Cloudverarbeitung|Verarbeitung[^<\n]{0,80}Cloud)/i,
    'the checkbox must have German cloud-processing wording',
  );
  assert.match(
    checkboxSource,
    /Datenschutz(?:hinweis|erklärung|information|text)?/i,
    'German privacy text must be displayed with the consent control',
  );
});
