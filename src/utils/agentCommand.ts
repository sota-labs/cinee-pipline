import { Types } from "mongoose";

/**
 * Pre-generate a MongoDB ObjectId to use as both task._id and --session-id.
 * Pass this to Task.create({ _id: taskId }) and buildAgentCommand({ taskId }).
 * This eliminates the two-step create→save race where a worker could pick up
 * a task with prompt: "pending" before the second save completes.
 */
export function generateTaskId(): Types.ObjectId {
  return new Types.ObjectId();
}

/**
 * Build an openclaw agent command with a deterministic session ID derived from task._id.
 * This prevents session takeover errors caused by random session IDs being reused
 * across retries or concurrent workers.
 */
export function buildAgentCommand(opts: {
  taskId: string;
  agent: string;
  model?: string;
  thinking?: boolean;
  escapedPrompt: string;
}): string {
  const { taskId, agent, model, thinking = false, escapedPrompt } = opts;
  const modelFlag = model ? ` --model ${model}` : "";
  const thinkingFlag = thinking ? "" : " --thinking off";
  return `agent --agent ${agent}${modelFlag}${thinkingFlag} --session-id ${taskId} --message '${escapedPrompt}'`;
}
