// stdin
export interface ClaudeSessionEventPayload {
  session_id: string;
  agent_id?: string;
  agent_type?: string;
  prompt?: string;
  model?: string;
  message?: string;
  notification_type?: string;
  tool_name?: string;
  error?: string;
  token_count?: number;
  reason?: string;
  task_title?: string;
  task_id?: string;
  file_path?: string;
  source?: string;
  branch?: string;
}

export function buildSessionEvent(
  eventType: string,
  payload: ClaudeSessionEventPayload,
  timestamp: string,
  sessionId: string,
): Record<string, any> {
  const agentId = payload.agent_id ?? '';
  const agentType = payload.agent_type ?? '';
  let summary = '';
  let extraFields: Record<string, any> = {};

  switch (eventType) {
    case 'UserPromptSubmit': {
      const prompt = payload.prompt ?? '';
      summary = prompt.slice(0, 100);
      extraFields = { prompt };
      break;
    }
    case 'SessionStart': {
      const model = payload.model ?? 'unknown';
      summary = model;
      extraFields = { model };
      break;
    }
    case 'Stop': {
      summary = 'session ended';
      extraFields = {};
      break;
    }
    case 'SubagentStart':
      summary = `agent ${agentId} started`;
      extraFields = {};
      break;
    case 'SubagentStop': {
      summary = `agent ${agentId} finished`;
      extraFields = {};
      break;
    }
    case 'Notification': {
      const message = payload.message ?? '';
      const notificationType = payload.notification_type ?? '';
      summary = `${notificationType}: ${message.slice(0, 80)}`;
      extraFields = { message, notificationType };
      break;
    }
    case 'PermissionRequest': {
      const tool = payload.tool_name ?? 'unknown';
      summary = `${tool} requested`;
      extraFields = { toolName: tool };
      break;
    }
    case 'PreCompact': {
      const tokenCount = payload.token_count ?? null;
      summary = tokenCount
        ? `content compaction (${tokenCount} tokens)`
        : `context compaction triggered`;
      extraFields = { tokenCount };
      break;
    }
    case 'PostToolUseFailure': {
      const tool = payload.tool_name ?? 'unknown';
      const error = payload.error ?? '';
      summary = `${tool} failed: ${error.slice(0, 80)}`;
      extraFields = { toolName: tool, error };
      break;
    }
    case 'SessionEnd': {
      const reason = payload.reason ?? 'unknown';
      summary = `session ended: ${reason}`;
      extraFields = { reason };
      break;
    }
    case 'TeammateIdle': {
      summary = `teammate ${agentId} idle`;
      extraFields = {};
      break;
    }
    case 'TaskCompleted': {
      const taskTitle = payload.task_title ?? payload.task_id ?? 'unknown';
      summary = `task completed: ${taskTitle.slice(0, 80)}`;
      extraFields = { taskTitle };
      break;
    }
    case 'InstructionsLoaded': {
      const filePath = payload.file_path ?? 'unknown';
      const source = payload.source ?? 'unknown';
      summary = `instructions loaded: ${filePath}`;
      extraFields = { filePath, source };
      break;
    }
    case 'ConfigChange': {
      const filePath = payload.file_path ?? 'unknown';
      const source = payload.source ?? 'unknown';
      summary = `config changed: ${filePath} (${source})`;
      extraFields = { filePath, source };
      break;
    }
    case 'WorktreeCreate': {
      const branch = payload.branch ?? 'unknown';
      summary = `worktree created: ${branch}`;
      extraFields = { branch };
      break;
    }
    case 'WorktreeRemove': {
      const branch = payload.branch ?? 'unknown';
      summary = `worktree removed: ${branch}`;
      extraFields = { branch };
      break;
    }
    default:
      summary = eventType;
      extraFields = {};
  }
  return {
    type: eventType,
    timestamp,
    sessionId,
    summary,
    ...(agentId && { agentId }),
    ...(agentType && { agentType }),
    ...extraFields,
  };
}
