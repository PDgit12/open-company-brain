import { describe, it, expect } from 'vitest';
import { parseChatCommand, CHAT_HELP } from '../src/harness/chat-commands.js';
import { Brain } from '../src/brain/brain.js';

describe('parseChatCommand — slash commands inside comb chat', () => {
  it('returns null for a normal message (goes to the agent)', () => {
    expect(parseChatCommand('what renews this week?')).toBeNull();
    expect(parseChatCommand('  hello ')).toBeNull();
  });

  it('parses argument-less commands', () => {
    expect(parseChatCommand('/help')).toEqual({ cmd: 'help' });
    expect(parseChatCommand('/agents')).toEqual({ cmd: 'agents' });
    expect(parseChatCommand('/budget')).toEqual({ cmd: 'budget' });
    expect(parseChatCommand('/forget')).toEqual({ cmd: 'forget' });
    expect(parseChatCommand('/exit')).toEqual({ cmd: 'exit' });
    expect(parseChatCommand('/quit')).toEqual({ cmd: 'exit' });
  });

  it('parses /agent and /model with multi-word args and case-insensitive heads', () => {
    expect(parseChatCommand('/agent Risk scanner')).toEqual({ cmd: 'agent', arg: 'Risk scanner' });
    expect(parseChatCommand('/MODEL qwen2.5:14b')).toEqual({ cmd: 'model', arg: 'qwen2.5:14b' });
    expect(parseChatCommand('/agent')).toEqual({ cmd: 'agent', arg: '' });
  });

  it('flags unknown commands instead of sending them to the agent', () => {
    expect(parseChatCommand('/wat')).toEqual({ cmd: 'unknown', raw: 'wat' });
  });

  it('help text covers every command', () => {
    for (const c of ['/agent', '/model', '/agents', '/forget', '/budget', '/exit']) {
      expect(CHAT_HELP).toContain(c);
    }
  });
});

describe('Brain.setGenerationModel — /model hot-swap', () => {
  it('refuses on a non-local backend (model choice lives elsewhere there)', async () => {
    const brain = await Brain.create(); // tests run on the mock backend
    expect(brain.setGenerationModel('qwen2.5:14b')).toBe(false);
  });
});
