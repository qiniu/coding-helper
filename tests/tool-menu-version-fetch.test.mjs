import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMissingLatestVersionDisplayKey,
  isLatestVersionFetchPending,
} from '../dist/lib/wizard/menus/tool-menu.js';

test('version fetch is not pending after it completed without a latest version', () => {
  assert.equal(
    isLatestVersionFetchPending({ fetchPromise: Promise.resolve(null), fetchCompleted: true }),
    false,
  );
});

test('version fetch remains pending before the initial request completes', () => {
  assert.equal(
    isLatestVersionFetchPending({ fetchPromise: new Promise(() => {}), fetchCompleted: false }),
    true,
  );
});

test('latest version display is unknown after fetch completed without a version', () => {
  assert.equal(getMissingLatestVersionDisplayKey(true), 'tool_version_unknown');
});

test('latest version display is checking while fetch is pending', () => {
  assert.equal(getMissingLatestVersionDisplayKey(false), 'tool_version_checking');
});
