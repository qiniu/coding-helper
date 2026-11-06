import { configManager } from '../../config.js';
import { toolManager } from '../../tool-manager.js';
import { profileUseCommand, profileRemoveCommand, profileAddCommand } from '../../../commands/profile.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { t } from '../../i18n.js';
export function toolsUsingProfile(name: string): string[] { return toolManager.getAll().filter(tool => configManager.getConnection(tool.name).profile === name).map(tool => tool.name); }
export async function runProfileFlow(): Promise<void> {
  const action = await promptHelper.select(t('profile_title'), [{ name: t('profile_add'), value: 'add' }, ...configManager.listProfiles().map(profile => ({ name: profile.name, value: profile.name }))]);
  if (action === 'add') {
    const name = await promptHelper.input(t('profile_name_prompt')); if (!name) return;
    const key = await promptHelper.password(t('apikey_prompt')); if (key) await profileAddCommand(name, key);
    return;
  }
  const operation = await promptHelper.select(action, [{ name: t('profile_use'), value: 'use' }, { name: t('profile_remove'), value: 'remove' }, { name: t('confirm_no'), value: 'back' }]);
  if (operation === 'use') await profileUseCommand(action);
  if (operation === 'remove' && await promptHelper.confirm(t('profile_remove'), false)) await profileRemoveCommand(action);
}
