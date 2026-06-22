import { create } from 'zustand';
import { Event, Alarm, Confirmation, Rule, Session, ReplayState, ExportedTimeline } from '../engine/types';
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
}

const STORAGE_KEYS = {
  SESSION: 'replay:session',
  EVENTS: 'replay:events',
  RULES: 'replay:rules',
  LAST_EXPORT: 'replay:lastExport',
};

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
      let newCursor = Math.min(nextCursor, state.endTime);
      
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
        timestamp: Date.now(),
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
        timestamp: Date.now(),
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
      const exportData: ExportedTimeline = {
        exportTime: Date.now(),
        events: state.events,
        alarms: state.activeAlarms,
        confirmations: state.confirmations,
        includeState,
      };
      
      if (includeState) {
        exportData.cursorPosition = state.cursor;
        exportData.ruleVersion = state.rules.length > 0 ? state.rules[0].version : 'v1.0';
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

        if (!sessionStr || !eventsStr) return;

        const session: Session = JSON.parse(sessionStr);
        const events: Event[] = JSON.parse(eventsStr);
        const rules: Rule[] = rulesStr ? JSON.parse(rulesStr) : defaultRules;

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
  };
});
