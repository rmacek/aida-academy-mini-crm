import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Test that UI sources exist
await test('UI sources exist', async () => {
  const paths = [
    'app/layout.tsx',
    'app/page.tsx',
    'app/opportunity-workspace.tsx',
    'app/globals.css'
  ];

  for (const path of paths) {
    await fs.access(path);
  }
});

// Test semantic HTML structure and accessibility attributes
await test('Semantic HTML structure and accessibility attributes', async () => {
  const layoutContent = await fs.readFile('app/layout.tsx', 'utf8');
  const workspaceContent = await fs.readFile('app/opportunity-workspace.tsx', 'utf8');
  const cssContent = await fs.readFile('app/globals.css', 'utf8');

  // Verify HTML lang attribute is set to 'de'
  assert.ok(layoutContent.includes('<html lang="de">'), 'HTML should have lang attribute set to de');

  // Verify native main and h1 elements exist in workspace
  assert.ok(workspaceContent.includes('<main'), 'Workspace should contain a main element');
  assert.ok(workspaceContent.includes('<h1'), 'Workspace should contain an h1 element');

  // Verify navigation has aria-label 'Hauptnavigation'
  assert.ok(workspaceContent.includes('aria-label="Hauptnavigation"'), 'Navigation should have aria-label Hauptnavigation');

  // Verify role attributes for dialog/alert components
  assert.ok(workspaceContent.includes('role="dialog"') || workspaceContent.includes('role="alert"'), 'Dialog or alert components should have appropriate role attribute');

  // Verify aria-modal is present for modal dialogs
  assert.ok(workspaceContent.includes('aria-modal="true"'), 'Modal dialogs should have aria-modal=true');

  // Verify focus-visible styles are defined in CSS
  assert.ok(cssContent.includes(':focus-visible'), 'Focus visible styles must be defined');

  // Verify prefers-reduced-motion media queries exist
  assert.ok(cssContent.includes('@media (prefers-reduced-motion:reduce)'), 'Prefers reduced motion media query should be present');

  // Verify responsive CSS at 1050px breakpoint
  assert.ok(cssContent.includes('@media (max-width:1050px)'), 'Responsive CSS at 1050px breakpoint should be present');

  // Verify responsive CSS at 760px breakpoint
  assert.ok(cssContent.includes('@media (max-width:760px)'), 'Responsive CSS at 760px breakpoint should be present');
});