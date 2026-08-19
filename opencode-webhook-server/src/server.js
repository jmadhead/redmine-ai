const express = require('express');

const app = express();
app.use(express.json());

const OPENCODE_URL = process.env.OPENCODE_URL || 'http://opencode:4096';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT, 10) || 8080;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 2000;
const MAX_POLL_TIMEOUT = parseInt(process.env.MAX_POLL_TIMEOUT, 10) || 600000; // 10 minutes

// Agent message templates
const AGENT_MESSAGES = {
  implementor: (issueId, subject, description) =>
    `@redmine-implementor implement redmine task #${issueId}. Subject: ${subject}. Description: ${description}`,
  reviewer: (issueId, subject, description) =>
    `@redmine-reviewer review redmine task #${issueId}. Subject: ${subject}. Description: ${description}`,
};

// Status → agent mapping
const STATUS_AGENT_MAP = {
  'new': 'implementor',
  'need more work': 'implementor',
  'review': 'reviewer',
};

function determineAgent(statusName) {
  const lower = (statusName || '').toLowerCase().trim();
  return STATUS_AGENT_MAP[lower] || null;
}

function shouldProcessWebhook(payload) {
  const issue = payload.body?.data?.issue;
  if (!issue) return { skip: true, reason: 'No issue data in payload' };

  const assigneeName = issue.assigned_to?.name || '';
  if (!assigneeName.toLowerCase().includes('ai')) {
    return { skip: true, reason: `Assignee "${assigneeName}" does not contain "ai"` };
  }

  const statusName = issue.status?.name || '';
  const agent = determineAgent(statusName);
  if (!agent) {
    return { skip: true, reason: `Unhandled status: "${statusName}"` };
  }

  return { skip: false, agent, issue, statusName };
}

async function triggerOpencode(message) {
  // Create session
  const sessionRes = await fetch(`${OPENCODE_URL}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!sessionRes.ok) {
    throw new Error(`Failed to create session: ${sessionRes.status} ${sessionRes.statusText}`);
  }
  const sessionData = await sessionRes.json();
  const sessionId = sessionData.id || sessionData.sessionId;

  // Send message
  const msgRes = await fetch(`${OPENCODE_URL}/session/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parts: [{ type: 'text', text: message }],
    }),
  });
  if (!msgRes.ok) {
    throw new Error(`Failed to send message: ${msgRes.status} ${msgRes.statusText}`);
  }

  return sessionId;
}

function pollSession(sessionId) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const poll = async () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= MAX_POLL_TIMEOUT) {
        console.log(`[poll] Timeout after ${elapsed}ms for session ${sessionId}`);
        resolve();
        return;
      }

      try {
        const res = await fetch(`${OPENCODE_URL}/session/${sessionId}`);
        if (!res.ok) {
          console.log(`[poll] Session ${sessionId} poll failed: ${res.status}`);
          resolve();
          return;
        }

        const data = await res.json();
        const textParts = data.parts?.filter((p) => p.type === 'text').map((p) => p.text).join('\n') || '';
        if (textParts) {
          console.log(`[poll] ${textParts}`);
        }

        // Check for terminal state (depends on opencode response structure)
        const isTerminal = data.status === 'completed' || data.status === 'done' || data.status === 'finished';
        if (isTerminal) {
          console.log(`[poll] Session ${sessionId} reached terminal state`);
          resolve();
          return;
        }

        setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        console.log(`[poll] Error polling session ${sessionId}: ${err.message}`);
        resolve();
      }
    };

    poll();
  });
}

// Webhook endpoint
app.post('/redmine-webhook', (req, res) => {
  const result = shouldProcessWebhook(req.body);

  if (result.skip) {
    console.log(`[webhook] Skipped: ${result.reason}`);
    return res.status(200).json({ status: 'skipped', reason: result.reason });
  }

  const { agent, issue } = result;
  const issueId = issue.id;
  const subject = issue.subject || '';
  const description = issue.description || '';

  const message = agent === 'implementor'
    ? AGENT_MESSAGES.implementor(issueId, subject, description)
    : AGENT_MESSAGES.reviewer(issueId, subject, description);

  const actionName = agent === 'implementor' ? 'redmine-implementor' : 'redmine-reviewer';

  // Fire-and-forget: trigger opencode and poll in background
  (async () => {
    try {
      const sessionId = await triggerOpencode(message);
      console.log(`[webhook] Triggered ${actionName} for issue #${issueId}, session: ${sessionId}`);
      pollSession(sessionId);
    } catch (err) {
      console.error(`[webhook] Error triggering ${actionName}: ${err.message}`);
    }
  })();

  // Immediate response
  res.status(200).json({
    sessionId: 'pending',
    issueId,
    action: actionName,
    status: 'processing',
  });
});

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'opencode-webhook-server' });
});

app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
  console.log(`[server] Webhook server listening on port ${WEBHOOK_PORT}`);
  console.log(`[server] OPENCODE_URL=${OPENCODE_URL}`);
});
