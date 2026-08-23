export interface LogEntry {
  timestamp: string;
  level: string;
  service: string;
  message: string;
  extra?: Record<string, unknown>;
}

function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}

function log(level: string, service: string, message: string, extra?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    service,
    message,
    extra,
  };
  console.error(JSON.stringify(entry));
}

export const logger = {
  info: (message: string, extra?: Record<string, unknown>) =>
    log("INFO", "redmine-mcp", message, extra),

  debug: (message: string, extra?: Record<string, unknown>) =>
    log("DEBUG", "redmine-mcp", message, extra),

  error: (message: string, extra?: Record<string, unknown>) =>
    log("ERROR", "redmine-mcp", message, extra),

  toolCall: (toolName: string, args: Record<string, unknown>) =>
    log("INFO", "redmine-mcp", `TOOL_CALL: ${toolName}`, { args }),

  toolResult: (toolName: string, durationMs: number, output: string) =>
    log("INFO", "redmine-mcp", `TOOL_RESULT: ${toolName} (${durationMs}ms)`, {
      output: output.length > 500 ? output.slice(0, 500) + "..." : output,
      durationMs,
      outputLength: output.length,
    }),

  toolError: (toolName: string, durationMs: number, error: string) =>
    log("ERROR", "redmine-mcp", `TOOL_ERROR: ${toolName} (${durationMs}ms)`, {
      error,
      durationMs,
    }),
};
