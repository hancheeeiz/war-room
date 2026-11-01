#!/usr/bin/env node
// War room MCP server (stdio, newline-delimited JSON-RPC). No dependencies, so any agent that speaks MCP can join.
import readline from 'node:readline';
import { Store } from './store.mjs';
import { TOOLS, callTool } from './tools.mjs';

const VERSION = '0.1.0';
const store = new Store();

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

function handle(req) {
  const { id, method, params = {} } = req;
  switch (method) {
    case 'initialize':
      return send({ id, result: {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'war-room', version: VERSION },
        instructions: 'The war room is the long-term memory and command post. Call war_room_brief with your agent name first. Search memory with recall before asking the founder anything. Workers: get_task_packet, then report_done with evidence. Only the commander judges goals, plans, assigns and verifies.',
      } });
    case 'ping':
      return send({ id, result: {} });
    case 'tools/list':
      return send({ id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    case 'tools/call': {
      const out = callTool(store, params.name, params.arguments);
      return send({ id, result: out.error ? { content: [{ type: 'text', text: out.error }], isError: true } : { content: [{ type: 'text', text: out.text }] } });
    }
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
  try { handle(req); } catch (e) { if (req.id !== undefined) send({ id: req.id, error: { code: -32603, message: e.message } }); }
});
