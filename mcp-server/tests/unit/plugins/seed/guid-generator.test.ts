/**
 * AEGIS MCP Server - GUID Generator Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateDeterministicGUID,
  validateGUIDFormat,
  guidRegistry,
  pathToGuidMap,
} from '../../../../src/plugins/seed/guid-generator.js';

describe('GUID Generator', () => {
  beforeEach(() => {
    // Clear registries between tests
    guidRegistry.clear();
    pathToGuidMap.clear();
  });

  describe('generateDeterministicGUID', () => {
    it('should generate consistent GUIDs for same inputs', () => {
      const guid1 = generateDeterministicGUID('actor', 'StaticMeshActor', 'seed123', 0, 'TestActor');
      const guid2 = generateDeterministicGUID('actor', 'StaticMeshActor', 'seed123', 0, 'TestActor');

      expect(guid1).toBe(guid2);
    });

    it('should generate different GUIDs for different seeds', () => {
      const guid1 = generateDeterministicGUID('actor', 'StaticMeshActor', 'seed123', 0, 'TestActor');
      const guid2 = generateDeterministicGUID('actor', 'StaticMeshActor', 'seed456', 0, 'TestActor');

      expect(guid1).not.toBe(guid2);
    });

    it('should generate different GUIDs for different counters', () => {
      const guid1 = generateDeterministicGUID('actor', 'StaticMeshActor', 'seed123', 0, 'TestActor');
      const guid2 = generateDeterministicGUID('actor', 'StaticMeshActor', 'seed123', 1, 'TestActor');

      expect(guid1).not.toBe(guid2);
    });

    it('should generate different GUIDs for different namespaces', () => {
      const guid1 = generateDeterministicGUID('actor', 'TestType', 'seed123', 0, 'Test');
      const guid2 = generateDeterministicGUID('component', 'TestType', 'seed123', 0, 'Test');

      expect(guid1).not.toBe(guid2);
      expect(guid1.startsWith('ACT-')).toBe(true);
      expect(guid2.startsWith('CMP-')).toBe(true);
    });

    it('should include namespace code in GUID', () => {
      const actorGuid = generateDeterministicGUID('actor', 'Test', 'seed', 0);
      const blueprintGuid = generateDeterministicGUID('blueprint', 'Test', 'seed', 0);
      const landscapeGuid = generateDeterministicGUID('landscape', 'Test', 'seed', 0);
      const foliageGuid = generateDeterministicGUID('foliage', 'Test', 'seed', 0);

      expect(actorGuid.startsWith('ACT-')).toBe(true);
      expect(blueprintGuid.startsWith('BPT-')).toBe(true);
      expect(landscapeGuid.startsWith('LND-')).toBe(true);
      expect(foliageGuid.startsWith('FOL-')).toBe(true);
    });
  });

  describe('validateGUIDFormat', () => {
    it('should validate correct GUID format', () => {
      const guid = 'ACT-12345678-1234-1234-123456789012';
      const result = validateGUIDFormat(guid);

      expect(result.valid).toBe(true);
      expect(result.namespace).toBe('actor');
    });

    it('should reject invalid GUID format', () => {
      const invalidGuids = [
        'invalid',
        '12345678-1234-1234-123456789012', // Missing namespace
        'XXX-12345678-1234-1234-123456789012', // Invalid namespace
        'ACT-1234-1234-1234-123456789012', // Wrong segment length
      ];

      for (const guid of invalidGuids) {
        const result = validateGUIDFormat(guid);
        expect(result.valid).toBe(false);
      }
    });

    it('should correctly identify namespace from GUID', () => {
      const namespaces = [
        { code: 'ACT', name: 'actor' },
        { code: 'CMP', name: 'component' },
        { code: 'AST', name: 'asset' },
        { code: 'BPT', name: 'blueprint' },
        { code: 'MAT', name: 'material' },
        { code: 'LND', name: 'landscape' },
        { code: 'FOL', name: 'foliage' },
        { code: 'PCG', name: 'pcg' },
        { code: 'AIN', name: 'ai' },
        { code: 'CUS', name: 'custom' },
      ];

      for (const ns of namespaces) {
        const guid = `${ns.code}-12345678-1234-1234-123456789012`;
        const result = validateGUIDFormat(guid);

        expect(result.valid).toBe(true);
        expect(result.namespace).toBe(ns.name);
      }
    });
  });

  describe('GUID Registry', () => {
    it('should store GUIDs in registry', () => {
      const guid = generateDeterministicGUID('actor', 'Test', 'seed', 0, 'TestActor');

      guidRegistry.set(guid, {
        guid,
        namespace: 'actor',
        entityType: 'Test',
        entityPath: '/Game/Test/TestActor',
        entityName: 'TestActor',
        metadata: {},
        createdAt: new Date(),
        version: 1,
      });

      expect(guidRegistry.has(guid)).toBe(true);
      expect(guidRegistry.get(guid)?.entityName).toBe('TestActor');
    });

    it('should maintain path to GUID mapping', () => {
      const guid = generateDeterministicGUID('actor', 'Test', 'seed', 0, 'TestActor');
      const path = '/Game/Test/TestActor';

      pathToGuidMap.set(path, guid);

      expect(pathToGuidMap.get(path)).toBe(guid);
    });

    it('should allow clearing registries', () => {
      const guid = generateDeterministicGUID('actor', 'Test', 'seed', 0);

      guidRegistry.set(guid, {} as any);
      pathToGuidMap.set('/Game/Test', guid);

      guidRegistry.clear();
      pathToGuidMap.clear();

      expect(guidRegistry.size).toBe(0);
      expect(pathToGuidMap.size).toBe(0);
    });
  });

  describe('Determinism', () => {
    it('should be fully deterministic across multiple generations', () => {
      const results: string[] = [];

      for (let i = 0; i < 100; i++) {
        const guid = generateDeterministicGUID('actor', 'StaticMesh', 'test-seed', 42, 'MyActor');
        results.push(guid);
      }

      // All results should be identical
      const first = results[0];
      expect(results.every((r) => r === first)).toBe(true);
    });

    it('should produce sequential unique GUIDs with incrementing counter', () => {
      const guids = new Set<string>();

      for (let i = 0; i < 1000; i++) {
        const guid = generateDeterministicGUID('actor', 'Test', 'seed', i, 'Actor');
        guids.add(guid);
      }

      // All 1000 GUIDs should be unique
      expect(guids.size).toBe(1000);
    });
  });
});
