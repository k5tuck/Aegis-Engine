/**
 * AEGIS MCP Server - Command Registry Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { CommandRegistry } from '../../../src/registry/command-registry.js';
import { createMockLogger, createMockBridge } from '../../setup.js';

describe('CommandRegistry', () => {
  let registry: CommandRegistry;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    registry = new CommandRegistry();
  });

  describe('registerCommand', () => {
    it('should register a command successfully', () => {
      const command = {
        name: 'test_command',
        description: 'A test command',
        category: 'test',
        parameters: z.object({
          name: z.string(),
        }),
        handler: vi.fn().mockResolvedValue({ success: true }),
      };

      registry.registerCommand(command);

      const registered = registry.getCommand('test_command');
      expect(registered).toBeDefined();
      expect(registered?.name).toBe('test_command');
    });

    it('should throw error for duplicate command names', () => {
      const command = {
        name: 'duplicate_command',
        description: 'First command',
        category: 'test',
        parameters: z.object({}),
        handler: vi.fn(),
      };

      registry.registerCommand(command);

      expect(() => registry.registerCommand(command)).toThrow();
    });

    it('should register commands with namespaces', () => {
      const command = {
        name: 'aegis.core.spawn_actor',
        description: 'Spawn an actor',
        category: 'core',
        parameters: z.object({
          className: z.string(),
        }),
        handler: vi.fn(),
      };

      registry.registerCommand(command);

      const registered = registry.getCommand('aegis.core.spawn_actor');
      expect(registered).toBeDefined();
    });
  });

  describe('getCommand', () => {
    it('should return undefined for non-existent command', () => {
      const command = registry.getCommand('non_existent');
      expect(command).toBeUndefined();
    });

    it('should return command by name', () => {
      const command = {
        name: 'find_me',
        description: 'Find me',
        category: 'test',
        parameters: z.object({}),
        handler: vi.fn(),
      };

      registry.registerCommand(command);

      const found = registry.getCommand('find_me');
      expect(found).toBeDefined();
      expect(found?.description).toBe('Find me');
    });
  });

  describe('getAllCommands', () => {
    it('should return all registered commands', () => {
      const commands = [
        {
          name: 'cmd1',
          description: 'Command 1',
          category: 'test',
          parameters: z.object({}),
          handler: vi.fn(),
        },
        {
          name: 'cmd2',
          description: 'Command 2',
          category: 'test',
          parameters: z.object({}),
          handler: vi.fn(),
        },
      ];

      commands.forEach((cmd) => registry.registerCommand(cmd));

      const all = registry.getAllCommands();
      expect(all.length).toBe(2);
    });

    it('should return empty array when no commands registered', () => {
      const all = registry.getAllCommands();
      expect(all).toEqual([]);
    });
  });

  describe('getCommandsByCategory', () => {
    it('should filter commands by category', () => {
      const commands = [
        {
          name: 'core_cmd',
          description: 'Core',
          category: 'core',
          parameters: z.object({}),
          handler: vi.fn(),
        },
        {
          name: 'worldgen_cmd',
          description: 'WorldGen',
          category: 'worldgen',
          parameters: z.object({}),
          handler: vi.fn(),
        },
      ];

      commands.forEach((cmd) => registry.registerCommand(cmd));

      const coreCommands = registry.getCommandsByCategory('core');
      expect(coreCommands.length).toBe(1);
      expect(coreCommands[0].name).toBe('core_cmd');
    });
  });

  describe('executeCommand', () => {
    it('should execute command handler with params', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true, data: 'result' });

      const command = {
        name: 'executable_cmd',
        description: 'Executable',
        category: 'test',
        parameters: z.object({
          input: z.string(),
        }),
        handler,
      };

      registry.registerCommand(command);

      const context = {
        params: { input: 'test' },
        logger: mockLogger,
      };

      const result = await registry.executeCommand('executable_cmd', context);

      expect(handler).toHaveBeenCalledWith(context);
      expect(result).toEqual({ success: true, data: 'result' });
    });

    it('should throw error for non-existent command', async () => {
      const context = {
        params: {},
        logger: mockLogger,
      };

      await expect(registry.executeCommand('missing', context)).rejects.toThrow();
    });
  });

  describe('unregisterCommand', () => {
    it('should remove a registered command', () => {
      const command = {
        name: 'removable',
        description: 'Removable',
        category: 'test',
        parameters: z.object({}),
        handler: vi.fn(),
      };

      registry.registerCommand(command);
      expect(registry.getCommand('removable')).toBeDefined();

      registry.unregisterCommand('removable');
      expect(registry.getCommand('removable')).toBeUndefined();
    });
  });
});
