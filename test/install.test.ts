import { describe, it, expect } from 'vitest';
import { clientTarget, mcpServerEnv, mergeServerConfig, sharedBrainDir } from '../src/install/clients.js';

describe('comb install — client targets + config merge', () => {
  it('resolves each supported client to the right file + shape', () => {
    const opts = { home: '/home/u', cwd: '/work', platform: 'darwin' as const };
    expect(clientTarget('cursor', opts)).toMatchObject({ file: '/home/u/.cursor/mcp.json', shape: 'mcpServers' });
    expect(clientTarget('claude', opts)?.file).toContain('Library/Application Support/Claude/claude_desktop_config.json');
    expect(clientTarget('claude-code', opts)).toMatchObject({ file: '/work/.mcp.json', shape: 'mcpServers' });
    expect(clientTarget('vscode', opts)).toMatchObject({ file: '/work/.vscode/mcp.json', shape: 'vscode' });
    expect(clientTarget('windsurf', opts)?.file).toContain('.codeium/windsurf/mcp_config.json');
  });

  it('uses XDG path for claude on non-darwin', () => {
    const t = clientTarget('claude', { home: '/home/u', platform: 'linux' });
    expect(t?.file).toBe('/home/u/.config/Claude/claude_desktop_config.json');
  });

  it('returns null for an unknown client (no silent bad write)', () => {
    expect(clientTarget('emacs', { home: '/h' })).toBeNull();
  });

  it('mcpServerEnv is the model-free, no-seed, your-data-only config', () => {
    const env = mcpServerEnv('/data/brain', 'finance');
    expect(env).toEqual({
      LLM_BACKEND: 'modelfree', // user-facing name (never "mock")
      COMB_SEED_DEMO: 'off', // a real brain holds only the user's data
      COMB_RETRIEVAL: 'keyword', // $0/query, no model
      COMB_DATA_DIR: '/data/brain',
      MCP_PRINCIPAL: 'you',
      MCP_SCOPES: 'finance',
    });
  });

  it('sharedBrainDir is absolute so the tool and CLI share one brain', () => {
    expect(sharedBrainDir('/home/u')).toBe('/home/u/.comb-brain');
  });

  it('merge writes mcpServers for normal clients and never clobbers other servers', () => {
    const existing = { mcpServers: { other: { command: 'x' } } };
    const merged = mergeServerConfig(existing, 'mcpServers', mcpServerEnv('/d')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(merged.mcpServers.other).toEqual({ command: 'x' }); // preserved
    expect(merged.mcpServers.comb).toMatchObject({ command: 'comb', args: ['mcp'] });
    expect(existing).toEqual({ mcpServers: { other: { command: 'x' } } }); // input not mutated
  });

  it('merge writes VS Code shape (servers + type: stdio)', () => {
    const merged = mergeServerConfig({}, 'vscode', mcpServerEnv('/d')) as {
      servers: Record<string, { type: string; command: string }>;
    };
    expect(merged.servers.comb).toMatchObject({ type: 'stdio', command: 'comb' });
    expect('mcpServers' in merged).toBe(false);
  });
});
