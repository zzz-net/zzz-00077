import { Event, Rule, Alarm, ProcessResult } from './types';
import { OutOfOrderHandler } from './outOfOrderHandler';
import { matchRules, processClearEvent } from './ruleEngine';

export class EventProcessor {
  private outOfOrderHandler: OutOfOrderHandler;
  private rules: Rule[];

  constructor(rules: Rule[] = [], processedEvents: Event[] = []) {
    this.rules = rules;
    this.outOfOrderHandler = new OutOfOrderHandler(processedEvents);
  }

  processEvent(
    event: Event,
    activeAlarms: Alarm[],
    allEvents: Event[]
  ): ProcessResult & { updatedAlarms: Alarm[]; markedEvent: Event } {
    const { isDuplicate, markedEvent } = this.outOfOrderHandler.checkDuplicate(event);
    
    if (isDuplicate) {
      return {
        status: 'duplicate',
        updatedAlarms: activeAlarms,
        markedEvent,
        message: '重复事件已忽略',
      };
    }

    if (event.type === 'clear') {
      const clearResult = this.outOfOrderHandler.checkEarlyClear(markedEvent);
      
      if (clearResult.status === 'pending' && clearResult.pendingEvent) {
        this.outOfOrderHandler.markAsProcessed(clearResult.pendingEvent);
        return {
          status: 'pending',
          updatedAlarms: activeAlarms,
          markedEvent: clearResult.pendingEvent,
          message: '清除事件已缓存，等待对应告警',
        };
      }
      
      if (clearResult.status === 'matched_early_clear') {
        const { updatedAlarms } = processClearEvent(event, activeAlarms, allEvents);
        this.outOfOrderHandler.markAsProcessed(markedEvent);
        return {
          status: 'normal',
          updatedAlarms,
          markedEvent: { ...markedEvent, status: 'normal' },
          message: '清除事件匹配到缓存的告警',
        };
      }
      
      const { updatedAlarms, clearedAlarm } = processClearEvent(event, activeAlarms, allEvents);
      this.outOfOrderHandler.markAsProcessed(markedEvent);
      return {
        status: 'normal',
        updatedAlarms,
        markedEvent: { ...markedEvent, status: 'normal' },
        alarm: clearedAlarm,
        message: clearedAlarm ? '告警已清除' : undefined,
      };
    }

    if (event.type === 'alert') {
      const matchResult = this.outOfOrderHandler.checkMatchingClear(markedEvent);
      
      if (matchResult.hasMatchingClear && matchResult.clearEvent) {
        const alarm = matchRules(matchResult.updatedEvent, this.rules);
        if (alarm) {
          alarm.endTime = matchResult.clearEvent.timestamp;
          alarm.status = 'cleared';
        }
        this.outOfOrderHandler.markAsProcessed(matchResult.updatedEvent);
        return {
          status: 'matched_early_clear',
          updatedAlarms: alarm ? [...activeAlarms, alarm] : activeAlarms,
          markedEvent: matchResult.updatedEvent,
          alarm,
          message: '告警已被提前到达的清除事件标记为已清除',
        };
      }
      
      const alarm = matchRules(matchResult.updatedEvent, this.rules);
      this.outOfOrderHandler.markAsProcessed(matchResult.updatedEvent);
      return {
        status: 'normal',
        updatedAlarms: alarm ? [...activeAlarms, alarm] : activeAlarms,
        markedEvent: { ...matchResult.updatedEvent, status: 'normal' },
        alarm,
        message: alarm ? '新告警生成' : undefined,
      };
    }

    if (event.type === 'info') {
      this.outOfOrderHandler.markAsProcessed(markedEvent);
      return {
        status: 'normal',
        updatedAlarms: activeAlarms,
        markedEvent: { ...markedEvent, status: 'normal' },
      };
    }

    this.outOfOrderHandler.markAsProcessed(markedEvent);
    return {
      status: 'normal',
      updatedAlarms: activeAlarms,
      markedEvent: { ...markedEvent, status: 'normal' },
    };
  }

  getPendingEvents(): Event[] {
    return this.outOfOrderHandler.getPendingClearEvents();
  }

  finalize(): Event[] {
    return this.outOfOrderHandler.getOrphanClears();
  }

  reset(): void {
    this.outOfOrderHandler.reset();
  }

  updateRules(rules: Rule[]): void {
    this.rules = rules;
  }

  getStats() {
    return this.outOfOrderHandler.getStats();
  }
}

export function importEvents(jsonString: string): Event[] {
  try {
    const parsed = JSON.parse(jsonString);
    if (!Array.isArray(parsed)) {
      throw new Error('事件数据必须是数组格式');
    }
    
    const seenEventIds: Set<string> = new Set();
    const duplicateIds: string[] = [];
    
    const events: Event[] = parsed.map((item: unknown, index: number) => {
      const event = item as Partial<Event>;
      if (!event.eventId) {
        throw new Error(`第 ${index + 1} 条事件缺少 eventId`);
      }
      if (typeof event.timestamp !== 'number') {
        throw new Error(`事件 ${event.eventId} 的 timestamp 必须是数字`);
      }
      if (!['alert', 'clear', 'info'].includes(event.type || '')) {
        throw new Error(`事件 ${event.eventId} 的 type 必须是 alert/clear/info`);
      }
      
      if (seenEventIds.has(event.eventId)) {
        duplicateIds.push(event.eventId);
      }
      seenEventIds.add(event.eventId);
      
      return {
        eventId: event.eventId,
        timestamp: event.timestamp,
        type: event.type as Event['type'],
        source: event.source || 'unknown',
        title: event.title || 'Untitled Event',
        payload: event.payload || {},
        correlationId: event.correlationId,
      };
    });
    
    if (duplicateIds.length > 0) {
      const uniqueDuplicates = Array.from(new Set(duplicateIds));
      const preview = uniqueDuplicates.slice(0, 5).join('、');
      const more = uniqueDuplicates.length > 5 ? `等${uniqueDuplicates.length}个` : '';
      throw new Error(`发现重复的 eventId：${preview}${more}。导入已被拒绝，当前回放未受影响`);
    }
    
    return events.sort((a, b) => a.timestamp - b.timestamp);
  } catch (e) {
    if ((e as Error).message.startsWith('发现重复的')) {
      throw e;
    }
    throw new Error(`事件导入失败: ${(e as Error).message}`);
  }
}
