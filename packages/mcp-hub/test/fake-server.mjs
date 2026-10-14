// Minimal newline-delimited JSON-RPC MCP server for tests.
import { createInterface } from 'node:readline'
const tools = [
  { name: 'echo', description: 'Echo the text back. Second sentence.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'big', description: 'A tool with a large schema.', inputSchema: { type: 'object', properties: Object.fromEntries(Array.from({ length: Number(process.env.BIG ?? 0) }, (_, i) => [`field_${i}`, { type: 'string', description: 'x'.repeat(80) }])) } },
]
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`)
process.stderr.write('fake server started\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line)
  if (msg.id === undefined) return
  switch (msg.method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.0.0' }, instructions: 'Fake server for tests.' } })
    case 'tools/list':
      return send({ jsonrpc: '2.0', id: msg.id, result: { tools } })
    case 'tools/call': {
      const { name, arguments: args } = msg.params
      if (name === 'echo') {
        if (typeof args?.text !== 'string') return send({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: 'invalid arguments: text is required' }] } })
        return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `echo:${args.text}` }] } })
      }
      return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'ok' }] } })
    }
    case 'ping':
      return send({ jsonrpc: '2.0', id: msg.id, result: {} })
    default:
      return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } })
  }
})
