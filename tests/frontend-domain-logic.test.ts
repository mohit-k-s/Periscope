import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  categorizeWaitEvent,
  resolvePeriodInSeconds,
  WAIT_CATEGORY_COLORS,
  AWS_REGIONS,
  GranularitySetting,
} from '../src/types.ts';
import type { TimeRangePreset } from '../src/components/TimeRangePicker.tsx';

describe('Frontend Domain Logic & UI Helpers (Behavioral Tests)', () => {
  describe('categorizeWaitEvent()', () => {
    it('categorizes CPU related wait states correctly', () => {
      assert.equal(categorizeWaitEvent('CPU'), 'CPU');
      assert.equal(categorizeWaitEvent('cpu'), 'CPU');
      assert.equal(categorizeWaitEvent('CPU:Running'), 'CPU');
    });

    it('categorizes disk and table I/O wait states correctly', () => {
      assert.equal(categorizeWaitEvent('IO:DataFileRead'), 'IO');
      assert.equal(categorizeWaitEvent('io:bufwrite'), 'IO');
      assert.equal(categorizeWaitEvent('db:checkpoint:read'), 'IO');
      assert.equal(categorizeWaitEvent('io:walwrite'), 'IO');
    });

    it('categorizes lock and transaction contention wait states correctly', () => {
      assert.equal(categorizeWaitEvent('Lock:transaction'), 'Lock');
      assert.equal(categorizeWaitEvent('Lock:relation'), 'Lock');
      assert.equal(categorizeWaitEvent('deadlock:detection'), 'Lock');
      assert.equal(categorizeWaitEvent('tuple:lock'), 'Lock');
    });

    it('categorizes buffer, lwlock and latch concurrency wait states correctly', () => {
      assert.equal(categorizeWaitEvent('Buffer:content'), 'Concurrency');
      assert.equal(categorizeWaitEvent('LWLock:buffer_mapping'), 'Concurrency');
      assert.equal(categorizeWaitEvent('LWLock:LockManager'), 'Concurrency');
      assert.equal(categorizeWaitEvent('latch:sync'), 'Concurrency');
      assert.equal(categorizeWaitEvent('concurrency:queue'), 'Concurrency');
      assert.equal(categorizeWaitEvent('concurrency'), 'Concurrency');
    });

    it('categorizes client and network wait states correctly', () => {
      assert.equal(categorizeWaitEvent('Client:ClientRead'), 'Network');
      assert.equal(categorizeWaitEvent('network:socket_read'), 'Network');
      assert.equal(categorizeWaitEvent('clientread:wait'), 'Network');
      assert.equal(categorizeWaitEvent('network'), 'Network');
    });

    it('falls back to Other for unrecognized wait events', () => {
      assert.equal(categorizeWaitEvent('Activity:vacuum'), 'Other');
      assert.equal(categorizeWaitEvent('IPC:message'), 'Other');
      assert.equal(categorizeWaitEvent('Other'), 'Other');
      assert.equal(categorizeWaitEvent('other'), 'Other');
    });
  });

  describe('resolvePeriodInSeconds()', () => {
    it('returns fixed seconds when explicit user granularity setting is chosen', () => {
      assert.equal(resolvePeriodInSeconds('1s', 99999999), 1);
      assert.equal(resolvePeriodInSeconds('1m', 99999999), 60);
      assert.equal(resolvePeriodInSeconds('5m', 99999999), 300);
      assert.equal(resolvePeriodInSeconds('1h', 1000), 3600);
    });

    it('adapts auto granularity according to window duration', () => {
      // <= 10 min (600,000 ms) -> 1s
      assert.equal(resolvePeriodInSeconds('auto', 5 * 60 * 1000), 1);
      assert.equal(resolvePeriodInSeconds('auto', 10 * 60 * 1000), 1);

      // <= 6 hours (21,600,000 ms) -> 60s
      assert.equal(resolvePeriodInSeconds('auto', 15 * 60 * 1000), 60);
      assert.equal(resolvePeriodInSeconds('auto', 60 * 60 * 1000), 60);
      assert.equal(resolvePeriodInSeconds('auto', 6 * 3600 * 1000), 60);

      // <= 48 hours (172,800,000 ms) -> 300s
      assert.equal(resolvePeriodInSeconds('auto', 12 * 3600 * 1000), 300);
      assert.equal(resolvePeriodInSeconds('auto', 24 * 3600 * 1000), 300);
      assert.equal(resolvePeriodInSeconds('auto', 48 * 3600 * 1000), 300);

      // > 48 hours (e.g. 7 days = 604,800,000 ms) -> 3600s
      assert.equal(resolvePeriodInSeconds('auto', 7 * 86400 * 1000), 3600);
      assert.equal(resolvePeriodInSeconds('auto', 30 * 86400 * 1000), 3600);
    });
  });

  describe('TimeRangePreset calculations & Extended Presets', () => {
    const calculateDurationMs = (preset: TimeRangePreset): number => {
      if (preset === '5m') return 5 * 60 * 1000;
      if (preset === '15m') return 15 * 60 * 1000;
      if (preset === '1h') return 60 * 60 * 1000;
      if (preset === '3h') return 3 * 60 * 60 * 1000;
      if (preset === '24h') return 24 * 60 * 60 * 1000;
      if (preset === '7d') return 7 * 24 * 60 * 60 * 1000;
      if (preset === '14d') return 14 * 24 * 60 * 60 * 1000;
      if (preset === '30d') return 30 * 24 * 60 * 60 * 1000;
      if (preset === '90d') return 90 * 24 * 60 * 60 * 1000;
      return 60 * 60 * 1000;
    };

    it('calculates exact duration for standard presets (<= 7d)', () => {
      assert.equal(calculateDurationMs('5m'), 300_000);
      assert.equal(calculateDurationMs('15m'), 900_000);
      assert.equal(calculateDurationMs('1h'), 3_600_000);
      assert.equal(calculateDurationMs('3h'), 10_800_000);
      assert.equal(calculateDurationMs('24h'), 86_400_000);
      assert.equal(calculateDurationMs('7d'), 604_800_000);
    });

    it('calculates extended archive presets beyond AWS free tier (14d, 30d, 90d)', () => {
      assert.equal(calculateDurationMs('14d'), 14 * 86_400_000);
      assert.equal(calculateDurationMs('30d'), 30 * 86_400_000);
      assert.equal(calculateDurationMs('90d'), 90 * 86_400_000);
    });
  });

  describe('Multi-Scoping Isolation & Filter Conflict Rules', () => {
    interface FilterState {
      selectedSqlIds: string[];
      selectedWaitCategories: string[];
      selectedHostIds: string[];
      selectedUserIds: string[];
    }

    // Pure reducer implementation of the scoping logic in App.tsx
    const applyToggleSql = (state: FilterState, sqlId: string): FilterState => {
      const exists = state.selectedSqlIds.includes(sqlId);
      const newSqls = exists
        ? state.selectedSqlIds.filter((id) => id !== sqlId)
        : [...state.selectedSqlIds, sqlId];
      return {
        ...state,
        selectedSqlIds: newSqls,
        // Clears conflicting entity dimensions (AWS PI cannot cross-join SQL + Host/User)
        selectedHostIds: [],
        selectedUserIds: [],
      };
    };

    const applyToggleHost = (state: FilterState, hostId: string): FilterState => {
      const exists = state.selectedHostIds.includes(hostId);
      const newHosts = exists
        ? state.selectedHostIds.filter((id) => id !== hostId)
        : [...state.selectedHostIds, hostId];
      return {
        ...state,
        selectedHostIds: newHosts,
        selectedSqlIds: [],
        selectedUserIds: [],
      };
    };

    const applyToggleUser = (state: FilterState, userName: string): FilterState => {
      const exists = state.selectedUserIds.includes(userName);
      const newUsers = exists
        ? state.selectedUserIds.filter((name) => name !== userName)
        : [...state.selectedUserIds, userName];
      return {
        ...state,
        selectedUserIds: newUsers,
        selectedSqlIds: [],
        selectedHostIds: [],
      };
    };

    const applyClearAll = (): FilterState => ({
      selectedSqlIds: [],
      selectedWaitCategories: [],
      selectedHostIds: [],
      selectedUserIds: [],
    });

    it('toggling SQL preserves Wait Category filters but clears conflicting Host and User scopes', () => {
      const initial: FilterState = {
        selectedSqlIds: [],
        selectedWaitCategories: ['IO'],
        selectedHostIds: ['ip-10-0-1-5'],
        selectedUserIds: ['app_user'],
      };

      const result = applyToggleSql(initial, 'sql-slow-query-123');

      assert.deepEqual(result.selectedSqlIds, ['sql-slow-query-123']);
      assert.deepEqual(result.selectedWaitCategories, ['IO']); // preserved
      assert.deepEqual(result.selectedHostIds, []); // cleared
      assert.deepEqual(result.selectedUserIds, []); // cleared
    });

    it('toggling Host clears SQL and User scopes while preserving Wait Categories', () => {
      const initial: FilterState = {
        selectedSqlIds: ['sql-slow-query-123'],
        selectedWaitCategories: ['Lock'],
        selectedHostIds: [],
        selectedUserIds: ['app_user'],
      };

      const result = applyToggleHost(initial, '10.0.4.12');

      assert.deepEqual(result.selectedHostIds, ['10.0.4.12']);
      assert.deepEqual(result.selectedSqlIds, []);
      assert.deepEqual(result.selectedUserIds, []);
      assert.deepEqual(result.selectedWaitCategories, ['Lock']);
    });

    it('toggling User clears SQL and Host scopes while preserving Wait Categories', () => {
      const initial: FilterState = {
        selectedSqlIds: ['sql-1'],
        selectedWaitCategories: ['CPU'],
        selectedHostIds: ['10.0.0.1'],
        selectedUserIds: [],
      };

      const result = applyToggleUser(initial, 'batch_etl_worker');

      assert.deepEqual(result.selectedUserIds, ['batch_etl_worker']);
      assert.deepEqual(result.selectedSqlIds, []);
      assert.deepEqual(result.selectedHostIds, []);
      assert.deepEqual(result.selectedWaitCategories, ['CPU']);
    });

    it('clears all active filters on reset', () => {
      const cleared = applyClearAll();
      assert.deepEqual(cleared.selectedSqlIds, []);
      assert.deepEqual(cleared.selectedWaitCategories, []);
      assert.deepEqual(cleared.selectedHostIds, []);
      assert.deepEqual(cleared.selectedUserIds, []);
    });
  });

  describe('Theme & Regional UI Constants', () => {
    it('defines colors and metadata for all major wait categories', () => {
      const categories = ['CPU', 'IO', 'Lock', 'Concurrency', 'Network', 'Other'];
      for (const cat of categories) {
        assert.ok(WAIT_CATEGORY_COLORS[cat], `Missing color config for ${cat}`);
        assert.ok(WAIT_CATEGORY_COLORS[cat].bg);
        assert.ok(WAIT_CATEGORY_COLORS[cat].border);
        assert.ok(WAIT_CATEGORY_COLORS[cat].fill);
      }
    });

    it('contains valid AWS regions including ap-south-1 Mumbai and us-east-1', () => {
      const regionIds = AWS_REGIONS.map((r) => r.id);
      assert.ok(regionIds.includes('ap-south-1'));
      assert.ok(regionIds.includes('us-east-1'));
      assert.ok(regionIds.includes('eu-west-1'));
    });
  });
});
