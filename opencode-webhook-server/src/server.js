const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
app.use(express.json());

const OPENCODE_BIN = process.env.OPENCODE_BIN || path.join(os.homedir(), '.opencode', 'bin', 'opencode');
const OPENCODE_WORKSPACE = process.env.OPENCODE_WORKSPACE;

if (!OPENCODE_WORKSPACE) {
  console.error('OPENCODE_WORKSPACE is required - set it via environment variable or opencode-webhook-server/.env');
  process.exit(1);
}
const DEFAULT_MODEL_ID = process.env.DEFAULT_MODEL_ID || 'Qwen3_6-35B-A3B-MTP';
const DEFAULT_MODEL_PROVIDER = process.env.DEFAULT_MODEL_PROVIDER || 'llama.cpp';
const AGENTS_DIR = process.env.AGENTS_DIR || './agents';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT, 10) || 8080;
const SHUTDOWN_GRACE_MS = parseInt(process.env.SHUTDOWN_GRACE_MS, 10) || 5000;

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function log(tag, message) {
  console.log(`[${formatTimestamp()}] [${tag}] ${message}`);
}

function logError(tag, message) {
  console.error(`[${formatTimestamp()}] [${tag}] ${message}`);
}

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
    log('agents', `Loaded ${Object.keys(agentPrompts).length} agent prompt(s): ${Object.keys(agentPrompts).join(', ')}`);
  } catch (err) {
    logError('agents', `Failed to load agent prompts from ${AGENTS_DIR}: ${err.message}`);
  }
}

loadAgentPrompts();

// Single source of truth for agent naming: webhook agent name → prompt key + external action name.
const AGENT_REGISTRY = {
  'implementor': { promptKey: 'implementor', action: 'redmine-implementor' },
  'implementor-more-work': { promptKey: 'implementor', action: 'redmine-implementor' },
  'reviewer': { promptKey: 'reviewer', action: 'redmine-reviewer' },
};

// Session deduplication & queue tracker per agent.
// Entries keep the opencode child PID; busy-ness is verified with
// process.kill(pid, 0) before being trusted.
class AgentSessionTracker {
  constructor() {
    this.activeSessions = new Map();
    this.queue = new Map();
    this.processing = new Map();
  }

  _key(agent, issueId) {
    return `${agent}:${issueId}`;
  }

  _isAlive(pid) {
    if (pid === null || pid === undefined) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  isProcessing(agent, issueId) {
    const key = this._key(agent, issueId);
    const entry = this.processing.get(key);
    if (entry && !this._isAlive(entry.pid)) {
      this.processing.delete(key);
      return false;
    }
    return entry !== undefined;
  }

  activeSession(agent) {
    const session = this.activeSessions.get(agent);
    if (session && !this._isAlive(session.pid)) {
      this.activeSessions.delete(agent);
      return null;
    }
    return session || null;
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

  isQueued(agent, issueId) {
    const q = this.queue.get(agent);
    return q ? q.some((i) => i.issueId === issueId) : false;
  }

  start(agent, issueId, pid = null) {
    this.processing.set(this._key(agent, issueId), { pid });
    this.activeSessions.set(agent, { issueId, pid });
  }

  attachPid(agent, issueId, pid) {
    const entry = this.processing.get(this._key(agent, issueId));
    if (entry) entry.pid = pid;
    const session = this.activeSessions.get(agent);
    if (session && session.issueId === issueId) session.pid = pid;
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
  const registry = AGENT_REGISTRY[agentName];
  const instructions = registry && agentPrompts[registry.promptKey];
  if (!instructions) {
    logError('agents', `No prompt loaded for agent: ${agentName}`);
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
  if (lower.includes('ai:review') && !lower.includes('ai:reviewed')) return 'reviewer';
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

const activeProcesses = new Set();

function bufferLines(stream, onLine) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) onLine(line);
  });
  stream.on('close', () => {
    if (buffer) {
      onLine(buffer);
      buffer = '';
    }
  });
}

function formatEvent(event) {
  switch (event.type) {
    case 'step_start':
      return 'step start';
    case 'step_finish': {
      const part = event.part || {};
      const bits = [];
      const tokens = part.tokens;
      if (tokens) {
        const inOut = `in=${tokens.input ?? 0} out=${tokens.output ?? 0}`;
        const reasoning = tokens.reasoning ? ` reasoning=${tokens.reasoning}` : '';
        bits.push(`tokens ${inOut}${reasoning}`);
      }
      if (typeof part.cost === 'number') bits.push(`cost=${part.cost.toFixed(4)}`);
      return bits.length ? `step finished (${bits.join(', ')})` : 'step finished';
    }
    case 'tool_use': {
      const part = event.part || {};
      const status = part.state?.status || 'unknown';
      const title = part.state?.title || '';
      let line = `tool ${part.tool || '?'} [${status}]${title ? `: ${title}` : ''}`;
      if (status === 'error' && part.state?.error) line += ` — ${part.state.error}`;
      return line;
    }
    case 'text': {
      const text = (event.part?.text || '').trim();
      return text || null;
    }
    case 'reasoning': {
      const text = (event.part?.text || '').trim();
      return text ? `thinking: ${text}` : null;
    }
    case 'error': {
      const err = event.error || {};
      let message = String(err.name || 'error');
      if (err.data && err.data.message) message += ` — ${err.data.message}`;
      return message;
    }
    default: {
      const compact = JSON.stringify(event);
      return compact.length > 200 ? `${compact.slice(0, 200)}…` : compact;
    }
  }
}

function runOpencodeProcess(message, workspaceDir, onSpawn) {
  return new Promise((resolve, reject) => {
    let sessionId = null;
    let resolved = false;

    const modelSpec = `${DEFAULT_MODEL_PROVIDER}/${DEFAULT_MODEL_ID}`;
    const child = spawn(OPENCODE_BIN, [
      'run',
      message,
      '--format', 'json',
      '--agent', 'build',
      '--model', modelSpec,
      '--dir', workspaceDir,
      '--auto',
    ], {
      cwd: workspaceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    activeProcesses.add(child);
    log('opencode', `Spawned PID=${child.pid} model=${modelSpec} dir=${workspaceDir}`);
    onSpawn(child);

    const handleStdoutLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        log('opencode', trimmed);
        return;
      }
      if (!event || typeof event !== 'object') return;

      // Every event carries the session ID — completion is still the process exit
      if (event.sessionID && !sessionId) {
        sessionId = event.sessionID;
        log('opencode', `Session created: ${sessionId}`);
      }

      const formatted = formatEvent(event);
      if (formatted) {
        const logFn = event.type === 'error' ? logError : log;
        logFn('opencode', formatted);
      }
    };

    bufferLines(child.stdout, handleStdoutLine);
    bufferLines(child.stderr, (line) => {
      const text = line.trimEnd();
      if (text) log('opencode:stderr', text);
    });

    const cleanup = () => activeProcesses.delete(child);

    // 'close' fires after stdio streams end, so all output is flushed by then
    child.on('close', (code, signal) => {
      cleanup();
      if (!resolved) {
        resolved = true;
        if (code === 0) {
          resolve(sessionId);
        } else {
          reject(new Error(`Process exited with code=${code} signal=${signal}`));
        }
      }
    });

    child.on('error', (err) => {
      cleanup();
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
}

async function processAgentItem(agent, item) {
  const resolvedIssueId = item.issueId;
  const subject = item.subject;
  const description = item.description;

  const message = buildAgentMessage(agent, resolvedIssueId, subject, description);

  // Reserve the agent slot before spawning so concurrent webhooks see it as busy
  agentTracker.start(agent, resolvedIssueId);

  if (!message) {
    agentTracker.finish(agent, resolvedIssueId);
    processNextInQueue(agent);
    return;
  }

  try {
    const sessionId = await runOpencodeProcess(message, OPENCODE_WORKSPACE, (proc) => {
      agentTracker.attachPid(agent, resolvedIssueId, proc.pid);
    });
    log('webhook', `Opencode run completed for issue #${resolvedIssueId}${sessionId ? ` (session: ${sessionId})` : ''}`);
  } catch (err) {
    logError('webhook', `Error processing issue #${resolvedIssueId}: ${err.message}`);
  } finally {
    agentTracker.finish(agent, resolvedIssueId);
    processNextInQueue(agent);
  }
}

function processNextInQueue(agent) {
  const next = agentTracker.dequeue(agent);
  if (next) {
    log('webhook', `Processing next queued item for agent ${agent}: issue #${next.issueId}`);
    processAgentItem(agent, next);
  }
}

app.post('/redmine-webhook', (req, res) => {
  const result = shouldProcessWebhook(req.body);

  const issue = req.body.data?.issue;
  const issueId = issue?.id || '?';
  const statusName = issue?.status?.name || '';
  const assigneeName = issue?.assigned_to?.name || '';
  log('webhook', `issue#${issueId} status="${statusName}" assignee="${assigneeName}" agent=${result.agent || 'skipped'}`);

  if (result.skip) {
    log('webhook', `Skipped: ${result.reason}`);
    return res.status(200).json({ status: 'skipped', reason: result.reason });
  }

  const { agent, issue: resolvedIssue } = result;
  const resolvedIssueId = resolvedIssue.id;
  const subject = resolvedIssue.subject || '';
  const description = resolvedIssue.description || '';

  const actionName = AGENT_REGISTRY[agent].action;

  // Dedup: same agent+issue already processing or queued
  if (agentTracker.isProcessing(agent, resolvedIssueId) || agentTracker.isQueued(agent, resolvedIssueId)) {
    log('webhook', `Dropped duplicate request for agent ${agent} issue #${resolvedIssueId}`);
    return res.status(200).json({ issueId: resolvedIssueId, action: actionName, status: 'dropped', reason: 'already processing or queued' });
  }

  // Queue if agent already has an active session (verified by process liveness)
  const activeSession = agentTracker.activeSession(agent);
  if (activeSession) {
    log('webhook', `Queueing issue #${resolvedIssueId} for agent ${agent} (active session: issue #${activeSession.issueId})`);
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

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'error', reason: 'Invalid JSON body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ status: 'error', reason: 'Request body too large' });
  }
  logError('server', `Unhandled error: ${err.stack || err.message}`);
  res.status(err.status || 500).json({ status: 'error', reason: 'Internal server error' });
});

const server = app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
  log('server', `Webhook server listening on port ${WEBHOOK_PORT}`);
  log('server', `OPENCODE_BIN=${OPENCODE_BIN}`);
  log('server', `OPENCODE_WORKSPACE=${OPENCODE_WORKSPACE}`);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('server', `${signal} received: stopping ${activeProcesses.size} opencode process(es) and closing server`);

  for (const child of activeProcesses) {
    try {
      child.kill('SIGTERM');
    } catch {
      // already dead
    }
  }

  const forceKillTimer = setTimeout(() => {
    for (const child of activeProcesses) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already dead
      }
    }
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forceKillTimer.unref();

  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
