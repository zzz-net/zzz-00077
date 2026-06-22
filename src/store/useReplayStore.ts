import { create } from 'zustand';
import { Event, Alarm, Confirmation, Rule, Session, ReplayState, ExportedTimeline, Snapshot, ExportedSnapshot, SnapshotConflictResult, ImportResult } from '../engine/types';
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
  importSnapshot: (jsonString: string) => ImportResult;
}

const STORAGE_KEYS = {
  SESSION: 'replay:session',
  EVENTS: 'replay:events',
  RULES: 'replay:rules',
  LAST_EXPORT: 'replay:lastExport',
  SNAPSHOTS: 'replay:snapshots',
};

const SNAPSHOT_SCHEMA_VERSION = 1;

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
              e => e.correlationId !== result.markedEvent.correlationId
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
            e => e.correlationId !== result.markedEvent.correlationId
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
      set({
        ...initial,
        events: get().events,
        rules: get().rules,
        operator: get().operator,
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
        c.confirmationId === confirmationId ? { ...c, active: false } : c
      );

      const updatedAlarms = state.activeAlarms.map(a =>
        a.confirmationId === confirmationId ? { ...a, status: 'active' as const, confirmationId: undefined } : a
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

        if (!sessionStr || !eventsStr) return;

        const session: Session = JSON.parse(sessionStr);
        const events: Event[] = JSON.parse(eventsStr);
        const rules: Rule[] = rulesStr ? JSON.parse(rulesStr) : defaultRules;
        const snapshots: Snapshot[] = snapshotsStr ? JSON.parse(snapshotsStr) : [];

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
            c => c.alarmId === alarm.alarmId && c.type === 'confirm' && c.active
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
          r.ruleId === ruleId ? { ...r, enabled: !r.enabled } : r
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
      if (conflict.hasConflict && forceOverwrite) {
        newSnapshots = state.snapshots.map(s =>
          s.name === name ? { ...snapshot, snapshotId: s.snapshotId, createdAt: s.createdAt } : s
        );
      } else {
        newSnapshots = [...state.snapshots, snapshot];
      }

      set({ snapshots: newSnapshots });
      saveSnapshotsToStorage();

      return { success: true, snapshot };
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
      return true;
    },

    deleteSnapshot: (snapshotId: string): boolean => {
      const state = get();
      const exists = state.snapshots.some(s => s.snapshotId === snapshotId);

      if (!exists) {
        set({ errorMessage: '快照不存在' });
        return false;
      }

      set({
        snapshots: state.snapshots.filter(s => s.snapshotId !== snapshotId),
      });
      saveSnapshotsToStorage();
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

      return json;
    },

    importSnapshot: (jsonString: string): ImportResult => {
      try {
        const data = JSON.parse(jsonString);

        if (!data || typeof data !== 'object') {
          return { success: false, error: '无效的JSON格式' };
        }

        if (data.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
          return {
            success: false,
            error: `不兼容的快照版本：期望 v${SNAPSHOT_SCHEMA_VERSION}，实际 v${data.schemaVersion}`,
          };
        }

        if (!data.snapshot || typeof data.snapshot !== 'object') {
          return { success: false, error: '快照数据缺失或损坏' };
        }

        const snap = data.snapshot;
        const requiredFields = [
          'snapshotId', 'name', 'createdAt', 'cursor', 'currentEventIndex',
          'events', 'activeAlarms', 'processedEvents', 'pendingEvents',
          'confirmations', 'rules', 'operator', 'startTime', 'endTime',
        ];

        for (const field of requiredFields) {
          if (!(field in snap)) {
            return { success: false, error: `快照字段缺失: ${field}` };
          }
        }

        if (!Array.isArray(snap.events) || snap.events.length === 0) {
          return { success: false, error: '快照事件数据无效' };
        }

        const importedSnapshot: Snapshot = {
          ...snap,
          snapshotId: generateId(),
          createdAt: Date.now(),
        };

        const state = get();
        const conflict = state.snapshots.find(s => s.name === importedSnapshot.name);
        if (conflict) {
          importedSnapshot.name = `${importedSnapshot.name} (导入于 ${new Date().toLocaleString()})`;
        }

        set({
          snapshots: [...state.snapshots, importedSnapshot],
          errorMessage: '',
        });
        saveSnapshotsToStorage();

        return { success: true, snapshot: importedSnapshot };
      } catch (e) {
        return { success: false, error: `解析失败: ${(e as Error).message}` };
      }
    },
  };
});
