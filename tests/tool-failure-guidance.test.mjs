import assert from 'node:assert/strict';import test from 'node:test';
import {safeToolFailureReason} from '../dist/lib/wizard/ui/tool-results.js';
test('recovery diagnostics remain useful without returning raw configuration content',()=>{
 for(const [message,key]of [['No restoration record for existing Claude configuration.','tool_failure_unrecorded'],['Legacy state requires recovery before configuration.','tool_failure_recovery'],['Configuration directory changed. Restore the recorded files first.','tool_failure_path'],['Configuration changed before writing: /tmp/client.json','tool_failure_retry'],['Configuration changed since loading. Restore from backup before retrying.','tool_failure_changed'],['Codex profile provider name conflicts with an existing provider.','tool_failure_conflict'],['Refusing symlink target','tool_failure_protected'],['EACCES: permission denied','tool_failure_permissions']])assert.equal(safeToolFailureReason(message),key);
 assert.equal(safeToolFailureReason('Unexpected token SENSITIVE_OLD_KEY in JSON'),'tool_config_load_failed');assert.equal(safeToolFailureReason('setup_preview_unsupported'),'setup_preview_unsupported');
});
