import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ENDPOINT,
  ENDPOINT_DEFINITIONS,
  getBaseUrl,
  normalizeEndpointId,
} from '../dist/lib/endpoints.js';

test('normalizeEndpointId maps legacy modelink id to international', () => {
  // 老用户配置里的 modelink 应规范化到新的海外线路 id
  assert.equal(normalizeEndpointId('modelink'), 'international');
});

test('getBaseUrl keeps legacy modelink users on api.modelink.ai', () => {
  // 关键回归：老 Modelink 用户升级后地址不应漂移到国内线路
  assert.equal(getBaseUrl('modelink'), 'https://api.modelink.ai');
});

test('normalizeEndpointId maps legacy qiniu id to china', () => {
  assert.equal(normalizeEndpointId('qiniu'), 'china');
  assert.equal(getBaseUrl('qiniu'), 'https://api.qnaigc.com');
});

test('normalizeEndpointId returns current ids unchanged', () => {
  assert.equal(normalizeEndpointId('china'), 'china');
  assert.equal(normalizeEndpointId('international'), 'international');
});

test('getBaseUrl falls back to default endpoint for unknown ids', () => {
  const expected = ENDPOINT_DEFINITIONS[DEFAULT_ENDPOINT].baseUrl;
  assert.equal(getBaseUrl('unknown-endpoint'), expected);
});
