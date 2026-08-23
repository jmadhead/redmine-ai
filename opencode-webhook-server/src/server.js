const express = require('express');
const fs = require('fs');
const path = require('path');
const pty = require('node-pty');

const app = express();
app.use(express.json());

const OPENCODE_BIN = process.env.OPENCODE_BIN || '/Users/jmadhead/.opencode/bin/opencode';
const OPENCODE_WORKSPACE = process.env.OPENCODE_WORKSPACE || '/Users/jmadhead/IdeaProjects';
const DEFAULT_MODEL_ID = process.env.DEFAULT_MODEL_ID || 'Qwen3_6-35B-A3B-MTP';
const DEFAULT_MODEL_PROVIDER = process.env.DEFAULT_MODEL_PROVIDER || 'llama.cpp';
const AGENTS_DIR = process.env.AGENTS_DIR || './agents';
const MAX_OPENCODE_TIMEOUT = parseInt(process.env.OPENCODE_TIMEOUT, 10) || 6000000;
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT, 10) || 8080;

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

const agentPrompts = {};

function loadAgentPrompts() {
  try {
    const files = fs.readdirSync(AGENTS_DIR);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(AGENTS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const name = file.replace(/\.md$/, '');
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

// Session deduplication & queue tracker per agent
class AgentSessionTracker {
  constructor() {
    this.activeSessions = new Map();
    this.queue = new Map();
    this.processing = new Set();
  }

  _key(agent, issueId) {
    return `${agent}:${issueId}`;
  }

  isProcessing(agent, issueId) {
    return this.processing.has(this._key(agent, issueId));
  }

  enqueue(agent, item) {
    if (!this.queue.has(agent)) {
      this.queue.set(agent, []);
    }
    this.queue.get(agent).push(item);
  }

  dequeue(agent) {
    const q = this.queue.get(agent);
    if (!q || q.length === 0) return null;
    const item = q.shift();
    if (q.length === 0) this.queue.delete(agent);
    return item;
  }

  queueSize(agent) {
    const q = this.queue.get(agent);
    return q ? q.length : 0;
  }

  start(agent, issueId, sessionId) {
    this.processing.add(this._key(agent, issueId));
    this.activeSessions.set(agent, { sessionId, issueId });
  }

  finish(agent, issueId) {
    this.processing.delete(this._key(agent, issueId));
    const session = this.activeSessions.get(agent);
    if (session && session.issueId === issueId) {
      this.activeSessions.delete(agent);
    }
  }
}

const agentTracker = new AgentSessionTracker();

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

async function runOpencodeProcess(message, workspaceDir) {
  return new Promise((resolve, reject) => {
    let sessionId = null;
    let timedOut = false;
    let resolved = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      console.log(`[opencode] Timeout after ${MAX_OPENCODE_TIMEOUT}ms — killing process`);
      ptyProcess.kill('SIGINT');
      setTimeout(() => { try { ptyProcess.kill('SIGKILL'); } catch {} }, 5000);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Process killed after timeout (${MAX_OPENCODE_TIMEOUT}ms)`));
      }
    }, MAX_OPENCODE_TIMEOUT);

    const modelSpec = `${DEFAULT_MODEL_PROVIDER}/${DEFAULT_MODEL_ID}`;
    const ptyProcess = pty.spawn(OPENCODE_BIN, [
      'run',
      message,
      '--format', 'json',
      '--agent', 'build',
      '--model', modelSpec,
      '--dir', workspaceDir,
      '--auto',
    ], {
      name: 'xterm-color',
      cols: 200,
      rows: 50,
      cwd: workspaceDir,
      env: {
        ...process.env,
        HOME: process.env.HOME,
        PATH: process.env.PATH,
      },
    });

    process.stdout.write(`[opencode] PTY PID=${ptyProcess.pid} model=${modelSpec} dir=${workspaceDir}\n`);

    let stdoutBuffer = '';

    ptyProcess.on('data', (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Skip plugin initialization messages like "[opencode-llama-cpp] ..."
        if (trimmed.startsWith('[opencode-')) continue;

        let event;
        try {
          event = JSON.parse(trimmed);
        } catch {
          continue;
        }

        const eventType = event.type || '';
        const eventSessionID = event.sessionID;

        if (eventType === 'step_start') {
          // First step_start gives us the session ID
          if (!sessionId && eventSessionID) {
            sessionId = eventSessionID;
            console.log(`[opencode] Session created: ${sessionId}`);
          }
        } else if (eventType === 'text') {
          // Text content from assistant
          const text = event.part?.text || '';
          if (text && sessionId) {
            console.log(`[opencode] [${sessionId}] ${text}`);
          }
        } else if (eventType === 'step_finish') {
          const reason = event.part?.reason || 'unknown';
          if (sessionId) {
            console.log(`[opencode] Session ${sessionId} finish=${reason}`);
          }
          // Session complete — kill process cleanly
          if (reason === 'stop') {
            clearTimeout(timeoutId);
            ptyProcess.kill('SIGINT');
          }
        }
      }
    });

    ptyProcess.on('exit', (code, signal) => {
      clearTimeout(timeoutId);

      if (!resolved) {
        resolved = true;
        if (timedOut) {
          reject(new Error(`Process killed after timeout (${MAX_OPENCODE_TIMEOUT}ms)`));
        } else if (code !== 0 && code !== null) {
          reject(new Error(`Process exited with code=${code} signal=${signal}`));
        } else {
          resolve(sessionId);
        }
      }
    });

    ptyProcess.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

async function processAgentItem(agent, item) {
  const resolvedIssueId = item.issueId;
  const subject = item.subject;
  const description = item.description;

  const message = buildAgentMessage(agent, resolvedIssueId, subject, description);
  if (!message) {
    console.error(`[webhook] Could not build message for agent: ${agent}`);
    agentTracker.finish(agent, resolvedIssueId);
    processNextInQueue(agent);
    return;
  }

  const actionName = agent === 'reviewer' ? 'redmine-reviewer' : 'redmine-implementor';

  try {
    const sessionId = await runOpencodeProcess(message, OPENCODE_WORKSPACE);
    agentTracker.start(agent, resolvedIssueId, sessionId);
    console.log(`[webhook] Opencode run completed for issue #${resolvedIssueId}${sessionId ? ` (session: ${sessionId})` : ''}`);
  } catch (err) {
    console.error(`[webhook] Error processing issue #${resolvedIssueId}: ${err.message}`);
  } finally {
    agentTracker.finish(agent, resolvedIssueId);
    processNextInQueue(agent);
  }
}

function processNextInQueue(agent) {
  const next = agentTracker.dequeue(agent);
  if (next) {
    console.log(`[webhook] Processing next queued item for agent ${agent}: issue #${next.issueId}`);
    processAgentItem(agent, next);
  }
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

  const actionName = agent === 'reviewer' ? 'redmine-reviewer' : 'redmine-implementor';

  // Dedup: same agent+issue already processing or queued
  if (agentTracker.isProcessing(agent, resolvedIssueId)) {
    console.log(`[webhook] Dropped duplicate request for agent ${agent} issue #${resolvedIssueId}`);
    return res.status(200).json({ issueId: resolvedIssueId, action: actionName, status: 'dropped', reason: 'already processing or queued' });
  }

  // Queue if agent already has an active session
  if (agentTracker.activeSessions.has(agent)) {
    const existing = agentTracker.activeSessions.get(agent);
    console.log(`[webhook] Queueing issue #${resolvedIssueId} for agent ${agent} (active session: issue #${existing.issueId})`);
    agentTracker.enqueue(agent, { issueId: resolvedIssueId, subject, description });
    return res.status(200).json({ issueId: resolvedIssueId, action: actionName, status: 'queued', queuedPosition: agentTracker.queueSize(agent), reason: 'agent busy' });
  }

  // Process immediately
  processAgentItem(agent, { issueId: resolvedIssueId, subject, description });
  res.status(200).json({ issueId: resolvedIssueId, action: actionName, status: 'processing' });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'opencode-webhook-server', agents: Object.keys(agentPrompts) });
});

app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
  console.log(`[server] Webhook server listening on port ${WEBHOOK_PORT}`);
  console.log(`[server] OPENCODE_BIN=${OPENCODE_BIN}`);
  console.log(`[server] OPENCODE_WORKSPACE=${OPENCODE_WORKSPACE}`);
});
