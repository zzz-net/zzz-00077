import { Event, Rule, Alarm, ProcessResult } from './types';
import { generateId } from '../utils/time';

export function evaluateCondition(event: Event, condition: string): boolean {
  try {
    const fn = new Function('event', `with(event) { return ${condition}; }`);
    return !!fn(event);
  } catch {
    return false;
  }
}

export function matchRules(event: Event, rules: Rule[]): Alarm | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (evaluateCondition(event, rule.condition)) {
      return {
        alarmId: generateId(),
        eventId: event.eventId,
        ruleId: rule.ruleId,
        title: event.title,
        level: rule.level,
        startTime: event.timestamp,
        status: 'active',
      };
    }
  }
  return null;
}

export function processClearEvent(
  clearEvent: Event,
  activeAlarms: Alarm[],
  events: Event[]
): { updatedAlarms: Alarm[]; clearedAlarm?: Alarm } {
  const correlationId = clearEvent.correlationId;
  if (!correlationId) {
    return { updatedAlarms: activeAlarms };
  }

  const alertEvent = events.find(
    (e) => e.type === 'alert' && e.correlationId === correlationId
  );
  
  if (!alertEvent) {
    return { updatedAlarms: activeAlarms };
  }

  const alarmIndex = activeAlarms.findIndex(
    (a) => a.eventId === alertEvent.eventId && a.status === 'active'
  );

  if (alarmIndex === -1) {
    return { updatedAlarms: activeAlarms };
  }

  const clearedAlarm = {
    ...activeAlarms[alarmIndex],
    endTime: clearEvent.timestamp,
    status: 'cleared' as const,
  };

  const updatedAlarms = [
    ...activeAlarms.slice(0, alarmIndex),
    clearedAlarm,
    ...activeAlarms.slice(alarmIndex + 1),
  ];

  return { updatedAlarms, clearedAlarm };
}

export function validateRuleCondition(condition: string): { valid: boolean; error?: string } {
  try {
    const testEvent: Event = {
      eventId: 'test',
      timestamp: Date.now(),
      type: 'alert',
      source: 'test',
      title: 'Test',
      payload: {},
    };
    evaluateCondition(testEvent, condition);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}
