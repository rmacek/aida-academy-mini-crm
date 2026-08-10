import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const repositoryRoot = new URL('..', new URL('.', import.meta.url));

// PostgreSQL Concurrency Test
async function runPostgreSQLConcurrencyTest() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // Skip test if DATABASE_URL is not present, as per repository convention
    return;
  }

  const pg = await import('pg');
  const client1 = new pg.default.Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
});
  const client2 = new pg.default.Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
});

  const tableName = `active_admins_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  assert.match(tableName, /^[a-z_][a-z0-9_]*$/);
  const lockKey = (BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1000000))).toString();
  const client1AdminId = 'client-1-admin';
  const client2AdminId = 'client-2-admin';
  let client1Connected = false;
  let client2Connected = false;
  let tableCreated = false;
  let client2LockPromise;
  let testError;

  try {
    await client1.connect();
    client1Connected = true;
    await client1.query('SET statement_timeout = 5000;');
    await client1.query('SET lock_timeout = 5000;');
    await client1.query('SET idle_in_transaction_session_timeout = 5000;');

    await client2.connect();
    client2Connected = true;
    await client2.query('SET statement_timeout = 5000;');
    await client2.query('SET lock_timeout = 5000;');
    await client2.query('SET idle_in_transaction_session_timeout = 5000;');

    await client1.query(
      `CREATE TABLE ${tableName} (id TEXT PRIMARY KEY, active BOOLEAN NOT NULL, rollback_marker TEXT);`,
    );
    tableCreated = true;

    const inserted = await client1.query(
      `INSERT INTO ${tableName} (id, active, rollback_marker) VALUES ($1, true, NULL), ($2, true, NULL);`,
      [client1AdminId, client2AdminId],
    );
    assert.equal(inserted.rowCount, 2);

    await client1.query('BEGIN;');
    await client1.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint);', [lockKey]);

    const client1OtherAdmins = await client1.query(
      `SELECT COUNT(*) FROM ${tableName} WHERE active = true AND id <> $1;`,
      [client1AdminId],
    );
    assert.equal(Number(client1OtherAdmins.rows[0].count), 1);

    const client1Update = await client1.query(
      `UPDATE ${tableName} AS target
       SET active = false
       WHERE target.id = $1
         AND target.active = true
         AND EXISTS (
           SELECT 1
           FROM ${tableName} AS other
           WHERE other.active = true AND other.id <> target.id
         );`,
      [client1AdminId],
    );
    assert.equal(client1Update.rowCount, 1);

    await client2.query('BEGIN;');
    let client2LockSettled = false;
    client2LockPromise = client2
      .query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint);', [lockKey])
      .then(
        result => {
          client2LockSettled = true;
          return result;
        },
        error => {
          client2LockSettled = true;
          throw error;
        },
      );

    // Poll pg_locks to observe the lock state deterministically
    const observer = new pg.default.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });
    let observerError;

    try {
      await observer.connect();
      await observer.query('SET statement_timeout = 5000;');
      await observer.query('SET lock_timeout = 5000;');
      await observer.query('SET idle_in_transaction_session_timeout = 5000;');

      let lockObserved = false;
      let lockCheckAttempts = 0;
      const maxAttempts = 100; // 100 * 10ms = 1 second maximum wait

      while (!lockObserved && lockCheckAttempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10));
        lockCheckAttempts++;

        const locks = await observer.query(
          `SELECT waiter.pid AS waiter_pid, holder.pid AS holder_pid
           FROM pg_locks AS waiter
           JOIN pg_locks AS holder
             ON holder.locktype IS NOT DISTINCT FROM waiter.locktype
            AND holder.database IS NOT DISTINCT FROM waiter.database
            AND holder.classid IS NOT DISTINCT FROM waiter.classid
            AND holder.objid IS NOT DISTINCT FROM waiter.objid
            AND holder.objsubid IS NOT DISTINCT FROM waiter.objsubid
           WHERE waiter.locktype = 'advisory'
             AND waiter.pid = $1
             AND holder.pid = $2
             AND waiter.granted = false
             AND holder.granted = true;`,
          [client2.processID, client1.processID],
        );

        if (locks.rows.length > 0) {
          lockObserved = true;
        }
      }

      assert.ok(
        lockObserved,
        'client 2 must not acquire the advisory lock before client 1 commits',
      );
    } catch (error) {
      observerError = error;
    } finally {
      try {
        await observer.end();
      } catch (error) {
        observerError = observerError
          ? new AggregateError([observerError, error], 'PostgreSQL observer and cleanup failed')
          : error;
      }
    }

    if (observerError) {
      throw observerError;
    }

    // Assert that the lock promise is still unsettled (i.e., client2 has not acquired it yet)
    assert.equal(client2LockSettled, false, 'lock promise should remain unsettled until COMMIT');

    await client1.query('COMMIT;');
    await client2LockPromise;

    const client2Update = await client2.query(
      `UPDATE ${tableName} AS target
       SET active = false
       WHERE target.id = $1
         AND target.active = true
         AND EXISTS (
           SELECT 1
           FROM ${tableName} AS other
           WHERE other.active = true AND other.id <> target.id
         );`,
      [client2AdminId],
    );
    assert.equal(client2Update.rowCount, 0);

    const markerUpdate = await client2.query(
      `UPDATE ${tableName} SET rollback_marker = $1 WHERE id = $2;`,
      ['client-2-rollback', client2AdminId],
    );
    assert.equal(markerUpdate.rowCount, 1);

    await client2.query('ROLLBACK;');

    const finalCheck = await client1.query(
      `SELECT id, rollback_marker FROM ${tableName} WHERE active = true;`,
    );
    assert.equal(finalCheck.rows.length, 1);
    assert.equal(finalCheck.rows[0].id, client2AdminId);
    assert.equal(finalCheck.rows[0].rollback_marker, null);
  } catch (error) {
    testError = error;
  } finally {
    const cleanupErrors = [];

    if (client1Connected) {
      try {
        await client1.query('ROLLBACK;');
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        await client1.end();
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        client1Connected = false;
      }
    }

    if (client2LockPromise) {
      try {
        await client2LockPromise;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (client2Connected) {
      try {
        await client2.query('ROLLBACK;');
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (tableCreated) {
      const cleanupClient = new pg.default.Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
      });
      try {
        await cleanupClient.connect();
        await cleanupClient.query('SET statement_timeout = 5000;');
        await cleanupClient.query('SET lock_timeout = 5000;');
        await cleanupClient.query('SET idle_in_transaction_session_timeout = 5000;');
        await cleanupClient.query(`DROP TABLE ${tableName};`);
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        try {
          await cleanupClient.end();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }

    if (client2Connected) {
      try {
        await client2.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (client1Connected) {
      try {
        await client1.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (cleanupErrors.length > 0) {
      testError = testError
        ? new AggregateError([testError, ...cleanupErrors], 'PostgreSQL concurrency test and cleanup failed')
        : new AggregateError(cleanupErrors, 'PostgreSQL concurrency test cleanup failed');
    }
  }

  if (testError) {
    throw testError;
  }
}

test(
  'serializes last-active-admin updates with a PostgreSQL advisory lock',
  {
    skip: process.env.DATABASE_URL
      ? false
      : 'DATABASE_URL is not set; PostgreSQL concurrency test skipped',
  },
  async () => {
    const databaseUrl = process.env.DATABASE_URL;
    let databaseName;

    try {
      const pathname = new URL(databaseUrl).pathname;
      databaseName = decodeURIComponent(pathname.replace(/^\/+/, ''));
    } catch {
      throw new Error('DATABASE_URL must have a valid, percent-decodable pathname');
    }

    if (!/(?:^|[-_])(?:test|validation|ci)(?:$|[-_])/i.test(databaseName)) {
      throw new Error(
        'Refusing to run PostgreSQL concurrency test: decoded database name must match /test|validation|ci/i',
      );
    }

    await runPostgreSQLConcurrencyTest();
  },
);

// Load schema and repository files using deterministic module-relative URLs
const schemaFile = new URL('db/schema.ts', repositoryRoot);
const repositoryFile = new URL('db/repository.ts', repositoryRoot);
const manifestFile = new URL('deploy/olares/aidacrm/OlaresManifest.yaml', repositoryRoot);

// Read files as text for assertions
const schemaContent = await readFile(schemaFile, 'utf8');
const repositoryContent = await readFile(repositoryFile, 'utf8');
const manifestContent = await readFile(manifestFile, 'utf8');

test(
  'migration seven repairs an installation that recorded migration four before the consent column existed',
  {
    skip: process.env.DATABASE_URL
      ? false
      : 'DATABASE_URL is not set; PostgreSQL upgrade test skipped',
  },
  async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ''));
    if (!/(?:^|[-_])(?:test|validation|ci)(?:$|[-_])/i.test(databaseName)) {
      throw new Error(
        'Refusing to run PostgreSQL upgrade test: decoded database name must match /test|validation|ci/i',
      );
    }

    const migrationMatch = schemaContent.match(
      /export const migrationSeven = `([\s\S]*?)`;/,
    );
    assert.ok(migrationMatch, 'migration seven SQL must be exported');

    const pg = await import('pg');
    const client = new pg.default.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });
    const schemaName = `migration_seven_${process.pid}_${Date.now()}`;
    assert.match(schemaName, /^[a-z_][a-z0-9_]*$/);

    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA ${schemaName}`);
      await client.query(`SET LOCAL search_path TO ${schemaName}`);
      await client.query(`
        CREATE TABLE assistant_definitions (
          key varchar(60) PRIMARY KEY,
          display_name varchar(120) NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE schema_migrations (
          version integer PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query('INSERT INTO schema_migrations(version) SELECT generate_series(1, 6)');

      const before = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'assistant_definitions'
          AND column_name = 'cloud_processing_confirmed'
      `, [schemaName]);
      assert.equal(before.rowCount, 0, 'the simulated legacy installation must lack the column');

      await client.query(migrationMatch[1]);
      await client.query('INSERT INTO schema_migrations(version) VALUES (7)');

      const after = await client.query(`
        SELECT is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'assistant_definitions'
          AND column_name = 'cloud_processing_confirmed'
      `, [schemaName]);
      assert.equal(after.rowCount, 1);
      assert.equal(after.rows[0].is_nullable, 'NO');
      assert.match(after.rows[0].column_default, /false/i);

      const versions = await client.query(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      assert.deepEqual(versions.rows.map(row => row.version), [1, 2, 3, 4, 5, 6, 7]);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  },
);

// Existing database and repository source-contract assertions

// Migration One Test
assert.ok(schemaContent.includes('migrationOne')); // AC-04

// Migration Two Test
assert.ok(schemaContent.includes('migrationTwo')); // AC-04

// Migration Three Test
assert.ok(schemaContent.includes('migrationThree')); // AC-04

// Migration Four Test
assert.ok(schemaContent.includes('migrationFour')); // AC-04

// Migration Five Test
assert.ok(schemaContent.includes('migrationFive')); // AC-04

// Migration Six Test
assert.ok(schemaContent.includes('migrationSix')); // AC-04
assert.ok(schemaContent.includes('migrationSeven')); // upgrade compatibility

// Core Tables Test
assert.ok(schemaContent.includes('opportunities')); // AC-04
assert.ok(schemaContent.includes('activities')); // AC-04
assert.ok(schemaContent.includes('documents')); // AC-04
assert.ok(schemaContent.includes('conversations')); // AC-04
assert.ok(schemaContent.includes('messages')); // AC-04
assert.ok(schemaContent.includes('artifacts')); // AC-04
assert.ok(schemaContent.includes('chat_dispatches')); // AC-04
assert.ok(schemaContent.includes('users')); // AC-04
assert.ok(schemaContent.includes('assistant_definitions')); // AC-04

// opportunity_id foreign key constraint test
assert.ok(schemaContent.includes('opportunity_id')); // AC-04

// canAccessOpportunity function test
assert.ok(repositoryContent.includes('canAccessOpportunity')); // AC-04

// canAccessConversation function test
assert.ok(repositoryContent.includes('canAccessConversation')); // AC-04

// parameterized query bindings test
assert.ok(repositoryContent.includes('$1')); // AC-04

// allowMultipleInstall flag test
assert.ok(manifestContent.includes('allowMultipleInstall')); // AC-04

// PostgreSQL middleware test
assert.ok(repositoryContent.includes('query')); // AC-04

test('cloud processing consent defaults false and is enforced by admin and chat APIs', async () => {
  const [adminAssistantsContent, chatRouteContent] = await Promise.all([
    readFile(new URL('app/api/admin/assistants/route.ts', repositoryRoot), 'utf8'),
    readFile(new URL('app/api/chat/route.ts', repositoryRoot), 'utf8'),
  ]);

  assert.match(
    schemaContent,
    /ALTER TABLE\s+assistant_definitions\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?cloud_processing_confirmed\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i,
    'cloud processing consent must be an additive, non-null Boolean that defaults to false',
  );
  assert.match(
    repositoryContent,
    /cloudProcessingConfirmed\s*:\s*Boolean\(row\.cloud_processing_confirmed\)/,
    'the repository must map the stored database Boolean explicitly',
  );
  assert.match(
    adminAssistantsContent,
    /(?:is|assert|require|enforce)SameOrigin\s*\(\s*request\s*\)/,
    'assistant administration must enforce same-origin requests',
  );
  assert.match(
    adminAssistantsContent,
    /canManageAssistants\s*\(/,
    'assistant administration must require assistant-management authorization',
  );
  assert.match(
    adminAssistantsContent,
    /typeof\s+(?:[A-Za-z_$][\w$]*\.)?cloudProcessingConfirmed\s*!==\s*["']boolean["']/,
    'assistant administration must reject non-Boolean consent values',
  );
  assert.match(
    chatRouteContent,
    /cloudProcessingConfirmed\s*:\s*[A-Za-z_$][\w$]*\.cloudProcessingConfirmed\b/,
    'chat dispatch must use the exact stored assistant consent Boolean',
  );
});

test('admin user route rejects non-object parsed JSON before action access', async () => {
  const routeContent = await readFile(
    new URL('app/api/admin/users/route.ts', repositoryRoot),
    'utf8',
  );
  const orderedSource = [
    'const parsedInput: unknown = await request.json().catch(() => ({}));',
    'if (typeof parsedInput !== "object" || parsedInput === null || Array.isArray(parsedInput)) {',
    'return Response.json({ error: "validation_failed" }, { status: 400 });',
    'const input = parsedInput as Input;',
    'if (input.action === "create") return createUser(actor.userId, input);',
  ];
  let cursor = 0;

  for (const source of orderedSource) {
    const index = routeContent.indexOf(source, cursor);
    assert.notEqual(index, -1, `Missing or out-of-order route guard source: ${source}`);
    cursor = index + source.length;
  }

  function parsedInputResponse(parsedInput) {
    if (typeof parsedInput !== 'object' || parsedInput === null || Array.isArray(parsedInput)) {
      return { error: 'validation_failed', status: 400 };
    }
    return null;
  }

  for (const body of [null, [], 'create', 1, true]) {
    assert.deepEqual(parsedInputResponse(body), { error: 'validation_failed', status: 400 });
  }

  assert.equal(parsedInputResponse({ action: 'create' }), null);
});
