import { configManager } from '../../config.js';
import type { PlanItem } from '../../core/write-plan.js';
import type { ITool } from '../../tools/base-tool.js';
import { t } from '../../i18n.js';
import type { StepInfo } from '../ui/ui-renderer.js';
import { runCodeBuddyModelSelectionFlow } from './codebuddy-model-selection-flow.js';
import { runWorkBuddyModelSelectionFlow } from './workbuddy-model-selection-flow.js';
import { planForTool } from './model-pick-flow.js';

// 工具详情、首次配置及确认页调整共用整组模型草稿，防止回写时缩减为首项。
export async function editBuddyModelsPlan(tool: ITool, from?: PlanItem, step?: StepInfo): Promise<PlanItem | undefined> {
  const field = tool.name === 'codebuddy' ? 'codeBuddyModels' : 'workbuddyModels';
  const connection = { ...(from?.connection ?? configManager.getConnection(tool.name)) };
  const options = { connection, previous: from?.models?.[field], step };
  const selected = tool.name === 'codebuddy'
    ? await runCodeBuddyModelSelectionFlow(options) : await runWorkBuddyModelSelectionFlow(options);
  if (!selected?.length) return undefined;
  const plan = planForTool(tool, selected[0]);
  return { ...plan, connection, models: { ...plan.models, [field]: [...selected] }, changes: [
    { label: t('tool_configure_models'), before: configManager.getModels()[field]?.join(', '), after: selected.join(', ') },
  ] };
}
