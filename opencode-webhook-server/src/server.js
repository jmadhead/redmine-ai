const express = require('express');

const app = express();
app.use(express.json());

const OPENCODE_URL = process.env.OPENCODE_URL || 'http://opencode:4096';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT, 10) || 8080;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 2000;
const MAX_POLL_TIMEOUT = parseInt(process.env.MAX_POLL_TIMEOUT, 10) || 600000;
const OPENCODE_WORKSPACE = process.env.OPENCODE_WORKSPACE || '/app/IdeaProjects';
const DEFAULT_MODEL_ID = process.env.DEFAULT_MODEL_ID || 'Qwen3_6-35B-A3B-MTP';
const DEFAULT_MODEL_PROVIDER = process.env.DEFAULT_MODEL_PROVIDER || 'llama.cpp';

const AGENT_MESSAGES = {
  implementor: (issueId, subject, description) =>
    `@redmine-implementor implement redmine task #${issueId}`,
  implementorMoreWork: (issueId, subject, description) =>
    `@redmine-implementor check review results in subtask bug for redmine task #${issueId} and fix`,
  reviewer: (issueId, subject, description) =>
    `@redmine-reviewer review redmine task #${issueId}`,
};

const OPENCODE_AGENTS = {
  'implementor': 'redmine-implementor',
  'implementor-more-work': 'redmine-implementor',
  'reviewer': 'redmine-reviewer',
};

function determineAgent(statusName) {
  const lower = (statusName || '').toLowerCase().trim();
  if (lower.includes('ai:new')) return 'implementor';
  if (lower.includes('ai:need more work')) return 'implementor-more-work';
  if (lower.includes('ai:review')) return 'reviewer';
  return null;
}

function shouldProcessWebhook(payload) {
  const issue = payload.data?.issue;
  if (!issue) return { skip: true, reason: 'No issue data in payload ' + JSON.stringify(payload, null, 4) };
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

async function createSession(agent) {
  const opencodeAgent = OPENCODE_AGENTS[agent] || agent;

  const req ={
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({
                   agent: 'build',
                   model: { id: DEFAULT_MODEL_ID, providerID: DEFAULT_MODEL_PROVIDER },
                   location: { directory: OPENCODE_WORKSPACE },
                 }),
               };

  console.log(`Sending request ${JSON.stringify(req, null, 4)}`);

  const sessionRes = await fetch(`${OPENCODE_URL}/api/session`, req);
  if (!sessionRes.ok) {
    throw new Error(`Failed to create session: ${sessionRes.status} ${sessionRes.statusText}`);
  }
  const sessionData = await sessionRes.json();
  return sessionData.data.id;
}

async function sendMessage(sessionId, message) {
  const promptRes = await fetch(`${OPENCODE_URL}/api/session/${sessionId}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: { text: message } }),
  });
  if (!promptRes.ok) {
    throw new Error(`Failed to send message: ${promptRes.status} ${promptRes.statusText}`);
  }
  return promptRes.json();
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
        const res = await fetch(`${OPENCODE_URL}/api/session/${sessionId}/context`);
        if (!res.ok) {
          console.log(`[poll] Session ${sessionId} poll failed: ${res.status}`);
          resolve();
          return;
        }

        const data = await res.json();
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const messages = data.data || [];

        console.log('>>> ' + JSON.stringify(data, null, 4));

        const assistantMessages = messages.filter((m) => m.type === 'assistant');
        const lastAssistant = assistantMessages[assistantMessages.length - 1];

        if (lastAssistant) {
          const assistantText = (lastAssistant.content || [])
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
          if (assistantText) {
            console.log(`[poll] [${elapsedSec}s] ${assistantText}`);
          }
          console.log(`[poll] [${elapsedSec}s] session ${sessionId} finish=${lastAssistant.finish || 'in-progress'}`);
        }

        const isComplete = lastAssistant?.finish === 'stop';
        if (isComplete) {
          console.log(`[poll] Session ${sessionId} completed`);
          resolve();
          return;
        }

        setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        console.error(`[poll] Error polling session ${sessionId}: ${err.message}`);
        const elapsed = Date.now() - startTime;
        if (elapsed < MAX_POLL_TIMEOUT) {
          setTimeout(poll, POLL_INTERVAL_MS);
        } else {
          resolve();
        }
      }
    };

    poll();
  });
}

app.post('/redmine-webhook', (req, res) => {
  const result = shouldProcessWebhook(req.body);

  console.log(`Got request ${JSON.stringify(req.body, null, 4)}`)

  if (result.skip) {
    console.log(`[webhook] Skipped: ${result.reason}`);
    return res.status(200).json({ status: 'skipped', reason: result.reason });
  }

  const { agent, issue } = result;
  const issueId = issue.id;
  const subject = issue.subject || '';
  const description = issue.description || '';

  let message = null;
  if (agent === 'implementor') {
    message = AGENT_MESSAGES.implementor(issueId, subject, description);
  } else if (agent === 'implementor-more-work') {
    message = AGENT_MESSAGES.implementorMoreWork(issueId, subject, description);
  } else if (agent === 'reviewer') {
    message = AGENT_MESSAGES.reviewer(issueId, subject, description);
  }

  const actionName = agent === 'reviewer' ? 'redmine-reviewer' : 'redmine-implementor';

  (async () => {
    try {
      const sessionId = await createSession(agent);
      console.log(`[webhook] Created session ${sessionId} for issue #${issueId}`);
      res.status(200).json({ sessionId, issueId, action: actionName, status: 'processing' });

      await sendMessage(sessionId, message);
      console.log(`[webhook] Message sent to session ${sessionId}`);
      pollSession(sessionId);
    } catch (err) {
      console.error(`[webhook] Error processing issue #${issueId}: ${err} ${JSON.stringify(err, null, 4)}`);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  })();
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'opencode-webhook-server' });
});

app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
  console.log(`[server] Webhook server listening on port ${WEBHOOK_PORT}`);
  console.log(`[server] OPENCODE_URL=${OPENCODE_URL}`);
});
