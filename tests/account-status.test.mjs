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

test('configured models take priority over stale listed models and recommendations', async () => {
  const probed = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/v1/models')) return response({ data: ['qwen-turbo', 'deepseek/deepseek-v4-flash', 'z-ai/glm-5.2'].map(id => ({ id })) });
    probed.push(JSON.parse(options.body).model);
    return response({ choices: [] });
  };
  assert.deepEqual(await checkAccountStatus('fake', 'http://localhost', ['z-ai/glm-5.2']), { usable: true });
  assert.deepEqual(probed, ['z-ai/glm-5.2']);
});

test('default probes reuse current recommendations instead of preferring qwen-turbo', async () => {
  const probed = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/v1/models')) return response({ data: ['qwen-turbo', 'z-ai/glm-5.2'].map(id => ({ id })) });
    probed.push(JSON.parse(options.body).model);
    return response({ choices: [] });
  };
  assert.deepEqual(await checkAccountStatus('fake', 'http://localhost'), { usable: true });
  assert.deepEqual(probed, ['z-ai/glm-5.2']);
});

for (const status of [400, 404, 422, 500, 502, 503, 504]) {
  test('model failure falls back to another listed model: HTTP ' + status, async () => {
    const probed = [];
    const signals = [];
    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/v1/models')) return response({ data: ['retired-model', 'working-model'].map(id => ({ id })) });
      probed.push(JSON.parse(options.body).model);
      signals.push(options.signal);
      assert.equal(JSON.parse(options.body).max_tokens, 1);
      return probed.length === 1
        ? response({ error: { message: 'Model has been retired', type: 'upstream_error' } }, status)
        : response({ choices: [] });
    };
    assert.deepEqual(await checkAccountStatus('fake', 'http://localhost', ['retired-model']), { usable: true });
    assert.deepEqual(probed, ['retired-model', 'working-model']);
    assert.equal(signals[0], signals[1], 'fallback requests share one timeout');
  });
}

test('fallback skips unlisted preferences, deduplicates models and stops after three attempts', async () => {
  const probed = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/v1/models')) return response({ data: ['a', 'a', 'b', 'c', 'd'].map(id => ({ id })) });
    probed.push(JSON.parse(options.body).model);
    return response({ error: { code: 'model_unavailable' } }, 502);
  };
  assert.deepEqual(await checkAccountStatus('fake', 'http://localhost', ['unlisted', 'a', 'a']), { usable: null, code: 'model_unavailable' });
  assert.deepEqual(probed, ['a', 'b', 'c']);
});

test('authentication, billing and rate limits stop without trying another model', async () => {
  for (const [status, code, usable] of [[401, 'invalid_key', false], [402, 'insufficient_balance', false], [403, 'denied', false],
    [502, 'account_billing_suspended', false], [429, 'rate_limit_exceeded', null]]) {
    const probed = [];
    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/v1/models')) return response({ data: ['a', 'b', 'c'].map(id => ({ id })) });
      probed.push(JSON.parse(options.body).model);
      return response({ error: { code } }, status);
    };
    assert.deepEqual(await checkAccountStatus('fake', 'http://localhost'), { usable, code });
    assert.deepEqual(probed, ['a']);
  }
});

test('network failures remain unknown and do not issue more model requests', async () => {
  let probes = 0;
  globalThis.fetch = async url => {
    if (url.endsWith('/v1/models')) return response({ data: ['a', 'b'].map(id => ({ id })) });
    probes++;
    throw Error('network error with private detail');
  };
  assert.deepEqual(await checkAccountStatus('fake', 'http://localhost'), { usable: null, code: 'probe_unavailable' });
  assert.equal(probes, 1);
});

test('billing errors after a model fallback are not hidden by another successful model', async () => {
  const probed = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/v1/models')) return response({ data: ['retired', 'billing-denied', 'working'].map(id => ({ id })) });
    probed.push(JSON.parse(options.body).model);
    return probed.length === 1 ? response({}, 502) : response({ error: { code: 'account_billing_suspended' } }, 403);
  };
  assert.deepEqual(await checkAccountStatus('fake', 'http://localhost'), { usable: false, code: 'account_billing_suspended' });
  assert.deepEqual(probed, ['retired', 'billing-denied']);
});
