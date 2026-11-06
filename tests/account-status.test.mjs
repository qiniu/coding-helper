import assert from 'node:assert/strict';
import test from 'node:test';
const { checkAccountStatus, validateApiKey } = await import('../dist/lib/api-validator.js');
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
test('account probe uses an available model and one output token', async () => {
  let count = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fake');
    if (++count === 1) return response({ data: [{ id: 'available-model' }] });
    assert.match(url, /chat\/completions$/);
    assert.equal(JSON.parse(options.body).model, 'available-model');
    assert.equal(JSON.parse(options.body).max_tokens, 1);
    return response({ choices: [] });
  };
  assert.deepEqual(await checkAccountStatus('fake', 'http://localhost'), { usable: true });
});
test('billing suspension is a failure while model and transport failures are unknown', async () => {
  for (const [status, code, usable] of [[402, 'account_billing_suspended', false], [403, 'denied', false], [502, 'model_unavailable', null]]) {
    let count = 0;
    globalThis.fetch = async () => ++count === 1 ? response({ data: [{ id: 'model' }] }) : response({ error: { code } }, status);
    assert.deepEqual(await checkAccountStatus('fake', 'http://localhost'), { usable, code });
  }
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal((await checkAccountStatus('fake', 'http://localhost')).usable, null);
  assert.equal((await validateApiKey('fake', 'http://localhost')).valid, false);
});
test('empty and malformed model lists never claim success or issue a model request', async () => {
  for (const data of [[], null, [{ id: null }]]) {
    let count = 0;
    globalThis.fetch = async () => { count++; return response({ data }); };
    assert.equal((await checkAccountStatus('fake', 'http://localhost')).usable, null);
    assert.equal(count, 1);
  }
});

test('model-list billing and authentication denials fail before any model request', async () => {
  for (const [status, code, usable] of [[402,'account_billing_suspended',false],[402,undefined,false],[403,'denied',false],[503,'temporarily_unavailable',null]]) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return response({ error: { code } }, status); };
    const result = await checkAccountStatus('fake','http://localhost');
    assert.equal(result.usable, usable);
    assert.equal(calls, 1);
  }
});
