import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function moduleUrl(path, replacements = {}) {
  let source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const [before, after] of Object.entries(replacements)) source = source.replaceAll(before, after);
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64');
}
const httpUrl = moduleUrl('../src/lib/http.ts');
const { apiFetch } = await import(httpUrl);
const { waitForTask } = await import(moduleUrl('../src/lib/tasks.ts', { "'./http'": JSON.stringify(httpUrl) }));

function browser(token = 'test-token') {
  const values = new Map(token ? [['auth_token', token]] : []);
  let redirected = null;
  globalThis.localStorage = { getItem: key => values.get(key) || null, removeItem: key => values.delete(key) };
  globalThis.window = { location: { assign: path => { redirected = path; } } };
  return { values, redirected: () => redirected };
}

test('authenticated fetch includes token and preserves headers', async () => {
  browser();
  globalThis.fetch = async (input, init) => {
    assert.equal(init.headers.get('Authorization'), 'Bearer test-token');
    assert.equal(init.headers.get('Content-Type'), 'application/json');
    return new Response('{}');
  };
  await apiFetch('https://example.test/api/signals/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
});

test('expired authentication clears the session and redirects', async () => {
  const state = browser();
  globalThis.fetch = async () => new Response('{}', { status: 401 });
  await apiFetch('https://example.test/api/stocks');
  assert.equal(state.values.has('auth_token'), false);
  assert.equal(state.redirected(), '/login');
});

test('invalid PIN does not redirect away from login', async () => {
  const state = browser();
  globalThis.fetch = async () => new Response('{}', { status: 401 });
  await apiFetch('https://example.test/api/auth/login', { method: 'POST' });
  assert.equal(state.redirected(), null);
});

test('task completion is based on server status', async () => {
  browser();
  globalThis.fetch = async () => Response.json({ status: 'completed', failed_count: 0, success_count: 5 });
  assert.equal((await waitForTask('task', new AbortController().signal)).success_count, 5);
});

test('partial and failed tasks never report success', async () => {
  browser();
  for (const task of [{ status: 'completed', failed_count: 2 }, { status: 'failed', error_message: 'source unavailable' }]) {
    globalThis.fetch = async () => Response.json(task);
    await assert.rejects(waitForTask('task', new AbortController().signal));
  }
});

test('aborted polling stops immediately', async () => {
  browser();
  globalThis.fetch = async () => Response.json({ status: 'running' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(waitForTask('task', controller.signal), { name: 'AbortError' });
});
