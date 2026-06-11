/**
 * In-chat slash commands — operate the harness without leaving the REPL.
 *
 * `comb chat` is where agents are talked to AND maintained, so the session
 * itself takes commands, Claude-Code-style:
 *
 *   /agent <name|builtin|tools|auto>   switch who you're talking to
 *   /model <ollama model>              switch the generation model (local)
 *   /agents                            list saved agents
 *   /forget                            wipe the current agent's memory
 *   /budget                            token usage for this scope
 *   /help                              show commands
 *   /exit                              leave
 *
 * Parsing is pure and lives here (not in cli.ts, which executes on import) so
 * it is hermetically testable.
 */

export type ChatCommand =
  | { cmd: 'help' }
  | { cmd: 'exit' }
  | { cmd: 'agents' }
  | { cmd: 'budget' }
  | { cmd: 'forget' }
  | { cmd: 'agent'; arg: string }
  | { cmd: 'model'; arg: string }
  | { cmd: 'unknown'; raw: string };

/** Parse a REPL line. Returns null for a normal message (not a command). */
export function parseChatCommand(line: string): ChatCommand | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) return null;
  const [head = '', ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  switch (head.toLowerCase()) {
    case 'help': return { cmd: 'help' };
    case 'exit':
    case 'quit': return { cmd: 'exit' };
    case 'agents': return { cmd: 'agents' };
    case 'budget': return { cmd: 'budget' };
    case 'forget': return { cmd: 'forget' };
    case 'agent': return { cmd: 'agent', arg };
    case 'model': return { cmd: 'model', arg };
    default: return { cmd: 'unknown', raw: head };
  }
}

export const CHAT_HELP = `
  /agent <name|builtin|tools>  switch agent (saved name or a generic kind)
  /model <name>                switch the generation model (local backend)
  /agents                      list saved agents
  /forget                      wipe the current agent's conversation memory
  /budget                      token usage for this scope
  /exit                        leave
`;
