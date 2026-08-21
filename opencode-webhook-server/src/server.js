const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const OPENCODE_URL = process.env.OPENCODE_URL || 'http://opencode:4096';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT, 10) || 8080;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 2000;
const MAX_POLL_TIMEOUT = parseInt(process.env.MAX_POLL_TIMEOUT, 10) || 6000000;
const OPENCODE_WORKSPACE = process.env.OPENCODE_WORKSPACE || '/app/IdeaProjects';
const DEFAULT_MODEL_ID = process.env.DEFAULT_MODEL_ID || 'Qwen3_6-35B-A3B-MTP';
const DEFAULT_MODEL_PROVIDER = process.env.DEFAULT_MODEL_PROVIDER || 'llama.cpp';
const AGENTS_DIR = process.env.AGENTS_DIR || './agents';

// Strip YAML frontmatter and return just the markdown content
function stripFrontmatter(content) {
  const trimmed = content.trim();
  if (trimmed.startsWith('---')) {
    const endIdx = trimmed.indexOf('---', 3);
    if (endIdx !== -1) {
      return trimmed.substring(endIdx + 3).trim();
    }
  }
  return trimmed;
}

// Load agent prompt files from the agents/ directory at startup
const agentPrompts = {};

function loadAgentPrompts() {
  try {
    const files = fs.readdirSync(AGENTS_DIR);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(AGENTS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      // Map redmine-reviewer.md -> reviewer, etc.
      const name = file.replace(/\.md$/, '');
      // Use the filename as the key (e.g., "redmine-reviewer" -> "reviewer")
      // Also strip the "redmine-" prefix if present for the short alias
      const shortName = name.startsWith('redmine-') ? name.replace('redmine-', '') : name;
      agentPrompts[shortName] = stripFrontmatter(content);
    }
    console.log(`[agents] Loaded ${Object.keys(agentPrompts).length} agent prompt(s): ${Object.keys(agentPrompts).join(', ')}`);
  } catch (err) {
    console.error(`[agents] Failed to load agent prompts from ${AGENTS_DIR}: ${err.message}`);
  }
}

loadAgentPrompts();

const OPENCODE_AGENTS = {
  'implementor': 'implementor',
  'implementor-more-work': 'implementor',
  'reviewer': 'reviewer',
};

// Generate a prompt by combining issue context with the agent instructions
function buildAgentMessage(agentName, issueId, subject, description) {
  const instructions = agentPrompts[OPENCODE_AGENTS[agentName]];
  if (!instructions) {
    console.error(`[agents] No prompt loaded for agent: ${agentName}`);
    return null;
  }

  return `Issue: #${issueId} — ${subject}

## Description
${description}

---

${instructions}`;
}


function determineAgent(statusName) {
  const lower = (statusName || '').toLowerCase().trim();
  if (lower.includes('new')) return 'implementor';
  if (lower.includes('ai:need more work')) return 'implementor-more-work';
  if (lower.includes('ai:review')) return 'reviewer';
  return null;
}

function shouldProcessWebhook(payload) {
  const issue = payload.data?.issue;
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

function generateMessageID() {
  const chars = '0123456789abcdef';
  let id = 'msg_';
  for (let i = 0; i < 24; i++) {
    const idx = chars[Math.floor(Math.random() * chars.length)];
    id += i % 2 === 0 ? idx.toUpperCase() : idx;
  }
  return id;
}

async function createSession(agent) {
  const sessionRes = await fetch(`${OPENCODE_URL}/session?directory=${encodeURIComponent(OPENCODE_WORKSPACE)}`, {
    method: 'POST',
    headers: { 'x-opencode-directory': encodeURIComponent(OPENCODE_WORKSPACE) },
  });
  if (!sessionRes.ok) {
    throw new Error(`Failed to create session: ${sessionRes.status} ${sessionRes.statusText}`);
  }
  const sessionData = await sessionRes.json();
  return sessionData.id;
}

async function sendMessage(sessionId, message) {
  const promptRes = await fetch(`${OPENCODE_URL}/session/${sessionId}/prompt_async`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-opencode-directory': encodeURIComponent(OPENCODE_WORKSPACE),
    },
    body: JSON.stringify({
      messageID: generateMessageID(),
      agent: 'build',
      model: { modelID: DEFAULT_MODEL_ID, providerID: DEFAULT_MODEL_PROVIDER },
      parts: [{ type: 'text', text: message }],
    }),
  });
  if (!promptRes.ok) {
    throw new Error(`Failed to send message: ${promptRes.status} ${promptRes.statusText}`);
  }
}

function pollSession(sessionId) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const seenMessageIds = new Set();

    const poll = async () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= MAX_POLL_TIMEOUT) {
        console.log(`[poll] Timeout after ${elapsed}ms for session ${sessionId}`);
        resolve();
        return;
      }

      try {
        const res = await fetch(`${OPENCODE_URL}/session/${sessionId}/message?limit=20`);
        if (!res.ok) {
          console.log(`[poll] Session ${sessionId} poll failed: ${res.status}`);
          resolve();
          return;
        }

        const data = await res.json();
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const messages = data || [];

        const newMessages = messages.filter((m) => !seenMessageIds.has(m.messageID));
        newMessages.forEach((m) => seenMessageIds.add(m.messageID));

        for (const m of newMessages) {
          const text = (m.content || [])
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n')
            .trim();
          const summary = text ? text.substring(0, 200) : '';
          const model = m.model ? `${m.model.modelID}` : '';
          console.log(`[poll] [${elapsedSec}s] session=${m.sessionID || sessionId} type=${m.type} agent=${m.agent || ''} model=${model} status=${m.finish || 'in-progress'} subagent_type=${m.subagent_type || ''} message="${summary}"`);
        }

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

  const issue = req.body.data?.issue;
  const issueId = issue?.id || '?';
  const statusName = issue?.status?.name || '';
  const assigneeName = issue?.assigned_to?.name || '';
  console.log(`[webhook] issue#${issueId} status="${statusName}" assignee="${assigneeName}" agent=${result.agent || 'skipped'}`);

  if (result.skip) {
    console.log(`[webhook] Skipped: ${result.reason}`);
    return res.status(200).json({ status: 'skipped', reason: result.reason });
  }

  const { agent, issue: resolvedIssue } = result;
  const resolvedIssueId = resolvedIssue.id;
  const subject = resolvedIssue.subject || '';
  const description = resolvedIssue.description || '';

  let message = buildAgentMessage(agent, resolvedIssueId, subject, description);
  if (!message) {
    console.error(`[webhook] Could not build message for agent: ${agent}`);
    return res.status(500).json({ error: `No prompt loaded for agent: ${agent}` });
  }

  const actionName = agent === 'reviewer' ? 'redmine-reviewer' : 'redmine-implementor';

  (async () => {
    try {
      const sessionId = await createSession(agent);
      console.log(`[webhook] Created session ${sessionId} for issue #${resolvedIssueId}`);
      res.status(200).json({ sessionId, issueId: resolvedIssueId, action: actionName, status: 'processing' });

      await sendMessage(sessionId, message);
      console.log(`[webhook] Message sent to session ${sessionId}`);
      pollSession(sessionId);
    } catch (err) {
      console.error(`[webhook] Error processing issue #${resolvedIssueId}: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  })();
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'opencode-webhook-server', agents: Object.keys(agentPrompts) });
});

app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
  console.log(`[server] Webhook server listening on port ${WEBHOOK_PORT}`);
  console.log(`[server] OPENCODE_URL=${OPENCODE_URL}`);
});
