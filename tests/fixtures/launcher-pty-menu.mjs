import { tool } from './launcher-pty-tool.mjs';
import { i18n } from '../../dist/lib/i18n.js';
import { showToolMenu } from '../../dist/lib/wizard/menus/tool-menu.js';

i18n.init('en_US');
await showToolMenu(tool);
console.log('PTY_MENU_RETURNED');
