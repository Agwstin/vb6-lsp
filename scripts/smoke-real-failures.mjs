// One-off smoke: replay literal failing calls captured in real telemetry.
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const rootDir = 'C:/Users/agust/Escritorio/Imperium/Git IAO/imperiumclassic';
const child = spawn(process.execPath, [path.resolve('out', 'mcp', 'mcp', 'server.js')], {
  env: {
    ...process.env,
    VB6_LSP_ROOT: rootDir,
    VB6_LSP_SOURCE_DIRS: 'Client/SOURCE;Server;Common;LoginServer;FriendServer;ProxyServer;ServerGuard',
    VB6_LSP_TELEMETRY_ENABLED: '0',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buffer = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      const resolve = pending.get(message.id);
      if (resolve) { pending.delete(message.id); resolve(message); }
    } catch {}
  }
});

const call = (id, name, args) => new Promise((resolve) => {
  pending.set(id, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
});

child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'i', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\n');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

// Literal failures from telemetry/mcp-usage.jsonl:
const calls = [
  ['read_function', { file: 'clsTileEngineX.cls', name: 'Engine_Init' }],                      // 65 errors
  ['read_function', { file: 'clsTextureMan.cls', name: 'Texture_Get' }],                       // 6 errors
  ['read_function', { file: 'modCutils.bas', name: 'Resources_ExtractToMemory' }],             // ambiguous + routine moved
  ['read_function', { file: 'clsMySQL.cls', name: 'Query' }],                                  // 4-way ambiguous (genuinely)
  ['summarize_module', { file: 'clsTileEngineX.cls' }],                                        // 3 errors
  ['find_symbol', { project: 'client', symbol: 'Engine_Render_Start' }],                       // 15 silent misses
  ['find_callers', { symbol: 'Mapa_Render' }],                                                 // 16 silent misses
  ['search_code', { query: 'sound_channel', scope: 'Client\\source' }],                        // backslash scope
  ['read_function', { name: 'modUIMapa.Mapa_Render' }],                                        // Module.Proc
];

let id = 1;
for (const [tool, args] of calls) {
  const response = await call(id++, tool, args);
  let parsed = {};
  try { parsed = JSON.parse(response.result.content[0].text); } catch {}
  const ok = !parsed.error;
  const summary = parsed.error
    ? `${parsed.error_kind}: ${String(parsed.message).slice(0, 90)}`
    : `file=${parsed.file || parsed.summary?.file || ''} count=${parsed.count ?? ''} callers=${Array.isArray(parsed.callers) ? parsed.callers.length : ''} note=${(parsed.resolution_note || '').slice(0, 80)}`;
  console.log(`${ok ? 'OK  ' : 'ERR '} ${tool} ${JSON.stringify(args).slice(0, 70)}\n      ${summary}`);
}
child.kill();
