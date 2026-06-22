import { Event, Alarm, EventStatus } from './types';

export class OutOfOrderHandler {
  private processedEventIds: Set<string> = new Set();
  private pendingClearQueue: Map<string, Event> = new Map();
  private pendingAlerts: Map<string, Event> = new Map();

  constructor(existingEvents: Event[] = []) {
    existingEvents.forEach((e) => {
      if (e.status !== 'duplicate') {
        this.processedEventIds.add(e.eventId);
      }
    });
  }

  checkDuplicate(event: Event): { isDuplicate: boolean; markedEvent: Event } {
    if (this.processedEventIds.has(event.eventId)) {
      return {
        isDuplicate: true,
        markedEvent: { ...event, status: 'duplicate' },
      };
    }
    return { isDuplicate: false, markedEvent: event };
  }

  checkEarlyClear(event: Event): { status: EventStatus; pendingEvent?: Event; matchedAlert?: Event } {
    if (event.type === 'clear' && event.correlationId) {
      const matchingAlert = this.pendingAlerts.get(event.correlationId);
      if (matchingAlert) {
        this.pendingAlerts.delete(event.correlationId);
        return {
          status: 'matched_early_clear',
          matchedAlert: matchingAlert,
        };
      }
      this.pendingClearQueue.set(event.correlationId, event);
      return { status: 'pending', pendingEvent: { ...event, status: 'pending' } };
    }
    return { status: 'normal' };
  }

  checkMatchingClear(event: Event): { hasMatchingClear: boolean; clearEvent?: Event; updatedEvent: Event } {
    if (event.type === 'alert' && event.correlationId) {
      const pendingClear = this.pendingClearQueue.get(event.correlationId);
      if (pendingClear && pendingClear.timestamp <= event.timestamp) {
        this.pendingClearQueue.delete(event.correlationId);
        return {
          hasMatchingClear: true,
          clearEvent: pendingClear,
          updatedEvent: { ...event, status: 'matched_early_clear' },
        };
      }
      this.pendingAlerts.set(event.correlationId, event);
    }
    return { hasMatchingClear: false, updatedEvent: event };
  }

  markAsProcessed(event: Event): void {
    if (event.status !== 'duplicate') {
      this.processedEventIds.add(event.eventId);
    }
  }

  getPendingClearEvents(): Event[] {
    return Array.from(this.pendingClearQueue.values());
  }

  getOrphanClears(): Event[] {
    return this.getPendingClearEvents().map((e) => ({ ...e, status: 'orphan_clear' as EventStatus }));
  }

  reset(): void {
    this.processedEventIds.clear();
    this.pendingClearQueue.clear();
    this.pendingAlerts.clear();
  }

  getStats(): {
    duplicates: number;
    pendingClears: number;
    pendingAlerts: number;
    processed: number;
  } {
    return {
      duplicates: 0,
      pendingClears: this.pendingClearQueue.size,
      pendingAlerts: this.pendingAlerts.size,
      processed: this.processedEventIds.size,
    };
  }
}

export function validateUndoConfirmation(
  confirmationId: string,
  confirmations: { confirmationId: string; active: boolean }[]
): { valid: boolean; error?: string } {
  const confirmation = confirmations.find((c) => c.confirmationId === confirmationId);
  
  if (!confirmation) {
    return {
      valid: false,
      error: '无法撤销：确认记录不存在',
    };
  }
  
  if (!confirmation.active) {
    return {
      valid: false,
      error: '无法撤销：该确认已被撤销',
    };
  }
  
  return { valid: true };
}
