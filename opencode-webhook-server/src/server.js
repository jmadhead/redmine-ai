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
    `@redmine-implementor implement redmine task #${issueId}`,
  implementorMoreWork: (issueId, subject, description) =>
    `@redmine-implementor check review results in subtask bug for redmine task #${issueId} and fix`,
  reviewer: (issueId, subject, description) =>
    `@redmine-reviewer review redmine task #${issueId}`,
};

function determineAgent(statusName) {
  const lower = (statusName || '').toLowerCase().trim();

  if (lower.includes('ai:new')) {
    return 'implementor';
  } else if (lower.includes('ai:need more work')) {
    return 'implementor-more-work';
  } else if (lower.includes('ai:review')) {
    return 'reviewer';
  }

  return null;
}

function shouldProcessWebhook(payload) {
  const issue = payload.data?.issue;
  if (!issue) return { skip: true, reason: 'No issue data in payload ' + JSON.stringify(payload) };

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

async function createSession() {
  const sessionRes = await fetch(`${OPENCODE_URL}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!sessionRes.ok) {
    throw new Error(`Failed to create session: ${sessionRes.status} ${sessionRes.statusText}`);
  }
  const sessionData = await sessionRes.json();
  return sessionData.id || sessionData.sessionId;
}

async function sendMessage(sessionId, message) {
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
}

function pollSession(sessionId) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    console.log(`[poll] polling session ${sessionId}`);

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

  var message = null;
   if (agent === 'implementor') {
    message = AGENT_MESSAGES.implementor(issueId, subject, description);
   } else if (agent === 'implementor-more-work') {
    message = AGENT_MESSAGES.implementorMoreWork(issueId, subject, description);
   } else if (agent === 'reviewer') {
    message = AGENT_MESSAGES.reviewer(issueId, subject, description);
   }

  const actionName = agent === 'reviewer' ? 'redmine-reviewer' : 'redmine-implementor';

  // Create session to get sessionId for response
  (async () => {
    try {
      const sessionId = await createSession();
      console.log(`[webhook] Created session ${sessionId} for issue #${issueId}`);
      res.status(200).json({ sessionId, issueId, action: actionName, status: 'processing' });

      // Fire-and-forget: send message and poll in background
      await sendMessage(sessionId, message);
      console.log(`[webhook] Message sent to ${actionName} for issue #${issueId}`);
      pollSession(sessionId);
    } catch (err) {
      console.error(`[webhook] Error processing issue #${issueId}: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  })();
});

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'opencode-webhook-server' });
});

app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
  console.log(`[server] Webhook server listening on port ${WEBHOOK_PORT}`);
  console.log(`[server] OPENCODE_URL=${OPENCODE_URL}`);
});
