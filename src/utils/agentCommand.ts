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
