export type EventType = 'alert' | 'clear' | 'info';
export type EventStatus = 'normal' | 'duplicate' | 'orphan_clear' | 'pending' | 'matched_early_clear';
export type AlarmLevel = 'critical' | 'warning' | 'info';
export type AlarmStatus = 'active' | 'cleared' | 'confirmed';
export type ConfirmationType = 'confirm' | 'undo';

export interface Event {
  eventId: string;
  timestamp: number;
  type: EventType;
  source: string;
  title: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  status?: EventStatus;
}

export interface Rule {
  ruleId: string;
  name: string;
  version: string;
  condition: string;
  level: AlarmLevel;
  enabled: boolean;
  createdAt: number;
}

export interface Alarm {
  alarmId: string;
  eventId: string;
  ruleId: string;
  title: string;
  level: AlarmLevel;
  startTime: number;
  endTime?: number;
  status: AlarmStatus;
  confirmationId?: string;
}

export interface Confirmation {
  confirmationId: string;
  alarmId: string;
  operator: string;
  remark: string;
  timestamp: number;
  type: ConfirmationType;
  active: boolean;
}

export interface Session {
  cursorPosition: number;
  ruleVersion: string;
  confirmations: Confirmation[];
  operatorNotes: string;
  exportContent: string;
  savedAt: number;
}

export interface ProcessResult {
  status: EventStatus;
  alarm?: Alarm;
  message?: string;
}

export interface ReplayState {
  isPlaying: boolean;
  speed: number;
  cursor: number;
  startTime: number;
  endTime: number;
  progress: number;
  activeAlarms: Alarm[];
  pendingEvents: Event[];
  processedEvents: Event[];
  currentEventIndex: number;
  events: Event[];
  rules: Rule[];
  confirmations: Confirmation[];
  operator: string;
  operatorNotes: string;
  lastExport: string;
  errorMessage: string;
  snapshots: Snapshot[];
  preRestoreSnapshot: Snapshot | null;
}

export interface ExportedTimeline {
  exportTime: number;
  replayCursor: number;
  events: Event[];
  alarms: Alarm[];
  confirmations: Confirmation[];
  includeState: boolean;
  cursorPosition?: number;
  ruleVersion?: string;
  operator?: string;
  operatorNotes?: string;
}

export interface Snapshot {
  snapshotId: string;
  name: string;
  description?: string;
  createdAt: number;
  cursor: number;
  currentEventIndex: number;
  events: Event[];
  activeAlarms: Alarm[];
  processedEvents: Event[];
  pendingEvents: Event[];
  confirmations: Confirmation[];
  rules: Rule[];
  operator: string;
  operatorNotes: string;
  startTime: number;
  endTime: number;
}

export interface ExportedSnapshot {
  schemaVersion: number;
  exportTime: number;
  snapshot: Snapshot;
}

export interface SnapshotConflictResult {
  hasConflict: boolean;
  existingSnapshot?: Snapshot;
}

export interface ImportResult {
  success: boolean;
  snapshot?: Snapshot;
  error?: string;
}
