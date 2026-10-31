import type { ModelConfig, Connection } from '../config.js';
import type { ITool } from '../tools/base-tool.js';
export interface PlanChange { label: string; before?: string; after: string; note?: string; }
export interface PlanItem { tool: ITool; models?: ModelConfig; context?: number | null; changes: PlanChange[]; main?: string; overrides?: Record<string, string>; connection?: Connection; }
