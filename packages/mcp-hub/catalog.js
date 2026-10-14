/** Pure helpers: tool naming, size estimates, lazy catalog text, meta-tool schemas. */

import { createHash } from 'node:crypto'

export const CALL_TOOL = 'mcp_call'
export const DESCRIBE_TOOL = 'mcp_describe'

// Same contract as @deepseek-ai/dsh-mcp-client so eager names do not change.
const MAX_PUBLIC_NAME_LENGTH = 64
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g
const HASH_LENGTH = 12

export function publicToolName(serverName, rawName) {
  const candidate = `mcp__${serverName}__${rawName}`
  const normalized = candidate.replace(INVALID_NAME_CHARS, '_')
  if (normalized === candidate && candidate.length <= MAX_PUBLIC_NAME_LENGTH) return candidate
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/** DSH's own fixed-density heuristic: 4 characters per token. */
export function estimateToolTokens(tool) {
  return Math.ceil(JSON.stringify({ name: tool.name, description: tool.description ?? '', parameters: tool.inputSchema ?? {} }).length / 4) + 4
}

export function estimateTokens(tools) {
  return tools.reduce((sum, tool) => sum + estimateToolTokens(tool), 0)
}

/** First sentence or line of a description, whitespace collapsed, capped. */
export function summaryLine(text, max = 120) {
  if (typeof text !== 'string') return ''
  const line = text.split(/\r?\n\s*\r?\n|\r?\n(?=\s*[-*#])/, 1)[0].replace(/\s+/g, ' ').trim()
  const sentence = line.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? line
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`
}

/** `eager` | `lazy` for a server; `auto` decides by schema size. */
export function effectiveMode(mode, tools, autoEagerMaxTokens) {
  if (mode === 'eager' || mode === 'lazy') return mode
  return estimateTokens(tools) <= autoEagerMaxTokens ? 'eager' : 'lazy'
}

/** Header line for one server in the catalog. */
export function serverSummary(server) {
  return summaryLine(server.cfg?.description || server.description || server.serverInfo?.description || server.serverInfo?.title || server.instructions || '', 160)
}

/**
 * The `mcp_call` description: what it does, then every lazy server with its
 * tools. Deterministic for a given input so the request prefix stays cacheable.
 * @param servers - `[{ name, summary, catalog: 'full'|'names', tools: [{name, description}] }]`
 */
export function renderCatalog(servers, lineChars = 120) {
  const lines = [
    'Call a tool on an MCP server whose tools are listed here instead of being loaded individually.',
    'Pass the server, the tool name and its arguments in `args`. When you are not sure about the arguments,',
    `call ${DESCRIBE_TOOL} first to get the tool's full description and input schema; a call with invalid`,
    'arguments fails with that schema attached.',
  ]
  for (const server of servers) {
    lines.push('')
    lines.push(server.summary ? `## ${server.name} — ${server.summary}` : `## ${server.name}`)
    if (server.tools.length === 0) {
      lines.push('(no tools reported yet)')
    } else if (server.catalog === 'names') {
      lines.push(server.tools.map((t) => t.name).join(', '))
    } else {
      for (const tool of server.tools) {
        const line = summaryLine(tool.description, lineChars)
        lines.push(line ? `- ${tool.name}: ${line}` : `- ${tool.name}`)
      }
    }
  }
  return lines.join('\n')
}

export function callToolParameters(serverNames) {
  return {
    type: 'object',
    properties: {
      server: { type: 'string', enum: serverNames, description: 'MCP server name from the list above.' },
      tool: { type: 'string', description: 'Tool name on that server.' },
      args: { type: 'object', description: 'Tool arguments as described by its input schema.', additionalProperties: true },
    },
    required: ['server', 'tool'],
    additionalProperties: false,
  }
}

export function describeToolParameters(serverNames) {
  return {
    type: 'object',
    properties: {
      server: { type: 'string', enum: serverNames, description: 'MCP server name.' },
      tool: { type: 'string', description: 'Tool name. Omit to get every tool of the server with full descriptions but without schemas.' },
    },
    required: ['server'],
    additionalProperties: false,
  }
}

export function describeText(serverName, tool) {
  return [
    `${serverName} / ${tool.name}`,
    '',
    tool.description?.trim() || '(no description)',
    '',
    'Input schema:',
    JSON.stringify(tool.inputSchema ?? { type: 'object' }, null, 2),
  ].join('\n')
}

export function describeServerText(serverName, summary, tools) {
  const lines = [summary ? `${serverName} — ${summary}` : serverName, '']
  for (const tool of tools) {
    lines.push(`### ${tool.name}`)
    lines.push(tool.description?.trim() || '(no description)')
    lines.push('')
  }
  lines.push(`Call ${DESCRIBE_TOOL} with a tool name for its input schema.`)
  return lines.join('\n')
}

/** Does an error message look like an argument problem (so the schema helps)? */
export function looksLikeArgumentError(message) {
  return /invalid|required|missing|argument|param|schema|validation|expected|must (be|have)|unknown (field|property|key)|-32602/i.test(String(message ?? ''))
}

/** Plain text of an MCP content array, for the generic result rendering. */
export function contentText(content, toolName) {
  if (!Array.isArray(content) || content.length === 0) return `(${toolName} returned no model-visible content)`
  return content
    .map((block) => {
      if (block === null || typeof block !== 'object') return '[unsupported MCP content block]'
      switch (block.type) {
        case 'text':
          return block.text ?? ''
        case 'image':
          return `[image: ${block.mimeType ?? 'unknown media type'}]`
        case 'resource_link':
          return `Resource link: ${block.name} (${block.uri})`
        default:
          return `[${block.type} content]`
      }
    })
    .join('\n')
}
