import { create } from 'zustand';
import {
  Event, Alarm, Confirmation, Rule, Session, ReplayState, ExportedTimeline, Snapshot,
  ExportedSnapshot, SnapshotConflictResult, ImportResult, SnapshotOperationLog,
  SnapshotLogAction, ImportConflictStrategy, ExportedSnapshotBatch, SnapshotSortOrder,
} from '../engine/types';
import { EventProcessor, importEvents } from '../engine/eventProcessor';
import { validateUndoConfirmation } from '../engine/outOfOrderHandler';
import { generateId } from '../utils/time';
import { sampleEvents, defaultRules } from '../data/sampleEvents';

interface ReplayActions {
  play: (speed?: number) => void;
  pause: () => void;
  jumpTo: (timestamp: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  reset: () => void;
  confirmAlarm: (alarmId: string, remark: string) => void;
  undoConfirmation: (confirmationId: string) => void;
  loadSampleEvents: () => void;
  importEventsFromJson: (jsonString: string) => void;
  exportTimeline: (includeState?: boolean) => string;
  loadSession: () => void;
  saveSession: () => void;
  clearSession: () => void;
  setOperator: (operator: string) => void;
  setOperatorNotes: (notes: string) => void;
  addRule: (rule: Omit<Rule, 'ruleId' | 'createdAt'>) => void;
  updateRule: (ruleId: string, updates: Partial<Rule>) => void;
  deleteRule: (ruleId: string) => void;
  toggleRule: (ruleId: string) => void;
  setErrorMessage: (message: string) => void;
  setSpeed: (speed: number) => void;
  setEvents: (events: Event[]) => void;
  checkSnapshotConflict: (name: string) => SnapshotConflictResult;
  saveSnapshot: (name: string, description?: string, forceOverwrite?: boolean) => { success: boolean; snapshot?: Snapshot; conflict?: boolean; error?: string };
  restoreSnapshot: (snapshotId: string) => boolean;
  undoRestoreSnapshot: () => boolean;
  deleteSnapshot: (snapshotId: string) => boolean;
  exportSnapshot: (snapshotId: string) => string;
  importSnapshot: (jsonString: string, conflictStrategy?: ImportConflictStrategy) => ImportResult;
  renameSnapshot: (snapshotId: string, newName: string) => { success: boolean; error?: string };
  updateSnapshotDescription: (snapshotId: string, description: string) => { success: boolean; error?: string };
  batchRenameSnapshots: (snapshotIds: string[], pattern: 'prefix' | 'suffix' | 'replace', value: string, startIndex?: number) => { success: boolean; updatedCount: number; errors?: string[] };
  batchUpdateSnapshotsDescription: (snapshotIds: string[], description: string, mode?: 'replace' | 'append' | 'prepend') => { success: boolean; updatedCount: number };
  batchDeleteSnapshots: (snapshotIds: string[]) => { success: boolean; deletedCount: number };
  batchExportSnapshots: (snapshotIds: string[]) => string;
  filterSnapshots: (keyword: string) => Snapshot[];
  sortSnapshots: (snapshots: Snapshot[], order: SnapshotSortOrder) => Snapshot[];
  checkImportConflicts: (jsonString: string) => { success: boolean; hasConflict: boolean; conflictingNames?: string[]; snapshotsToImport?: Snapshot[]; error?: string };
  importSnapshots: (jsonString: string, conflictStrategy: ImportConflictStrategy) => ImportResult;
  clearSnapshotLogs: () => void;
}

const STORAGE_KEYS = {
  SESSION: 'replay:session',
  EVENTS: 'replay:events',
  RULES: 'replay:rules',
  LAST_EXPORT: 'replay:lastExport',
  SNAPSHOTS: 'replay:snapshots',
  SNAPSHOT_LOGS: 'replay:snapshotLogs',
};

const SNAPSHOT_SCHEMA_VERSION = 1;
const BATCH_EXPORT_SCHEMA_VERSION = 1;
const MAX_LOG_ENTRIES = 500;

const TIME_SCALE = 1000;

function getInitialState(): ReplayState {
  const sortedEvents = [...sampleEvents].sort((a, b) => a.timestamp - b.timestamp);
  const startTime = sortedEvents.length > 0 ? sortedEvents[0].timestamp : 0;
  const endTime = sortedEvents.length > 0 ? sortedEvents[sortedEvents.length - 1].timestamp : 0;

  return {
    isPlaying: false,
    speed: 1,
    cursor: startTime,
    startTime,
    endTime,
    progress: 0,
    activeAlarms: [],
    pendingEvents: [],
    processedEvents: [],
    currentEventIndex: 0,
    events: sortedEvents,
    rules: [...defaultRules],
    confirmations: [],
    operator: '操作员',
    operatorNotes: '',
    lastExport: '',
    errorMessage: '',
    snapshots: [],
    preRestoreSnapshot: null,
    snapshotLogs: [],
  };
}

export const useReplayStore = create<ReplayState & ReplayActions>((set, get) => {
  let eventProcessor: EventProcessor | null = null;
  let tickInterval: ReturnType<typeof setInterval> | null = null;

  const getEventProcessor = (): EventProcessor => {
    if (!eventProcessor) {
      eventProcessor = new EventProcessor(get().rules, get().processedEvents);
    }
    return eventProcessor;
  };

  const saveSnapshotsToStorage = (): void => {
    const state = get();
    try {
      localStorage.setItem(STORAGE_KEYS.SNAPSHOTS, JSON.stringify(state.snapshots));
    } catch (e) {
      console.error('保存快照失败:', e);
    }
  };

  const saveLogsToStorage = (): void => {
    const state = get();
    try {
      const logs = state.snapshotLogs.slice(-MAX_LOG_ENTRIES);
      localStorage.setItem(STORAGE_KEYS.SNAPSHOT_LOGS, JSON.stringify(logs));
    } catch (e) {
      console.error('保存操作日志失败:', e);
    }
  };

  const addSnapshotLog = (
    action: SnapshotLogAction,
    snapshotIds: string[],
    snapshotNames: string[],
    detail?: string,
  ): void => {
    const state = get();
    const log: SnapshotOperationLog = {
      logId: generateId(),
      action,
      timestamp: Date.now(),
      snapshotIds,
      snapshotNames,
      operator: state.operator,
      detail,
    };
    const newLogs = [...state.snapshotLogs, log].slice(-MAX_LOG_ENTRIES);
    set({ snapshotLogs: newLogs });
    saveLogsToStorage();
  };

  const saveToStorage = (): void => {
    const state = get();
    try {
      const session: Session = {
        cursorPosition: state.cursor,
        ruleVersion: state.rules.length > 0 ? state.rules[0].version : 'v1.0',
        confirmations: state.confirmations,
        operatorNotes: state.operatorNotes,
        exportContent: state.lastExport,
        savedAt: Date.now(),
      };

      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
      localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(state.events));
      localStorage.setItem(STORAGE_KEYS.RULES, JSON.stringify(state.rules));
      localStorage.setItem(STORAGE_KEYS.LAST_EXPORT, state.lastExport);
      saveSnapshotsToStorage();
      saveLogsToStorage();
    } catch (e) {
      console.error('保存会话失败:', e);
    }
  };

  const stopTick = (): void => {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  };

  const startTick = (speed: number): void => {
    stopTick();
    set({ isPlaying: true });

    tickInterval = setInterval(() => {
      const state = get();
      if (!state.isPlaying) return;

      const nextCursor = state.cursor + speed * TIME_SCALE;
      const newCursor = Math.min(nextCursor, state.endTime);

      let currentIndex = state.currentEventIndex;
      let currentAlarms = [...state.activeAlarms];
      const newProcessedEvents = [...state.processedEvents];
      let currentPendingEvents = [...state.pendingEvents];

      const processor = getEventProcessor();

      while (currentIndex < state.events.length) {
        const event = state.events[currentIndex];
        if (event.timestamp <= newCursor) {
          const result = processor.processEvent(event, currentAlarms, state.events);
          currentAlarms = result.updatedAlarms;
          newProcessedEvents.push(result.markedEvent);

          if (result.status === 'pending') {
            currentPendingEvents.push(result.markedEvent);
          } else if (result.status === 'matched_early_clear' && result.markedEvent.correlationId) {
            currentPendingEvents = currentPendingEvents.filter(
              e => e.correlationId !== result.markedEvent.correlationId,
            );
          }

          currentIndex++;
        } else {
          break;
        }
      }

      const duration = state.endTime - state.startTime;
      const progress = duration > 0 ? ((newCursor - state.startTime) / duration * 100) : 0;

      set({
        cursor: newCursor,
        currentEventIndex: currentIndex,
        activeAlarms: currentAlarms,
        pendingEvents: currentPendingEvents,
        processedEvents: newProcessedEvents,
        progress,
      });

      if (newCursor >= state.endTime) {
        stopTick();
        set({ isPlaying: false });
        const orphanClears = processor.finalize();
        if (orphanClears.length > 0) {
          set((state) => ({
            pendingEvents: [...state.pendingEvents, ...orphanClears],
          }));
        }
      }

      saveToStorage();
    }, 100);
  };

  const replayToCursor = (targetCursor: number): void => {
    const state = get();
    const processor = new EventProcessor(state.rules);
    let currentIndex = 0;
    let currentAlarms: Alarm[] = [];
    const processedEvents: Event[] = [];
    let currentPendingEvents: Event[] = [];

    while (currentIndex < state.events.length) {
      const event = state.events[currentIndex];
      if (event.timestamp <= targetCursor) {
        const result = processor.processEvent(event, currentAlarms, state.events);
        currentAlarms = result.updatedAlarms;
        processedEvents.push(result.markedEvent);

        if (result.status === 'pending') {
          currentPendingEvents.push(result.markedEvent);
        } else if (result.status === 'matched_early_clear' && result.markedEvent.correlationId) {
          currentPendingEvents = currentPendingEvents.filter(
            e => e.correlationId !== result.markedEvent.correlationId,
          );
        }
        currentIndex++;
      } else {
        break;
      }
    }

    const duration = state.endTime - state.startTime;
    const progress = duration > 0 ? ((targetCursor - state.startTime) / duration * 100) : 0;

    eventProcessor = processor;

    set({
      cursor: targetCursor,
      currentEventIndex: currentIndex,
      activeAlarms: currentAlarms,
      processedEvents,
      pendingEvents: currentPendingEvents,
      progress,
    });
  };

  const validateSnapshot = (snap: unknown): { valid: boolean; error?: string } => {
    if (!snap || typeof snap !== 'object') {
      return { valid: false, error: '快照数据不是有效对象' };
    }
    const s = snap as Record<string, unknown>;
    const requiredFields = [
      'snapshotId', 'name', 'createdAt', 'cursor', 'currentEventIndex',
      'events', 'activeAlarms', 'processedEvents', 'pendingEvents',
      'confirmations', 'rules', 'operator', 'startTime', 'endTime',
    ];
    for (const field of requiredFields) {
      if (!(field in s)) {
        return { valid: false, error: `快照字段缺失: ${field}` };
      }
    }
    if (!Array.isArray(s.events) || s.events.length === 0) {
      return { valid: false, error: '快照事件数据无效' };
    }
    return { valid: true };
  };

  return {
    ...getInitialState(),

    play: (speed = 1) => {
      startTick(speed);
    },

    pause: () => {
      stopTick();
      set({ isPlaying: false });
    },

    jumpTo: (timestamp: number) => {
      const state = get();
      const target = Math.max(state.startTime, Math.min(timestamp, state.endTime));
      stopTick();
      replayToCursor(target);
      saveToStorage();
    },

    stepForward: () => {
      const state = get();
      if (state.currentEventIndex < state.events.length) {
        const nextEvent = state.events[state.currentEventIndex];
        if (nextEvent) {
          stopTick();
          replayToCursor(nextEvent.timestamp);
          saveToStorage();
        }
      }
    },

    stepBackward: () => {
      const state = get();
      if (state.currentEventIndex > 0) {
        const prevIndex = Math.max(0, state.currentEventIndex - 1);
        const prevEvent = state.events[prevIndex];
        if (prevEvent) {
          stopTick();
          replayToCursor(prevEvent.timestamp);
          saveToStorage();
        }
      }
    },

    reset: () => {
      stopTick();
      const initial = getInitialState();
      eventProcessor = null;
      const curr = get();
      set({
        ...initial,
        events: curr.events,
        rules: curr.rules,
        operator: curr.operator,
        snapshots: curr.snapshots,
        snapshotLogs: curr.snapshotLogs,
      });
      saveToStorage();
    },

    confirmAlarm: (alarmId: string, remark: string) => {
      const state = get();
      const alarmIndex = state.activeAlarms.findIndex(a => a.alarmId === alarmId);

      if (alarmIndex === -1) {
        set({ errorMessage: '告警不存在' });
        return;
      }

      const confirmation: Confirmation = {
        confirmationId: generateId(),
        alarmId,
        operator: state.operator,
        remark: remark || '已确认',
        timestamp: state.cursor,
        type: 'confirm',
        active: true,
      };

      const updatedAlarms = [...state.activeAlarms];
      updatedAlarms[alarmIndex] = {
        ...updatedAlarms[alarmIndex],
        status: 'confirmed',
        confirmationId: confirmation.confirmationId,
      };

      set({
        activeAlarms: updatedAlarms,
        confirmations: [...state.confirmations, confirmation],
        errorMessage: '',
      });

      saveToStorage();
    },

    undoConfirmation: (confirmationId: string) => {
      const state = get();
      const validation = validateUndoConfirmation(confirmationId, state.confirmations);

      if (!validation.valid) {
        set({ errorMessage: validation.error || '撤销失败' });
        return;
      }

      const confirmation = state.confirmations.find(c => c.confirmationId === confirmationId);
      if (!confirmation) return;

      const undoConfirmationRecord: Confirmation = {
        confirmationId: generateId(),
        alarmId: confirmation.alarmId,
        operator: state.operator,
        remark: `撤销确认: ${confirmation.remark}`,
        timestamp: state.cursor,
        type: 'undo',
        active: true,
      };

      const updatedConfirmations = state.confirmations.map(c =>
        c.confirmationId === confirmationId ? { ...c, active: false } : c,
      );

      const updatedAlarms = state.activeAlarms.map(a =>
        a.confirmationId === confirmationId ? { ...a, status: 'active' as const, confirmationId: undefined } : a,
      );

      set({
        confirmations: [...updatedConfirmations, undoConfirmationRecord],
        activeAlarms: updatedAlarms,
        errorMessage: '',
      });

      saveToStorage();
    },

    loadSampleEvents: () => {
      stopTick();
      const events = [...sampleEvents].sort((a, b) => a.timestamp - b.timestamp);
      const startTime = events[0].timestamp;
      const endTime = events[events.length - 1].timestamp;
      eventProcessor = null;

      set({
        events,
        startTime,
        endTime,
        cursor: startTime,
        currentEventIndex: 0,
        activeAlarms: [],
        processedEvents: [],
        pendingEvents: [],
        progress: 0,
        isPlaying: false,
      });
      saveToStorage();
    },

    importEventsFromJson: (jsonString: string) => {
      try {
        const events = importEvents(jsonString);
        stopTick();
        const startTime = events.length > 0 ? events[0].timestamp : 0;
        const endTime = events.length > 0 ? events[events.length - 1].timestamp : 0;
        eventProcessor = null;

        set({
          events,
          startTime,
          endTime,
          cursor: startTime,
          currentEventIndex: 0,
          activeAlarms: [],
          processedEvents: [],
          pendingEvents: [],
          progress: 0,
          isPlaying: false,
          errorMessage: '',
        });
        saveToStorage();
      } catch (e) {
        set({ errorMessage: (e as Error).message });
      }
    },

    exportTimeline: (includeState = true): string => {
      const state = get();

      const eventsWithStatus: Event[] = state.events.map((event, index) => {
        const processed = state.processedEvents[index];
        if (processed && processed.status) {
          return { ...event, status: processed.status };
        }
        return { ...event, status: 'normal' };
      });

      const exportData: ExportedTimeline = {
        exportTime: Date.now(),
        replayCursor: state.cursor,
        events: eventsWithStatus,
        alarms: state.activeAlarms,
        confirmations: state.confirmations,
        includeState,
      };

      if (includeState) {
        exportData.cursorPosition = state.cursor;
        exportData.ruleVersion = state.rules.length > 0 ? state.rules[0].version : 'v1.0';
        exportData.operator = state.operator;
        exportData.operatorNotes = state.operatorNotes;
      }

      const json = JSON.stringify(exportData, null, 2);
      set({ lastExport: json });
      saveToStorage();

      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `replay-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      return json;
    },

    loadSession: () => {
      try {
        const sessionStr = localStorage.getItem(STORAGE_KEYS.SESSION);
        const eventsStr = localStorage.getItem(STORAGE_KEYS.EVENTS);
        const rulesStr = localStorage.getItem(STORAGE_KEYS.RULES);
        const lastExportStr = localStorage.getItem(STORAGE_KEYS.LAST_EXPORT);
        const snapshotsStr = localStorage.getItem(STORAGE_KEYS.SNAPSHOTS);
        const logsStr = localStorage.getItem(STORAGE_KEYS.SNAPSHOT_LOGS);

        if (!sessionStr || !eventsStr) return;

        const session: Session = JSON.parse(sessionStr);
        const events: Event[] = JSON.parse(eventsStr);
        const rules: Rule[] = rulesStr ? JSON.parse(rulesStr) : defaultRules;
        let snapshots: Snapshot[] = [];
        if (snapshotsStr) {
          try {
            const parsed = JSON.parse(snapshotsStr);
            snapshots = Array.isArray(parsed) ? parsed.filter((s): s is Snapshot => validateSnapshot(s).valid) : [];
          } catch {
            snapshots = [];
          }
        }
        let snapshotLogs: SnapshotOperationLog[] = [];
        if (logsStr) {
          try {
            const parsed = JSON.parse(logsStr);
            snapshotLogs = Array.isArray(parsed) ? parsed : [];
          } catch {
            snapshotLogs = [];
          }
        }

        stopTick();
        eventProcessor = null;

        const startTime = events.length > 0 ? events[0].timestamp : 0;
        const endTime = events.length > 0 ? events[events.length - 1].timestamp : 0;

        set({
          events,
          rules,
          startTime,
          endTime,
          cursor: session.cursorPosition,
          confirmations: session.confirmations,
          operatorNotes: session.operatorNotes,
          lastExport: lastExportStr || '',
          snapshots,
          snapshotLogs,
          preRestoreSnapshot: null,
          isPlaying: false,
          currentEventIndex: 0,
          activeAlarms: [],
          processedEvents: [],
          pendingEvents: [],
          progress: 0,
        });

        replayToCursor(session.cursorPosition);

        const state = get();
        const activeAlarmsWithConfirmations = state.activeAlarms.map(alarm => {
          const conf = session.confirmations.find(
            c => c.alarmId === alarm.alarmId && c.type === 'confirm' && c.active,
          );
          if (conf) {
            return { ...alarm, status: 'confirmed' as const, confirmationId: conf.confirmationId };
          }
          return alarm;
        });

        set({ activeAlarms: activeAlarmsWithConfirmations });
      } catch (e) {
        console.error('恢复会话失败:', e);
        set({ errorMessage: '恢复会话失败，已重置' });
      }
    },

    saveSession: () => {
      saveToStorage();
    },

    clearSession: () => {
      Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
      stopTick();
      eventProcessor = null;
      set(getInitialState());
    },

    setOperator: (operator: string) => {
      set({ operator });
      saveToStorage();
    },

    setOperatorNotes: (notes: string) => {
      set({ operatorNotes: notes });
      saveToStorage();
    },

    addRule: (ruleData) => {
      const newRule: Rule = {
        ...ruleData,
        ruleId: generateId(),
        createdAt: Date.now(),
      };
      set(state => ({ rules: [...state.rules, newRule] }));
      saveToStorage();
    },

    updateRule: (ruleId, updates) => {
      set(state => ({
        rules: state.rules.map(r => r.ruleId === ruleId ? { ...r, ...updates } : r),
      }));
      saveToStorage();
    },

    deleteRule: (ruleId) => {
      set(state => ({
        rules: state.rules.filter(r => r.ruleId !== ruleId),
      }));
      saveToStorage();
    },

    toggleRule: (ruleId) => {
      set(state => ({
        rules: state.rules.map(r =>
          r.ruleId === ruleId ? { ...r, enabled: !r.enabled } : r,
        ),
      }));
      saveToStorage();
    },

    setErrorMessage: (message: string) => {
      set({ errorMessage: message });
    },

    setSpeed: (speed: number) => {
      set({ speed });
      if (get().isPlaying) {
        startTick(speed);
      }
    },

    setEvents: (events: Event[]) => {
      const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
      const startTime = sorted.length > 0 ? sorted[0].timestamp : 0;
      const endTime = sorted.length > 0 ? sorted[sorted.length - 1].timestamp : 0;

      stopTick();
      eventProcessor = null;

      set({
        events: sorted,
        startTime,
        endTime,
        cursor: startTime,
        currentEventIndex: 0,
        activeAlarms: [],
        processedEvents: [],
        pendingEvents: [],
        progress: 0,
        isPlaying: false,
      });
      saveToStorage();
    },

    checkSnapshotConflict: (name: string): SnapshotConflictResult => {
      const state = get();
      const existing = state.snapshots.find(s => s.name === name);
      return {
        hasConflict: !!existing,
        existingSnapshot: existing,
      };
    },

    saveSnapshot: (name: string, description?: string, forceOverwrite = false) => {
      if (!name || !name.trim()) {
        return { success: false, error: '快照名称不能为空' };
      }

      const state = get();
      const conflict = get().checkSnapshotConflict(name);

      if (conflict.hasConflict && !forceOverwrite) {
        return { success: false, conflict: true, existingSnapshot: conflict.existingSnapshot };
      }

      const snapshot: Snapshot = {
        snapshotId: generateId(),
        name: name.trim(),
        description: description?.trim(),
        createdAt: Date.now(),
        cursor: state.cursor,
        currentEventIndex: state.currentEventIndex,
        events: JSON.parse(JSON.stringify(state.events)),
        activeAlarms: JSON.parse(JSON.stringify(state.activeAlarms)),
        processedEvents: JSON.parse(JSON.stringify(state.processedEvents)),
        pendingEvents: JSON.parse(JSON.stringify(state.pendingEvents)),
        confirmations: JSON.parse(JSON.stringify(state.confirmations)),
        rules: JSON.parse(JSON.stringify(state.rules)),
        operator: state.operator,
        operatorNotes: state.operatorNotes,
        startTime: state.startTime,
        endTime: state.endTime,
      };

      let newSnapshots: Snapshot[];
      let returnedSnapshot: Snapshot;
      let logAction: SnapshotLogAction = 'create';

      if (conflict.hasConflict && forceOverwrite) {
        newSnapshots = state.snapshots.map(s =>
          s.name === name ? { ...snapshot, snapshotId: s.snapshotId, createdAt: s.createdAt } : s,
        );
        returnedSnapshot = newSnapshots.find(s => s.name === name)!;
        logAction = 'update';
      } else {
        newSnapshots = [...state.snapshots, snapshot];
        returnedSnapshot = snapshot;
      }

      set({ snapshots: newSnapshots });
      saveSnapshotsToStorage();
      addSnapshotLog(logAction, [returnedSnapshot.snapshotId], [returnedSnapshot.name], description?.trim());

      return { success: true, snapshot: returnedSnapshot };
    },

    restoreSnapshot: (snapshotId: string): boolean => {
      const state = get();
      const snapshot = state.snapshots.find(s => s.snapshotId === snapshotId);

      if (!snapshot) {
        set({ errorMessage: '快照不存在' });
        return false;
      }

      const currentState = get();
      const preRestoreSnapshot: Snapshot = {
        snapshotId: generateId(),
        name: '__pre_restore__',
        createdAt: Date.now(),
        cursor: currentState.cursor,
        currentEventIndex: currentState.currentEventIndex,
        events: JSON.parse(JSON.stringify(currentState.events)),
        activeAlarms: JSON.parse(JSON.stringify(currentState.activeAlarms)),
        processedEvents: JSON.parse(JSON.stringify(currentState.processedEvents)),
        pendingEvents: JSON.parse(JSON.stringify(currentState.pendingEvents)),
        confirmations: JSON.parse(JSON.stringify(currentState.confirmations)),
        rules: JSON.parse(JSON.stringify(currentState.rules)),
        operator: currentState.operator,
        operatorNotes: currentState.operatorNotes,
        startTime: currentState.startTime,
        endTime: currentState.endTime,
      };

      stopTick();
      eventProcessor = new EventProcessor(snapshot.rules, snapshot.processedEvents);

      const duration = snapshot.endTime - snapshot.startTime;
      const progress = duration > 0 ? ((snapshot.cursor - snapshot.startTime) / duration * 100) : 0;

      set({
        cursor: snapshot.cursor,
        currentEventIndex: snapshot.currentEventIndex,
        events: JSON.parse(JSON.stringify(snapshot.events)),
        activeAlarms: JSON.parse(JSON.stringify(snapshot.activeAlarms)),
        processedEvents: JSON.parse(JSON.stringify(snapshot.processedEvents)),
        pendingEvents: JSON.parse(JSON.stringify(snapshot.pendingEvents)),
        confirmations: JSON.parse(JSON.stringify(snapshot.confirmations)),
        rules: JSON.parse(JSON.stringify(snapshot.rules)),
        operator: snapshot.operator,
        operatorNotes: snapshot.operatorNotes,
        startTime: snapshot.startTime,
        endTime: snapshot.endTime,
        progress,
        isPlaying: false,
        preRestoreSnapshot,
        errorMessage: '',
      });

      saveToStorage();
      addSnapshotLog('restore', [snapshot.snapshotId], [snapshot.name]);
      return true;
    },

    undoRestoreSnapshot: (): boolean => {
      const state = get();
      const preSnapshot = state.preRestoreSnapshot;

      if (!preSnapshot) {
        set({ errorMessage: '没有可撤销的恢复操作' });
        return false;
      }

      stopTick();
      eventProcessor = new EventProcessor(preSnapshot.rules, preSnapshot.processedEvents);

      const duration = preSnapshot.endTime - preSnapshot.startTime;
      const progress = duration > 0 ? ((preSnapshot.cursor - preSnapshot.startTime) / duration * 100) : 0;

      set({
        cursor: preSnapshot.cursor,
        currentEventIndex: preSnapshot.currentEventIndex,
        events: JSON.parse(JSON.stringify(preSnapshot.events)),
        activeAlarms: JSON.parse(JSON.stringify(preSnapshot.activeAlarms)),
        processedEvents: JSON.parse(JSON.stringify(preSnapshot.processedEvents)),
        pendingEvents: JSON.parse(JSON.stringify(preSnapshot.pendingEvents)),
        confirmations: JSON.parse(JSON.stringify(preSnapshot.confirmations)),
        rules: JSON.parse(JSON.stringify(preSnapshot.rules)),
        operator: preSnapshot.operator,
        operatorNotes: preSnapshot.operatorNotes,
        startTime: preSnapshot.startTime,
        endTime: preSnapshot.endTime,
        progress,
        isPlaying: false,
        preRestoreSnapshot: null,
        errorMessage: '',
      });

      saveToStorage();
      addSnapshotLog('undo_restore', [], []);
      return true;
    },

    deleteSnapshot: (snapshotId: string): boolean => {
      const state = get();
      const snapshot = state.snapshots.find(s => s.snapshotId === snapshotId);

      if (!snapshot) {
        set({ errorMessage: '快照不存在' });
        return false;
      }

      set({
        snapshots: state.snapshots.filter(s => s.snapshotId !== snapshotId),
      });
      saveSnapshotsToStorage();
      addSnapshotLog('delete', [snapshot.snapshotId], [snapshot.name]);
      return true;
    },

    exportSnapshot: (snapshotId: string): string => {
      const state = get();
      const snapshot = state.snapshots.find(s => s.snapshotId === snapshotId);

      if (!snapshot) {
        set({ errorMessage: '快照不存在' });
        return '';
      }

      const exportData: ExportedSnapshot = {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        exportTime: Date.now(),
        snapshot: JSON.parse(JSON.stringify(snapshot)),
      };

      const json = JSON.stringify(exportData, null, 2);

      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snapshot-${snapshot.name}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addSnapshotLog('export', [snapshot.snapshotId], [snapshot.name]);
      return json;
    },

    importSnapshot: (jsonString: string, conflictStrategy: ImportConflictStrategy = 'keep_both'): ImportResult => {
      return get().importSnapshots(jsonString, conflictStrategy);
    },

    renameSnapshot: (snapshotId: string, newName: string): { success: boolean; error?: string } => {
      if (!newName || !newName.trim()) {
        return { success: false, error: '快照名称不能为空' };
      }
      const trimmedName = newName.trim();
      const state = get();
      const snapshot = state.snapshots.find(s => s.snapshotId === snapshotId);

      if (!snapshot) {
        return { success: false, error: '快照不存在' };
      }

      if (snapshot.name === trimmedName) {
        return { success: true };
      }

      const conflict = state.snapshots.find(s => s.name === trimmedName && s.snapshotId !== snapshotId);
      if (conflict) {
        return { success: false, error: `已存在名为"${trimmedName}"的快照` };
      }

      const oldName = snapshot.name;
      const newSnapshots = state.snapshots.map(s =>
        s.snapshotId === snapshotId ? { ...s, name: trimmedName } : s,
      );

      set({ snapshots: newSnapshots });
      saveSnapshotsToStorage();
      addSnapshotLog('rename', [snapshotId], [`${oldName} → ${trimmedName}`]);

      return { success: true };
    },

    updateSnapshotDescription: (snapshotId: string, description: string): { success: boolean; error?: string } => {
      const state = get();
      const snapshot = state.snapshots.find(s => s.snapshotId === snapshotId);

      if (!snapshot) {
        return { success: false, error: '快照不存在' };
      }

      const newSnapshots = state.snapshots.map(s =>
        s.snapshotId === snapshotId ? { ...s, description: description.trim() || undefined } : s,
      );

      set({ snapshots: newSnapshots });
      saveSnapshotsToStorage();
      addSnapshotLog('update', [snapshotId], [snapshot.name], description.trim() || '(清除备注)');

      return { success: true };
    },

    batchRenameSnapshots: (snapshotIds: string[], pattern: 'prefix' | 'suffix' | 'replace', value: string, startIndex = 1): { success: boolean; updatedCount: number; errors?: string[] } => {
      const state = get();
      const errors: string[] = [];
      let updatedCount = 0;
      const usedNames = new Set(state.snapshots.filter(s => !snapshotIds.includes(s.snapshotId)).map(s => s.name));
      const idToName: Record<string, string> = {};

      for (let i = 0; i < snapshotIds.length; i++) {
        const id = snapshotIds[i];
        const snap = state.snapshots.find(s => s.snapshotId === id);
        if (!snap) {
          errors.push(`快照 ${id} 不存在`);
          continue;
        }

        let newName: string;
        switch (pattern) {
          case 'prefix':
            newName = `${value}${snap.name}`;
            break;
          case 'suffix':
            newName = `${snap.name}${value}`;
            break;
          case 'replace':
            newName = `${value}${startIndex + i}`;
            break;
        }

        let finalName = newName;
        let counter = 1;
        while (usedNames.has(finalName)) {
          finalName = `${newName}(${counter})`;
          counter++;
        }
        usedNames.add(finalName);
        idToName[id] = finalName;
      }

      const newSnapshots = state.snapshots.map(s => {
        if (idToName[s.snapshotId]) {
          updatedCount++;
          return { ...s, name: idToName[s.snapshotId] };
        }
        return s;
      });

      set({ snapshots: newSnapshots });
      saveSnapshotsToStorage();

      if (updatedCount > 0) {
        const renamedPairs = snapshotIds
          .map(id => {
            const old = state.snapshots.find(s => s.snapshotId === id);
            const newName = idToName[id];
            return old && newName ? `${old.name}→${newName}` : null;
          })
          .filter((x): x is string => !!x);
        addSnapshotLog('batch_rename', snapshotIds, renamedPairs);
      }

      return { success: errors.length === 0, updatedCount, errors: errors.length > 0 ? errors : undefined };
    },

    batchUpdateSnapshotsDescription: (snapshotIds: string[], description: string, mode: 'replace' | 'append' | 'prepend' = 'replace'): { success: boolean; updatedCount: number } => {
      const state = get();
      let updatedCount = 0;
      const trimmedDesc = description.trim();

      const newSnapshots = state.snapshots.map(s => {
        if (!snapshotIds.includes(s.snapshotId)) return s;
        updatedCount++;

        let newDesc: string | undefined;
        switch (mode) {
          case 'replace':
            newDesc = trimmedDesc || undefined;
            break;
          case 'append':
            newDesc = s.description ? `${s.description} ${trimmedDesc}` : trimmedDesc;
            newDesc = newDesc || undefined;
            break;
          case 'prepend':
            newDesc = s.description ? `${trimmedDesc} ${s.description}` : trimmedDesc;
            newDesc = newDesc || undefined;
            break;
        }
        return { ...s, description: newDesc };
      });

      set({ snapshots: newSnapshots });
      saveSnapshotsToStorage();

      if (updatedCount > 0) {
        const names = snapshotIds
          .map(id => state.snapshots.find(s => s.snapshotId === id)?.name)
          .filter((x): x is string => !!x);
        addSnapshotLog('update', snapshotIds, names, `批量更新备注(${mode}): ${trimmedDesc}`);
      }

      return { success: true, updatedCount };
    },

    batchDeleteSnapshots: (snapshotIds: string[]): { success: boolean; deletedCount: number } => {
      const state = get();
      const toDelete = state.snapshots.filter(s => snapshotIds.includes(s.snapshotId));
      const deletedIds = toDelete.map(s => s.snapshotId);
      const deletedNames = toDelete.map(s => s.name);

      set({
        snapshots: state.snapshots.filter(s => !snapshotIds.includes(s.snapshotId)),
      });
      saveSnapshotsToStorage();

      if (deletedIds.length > 0) {
        addSnapshotLog('batch_delete', deletedIds, deletedNames);
      }

      return { success: true, deletedCount: deletedIds.length };
    },

    batchExportSnapshots: (snapshotIds: string[]): string => {
      const state = get();
      const toExport = state.snapshots.filter(s => snapshotIds.includes(s.snapshotId));

      if (toExport.length === 0) {
        set({ errorMessage: '没有可导出的快照' });
        return '';
      }

      const exportData: ExportedSnapshotBatch = {
        schemaVersion: BATCH_EXPORT_SCHEMA_VERSION,
        exportTime: Date.now(),
        exportedBy: state.operator,
        count: toExport.length,
        snapshots: JSON.parse(JSON.stringify(toExport)),
      };

      const json = JSON.stringify(exportData, null, 2);

      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snapshots-batch-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addSnapshotLog('batch_export', toExport.map(s => s.snapshotId), toExport.map(s => s.name));
      return json;
    },

    filterSnapshots: (keyword: string): Snapshot[] => {
      const state = get();
      const kw = keyword.trim().toLowerCase();
      if (!kw) return state.snapshots;
      return state.snapshots.filter(s =>
        s.name.toLowerCase().includes(kw) ||
        (s.description?.toLowerCase().includes(kw)) ||
        s.operator.toLowerCase().includes(kw),
      );
    },

    sortSnapshots: (snapshots: Snapshot[], order: SnapshotSortOrder): Snapshot[] => {
      const sorted = [...snapshots];
      switch (order) {
        case 'newest_first':
          sorted.sort((a, b) => b.createdAt - a.createdAt);
          break;
        case 'oldest_first':
          sorted.sort((a, b) => a.createdAt - b.createdAt);
          break;
        case 'name_asc':
          sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
          break;
        case 'name_desc':
          sorted.sort((a, b) => b.name.localeCompare(a.name, 'zh-CN'));
          break;
      }
      return sorted;
    },

    checkImportConflicts: (jsonString: string): { success: boolean; hasConflict: boolean; conflictingNames?: string[]; snapshotsToImport?: Snapshot[]; error?: string } => {
      try {
        const data = JSON.parse(jsonString);

        if (!data || typeof data !== 'object') {
          return { success: false, hasConflict: false, error: '无效的JSON格式' };
        }

        let snapshotsToImport: Snapshot[] = [];

        if ('count' in data && Array.isArray(data.snapshots)) {
          if (data.schemaVersion !== BATCH_EXPORT_SCHEMA_VERSION) {
            return { success: false, hasConflict: false, error: `不兼容的批量快照版本：期望 v${BATCH_EXPORT_SCHEMA_VERSION}` };
          }
          for (const snap of data.snapshots) {
            const validation = validateSnapshot(snap);
            if (!validation.valid) {
              return { success: false, hasConflict: false, error: `批量快照中存在损坏数据：${validation.error}` };
            }
          }
          snapshotsToImport = data.snapshots;
        } else {
          if (data.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
            return { success: false, hasConflict: false, error: `不兼容的快照版本：期望 v${SNAPSHOT_SCHEMA_VERSION}，实际 v${data.schemaVersion}` };
          }
          if (!data.snapshot) {
            return { success: false, hasConflict: false, error: '快照数据缺失或损坏' };
          }
          const validation = validateSnapshot(data.snapshot);
          if (!validation.valid) {
            return { success: false, hasConflict: false, error: validation.error };
          }
          snapshotsToImport = [data.snapshot];
        }

        const state = get();
        const existingNames = new Set(state.snapshots.map(s => s.name));
        const conflictingNames = snapshotsToImport
          .map(s => s.name)
          .filter(name => existingNames.has(name));

        return {
          success: true,
          hasConflict: conflictingNames.length > 0,
          conflictingNames: conflictingNames.length > 0 ? conflictingNames : undefined,
          snapshotsToImport,
        };
      } catch (e) {
        return { success: false, hasConflict: false, error: `解析失败: ${(e as Error).message}` };
      }
    },

    importSnapshots: (jsonString: string, conflictStrategy: ImportConflictStrategy): ImportResult => {
      const checkResult = get().checkImportConflicts(jsonString);

      if (!checkResult.success) {
        return { success: false, error: checkResult.error };
      }

      if (checkResult.hasConflict && conflictStrategy === 'cancel') {
        return {
          success: false,
          hasConflict: true,
          conflictingNames: checkResult.conflictingNames,
          error: '用户取消了导入',
        };
      }

      const state = get();
      const existingSnapshots = [...state.snapshots];
      const existingNames = new Map(existingSnapshots.map(s => [s.name, s]));
      const importedSnapshots: Snapshot[] = [];
      let skippedCount = 0;

      for (const rawSnap of checkResult.snapshotsToImport || []) {
        let snap: Snapshot = {
          ...rawSnap,
          snapshotId: generateId(),
          createdAt: rawSnap.createdAt || Date.now(),
        };

        const existing = existingNames.get(snap.name);

        if (existing) {
          if (conflictStrategy === 'overwrite') {
            const idx = existingSnapshots.findIndex(s => s.snapshotId === existing.snapshotId);
            if (idx !== -1) {
              existingSnapshots[idx] = { ...snap, snapshotId: existing.snapshotId };
            }
            importedSnapshots.push(existingSnapshots[idx]);
            existingNames.set(snap.name, existingSnapshots[idx]);
          } else if (conflictStrategy === 'keep_both') {
            let counter = 1;
            let newName = `${snap.name} (导入${counter})`;
            while (existingNames.has(newName)) {
              counter++;
              newName = `${snap.name} (导入${counter})`;
            }
            snap = { ...snap, name: newName };
            existingSnapshots.push(snap);
            importedSnapshots.push(snap);
            existingNames.set(newName, snap);
          } else {
            skippedCount++;
          }
        } else {
          existingSnapshots.push(snap);
          importedSnapshots.push(snap);
          existingNames.set(snap.name, snap);
        }
      }

      set({
        snapshots: existingSnapshots,
        errorMessage: '',
      });
      saveSnapshotsToStorage();

      if (importedSnapshots.length > 0) {
        addSnapshotLog(
          'import',
          importedSnapshots.map(s => s.snapshotId),
          importedSnapshots.map(s => s.name),
          conflictStrategy === 'overwrite' ? '覆盖模式' : conflictStrategy === 'keep_both' ? '保留两份模式' : undefined,
        );
      }

      return {
        success: importedSnapshots.length > 0,
        snapshots: importedSnapshots,
        snapshot: importedSnapshots[0],
        importedCount: importedSnapshots.length,
        skippedCount,
        hasConflict: checkResult.hasConflict,
        conflictingNames: checkResult.conflictingNames,
      };
    },

    clearSnapshotLogs: () => {
      set({ snapshotLogs: [] });
      saveLogsToStorage();
    },
  };
});
