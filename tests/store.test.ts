// Store层回归测试（模拟浏览器环境的localStorage）
// 使用: npx tsx tests/store.test.ts

// 模拟localStorage
const storage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => (k in storage ? storage[k] : null),
  setItem: (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
  length: 0,
  key: () => null,
};

// 模拟URL/Blob/document（exportTimeline会用到，但我们只测返回值）
(global as any).URL = {
  createObjectURL: () => 'mock://blob-url',
  revokeObjectURL: () => {},
};
(global as any).Blob = function(_data: any, _opts: any) { this.data = _data; };
(global as any).document = {
  createElement: () => ({
    href: '',
    download: '',
    click: () => {},
  }),
  body: { appendChild: () => {}, removeChild: () => {} },
};

// 模拟 React（zustand 需要）
(global as any).React = {};

import { useReplayStore } from '../src/store/useReplayStore';
import { defaultRules } from '../src/data/sampleEvents';

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✅ PASS: ${name}`);
  } catch (e) {
    failed++;
    const msg = `❌ FAIL: ${name}\n   ${(e as Error).message}`;
    errors.push(msg);
    console.error(msg);
  }
}

function assertEq<T>(actual: T, expected: T, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n   期望: ${b}\n   实际: ${a}`);
}
function assert(cond: boolean, msg = '') { if (!cond) throw new Error(msg || '断言失败'); }

// ============================================================
// 测试1：导入重复 eventId 被拒绝，原状态不变
// ============================================================
test('Store-导入重复eventId被拒绝且原状态不变', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  // 推进一步就找活动告警，找到则停下（否则推到有为止）
  for (let i = 0; i < 10; i++) {
    s.stepForward();
    if (useReplayStore.getState().activeAlarms.find(a => a.status === 'active')) break;
  }
  const alarm = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
  assert(alarm, '应该有活动告警');
  s.confirmAlarm(alarm.alarmId, '我的备注');
  s.setOperatorNotes('重要备注');

  const before = {
    cursor: useReplayStore.getState().cursor,
    idx: useReplayStore.getState().currentEventIndex,
    confN: useReplayStore.getState().confirmations.length,
    alN: useReplayStore.getState().activeAlarms.length,
    notes: useReplayStore.getState().operatorNotes,
    evN: useReplayStore.getState().events.length,
  };

  // 尝试导入坏数据
  const bad = JSON.stringify([
    { eventId: 'dup-1', timestamp: 1000, type: 'alert', title: 'x', payload: {} },
    { eventId: 'dup-1', timestamp: 2000, type: 'alert', title: 'y', payload: {} },
    { eventId: 'dup-2', timestamp: 3000, type: 'info', title: 'z', payload: {} },
  ]);
  s.importEventsFromJson(bad);

  const after = useReplayStore.getState();
  assert(after.errorMessage.includes('发现重复的 eventId'), '应有错误提示');
  assertEq(after.cursor, before.cursor, '游标不变');
  assertEq(after.currentEventIndex, before.idx, '事件索引不变');
  assertEq(after.confirmations.length, before.confN, '确认历史不变');
  assertEq(after.activeAlarms.length, before.alN, '活动告警不变');
  assertEq(after.operatorNotes, before.notes, '操作员备注不变');
  assertEq(after.events.length, before.evN, '事件数不变');
});

// ============================================================
// 测试2：确认记录和撤销记录的时间戳是回放时间
// ============================================================
test('Store-确认时间和撤销时间是回放时间，不是系统时间', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 10; i++) {
    s.stepForward();
    if (useReplayStore.getState().activeAlarms.find(a => a.status === 'active')) break;
  }
  const st1 = useReplayStore.getState();
  const confirmTs = st1.cursor;
  const alarm = st1.activeAlarms.find(a => a.status === 'active');
  assert(alarm, '应有活动告警');

  // 回放时间与系统时间应该差很多（样例时间戳是2026年6月22日前后的构造时间）
  assert(Math.abs(Date.now() - confirmTs) > 60_000, '回放时间与系统时间差>60s，测试有意义');

  s.confirmAlarm(alarm.alarmId, '确认');
  const conf = useReplayStore.getState().confirmations.find(c => c.type === 'confirm');
  assert(conf, '存在确认记录');
  assertEq(conf.timestamp, confirmTs, '确认时间=回放游标时间');

  // 推进再撤销
  for (let i = 0; i < 2; i++) s.stepForward();
  const undoTs = useReplayStore.getState().cursor;
  s.undoConfirmation(conf.confirmationId);
  const undo = useReplayStore.getState().confirmations.find(c => c.type === 'undo');
  assert(undo, '存在撤销记录');
  assertEq(undo.timestamp, undoTs, '撤销时间=回放游标时间');
});

// ============================================================
// 测试3：导出内容字段完整 + 事件带状态 + 确认时间是回放时间
// ============================================================
test('Store-导出字段完整事件带状态确认时间正确', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();
  s.setOperatorNotes('导出备注');

  // 全量回放
  const total = useReplayStore.getState().events.length;
  for (let i = 0; i < total; i++) s.stepForward();

  // 做一次确认
  const al = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
  if (al) s.confirmAlarm(al.alarmId, '导出确认备注');

  const st = useReplayStore.getState();
  const expCur = st.cursor;
  const expConfN = st.confirmations.length;
  const expAlN = st.activeAlarms.length;
  const expNotes = st.operatorNotes;
  const expOp = st.operator;

  // 导出（去掉document影响，用函数的JSON返回值）
  const expStr = s.exportTimeline(true);
  const exp = JSON.parse(expStr);

  // 基础字段
  assert(typeof exp.exportTime === 'number', 'exportTime字段');
  assertEq(exp.replayCursor, expCur, 'replayCursor字段正确');
  assertEq(exp.cursorPosition, expCur, 'cursorPosition字段正确');
  assert(exp.ruleVersion === defaultRules[0].version, 'ruleVersion字段正确');
  assertEq(exp.operator, expOp, 'operator字段正确');
  assertEq(exp.operatorNotes, expNotes, 'operatorNotes字段正确');
  assertEq(exp.includeState, true, 'includeState字段正确');

  // 事件完整 + 有异常状态标记
  assertEq(exp.events.length, total, '事件数量正确');
  const dup = exp.events.find((e: any) => e.status === 'duplicate');
  assert(dup, '存在duplicate状态事件');
  assertEq(dup.eventId, 'evt-002', '重复事件ID正确');
  const mc = exp.events.find((e: any) => e.status === 'matched_early_clear');
  assert(mc, '存在matched_early_clear状态事件');
  assertEq(mc.eventId, 'evt-007', '匹配事件ID正确');

  // 确认记录时间全部是回放时间
  assertEq(exp.confirmations.length, expConfN, '确认记录数正确');
  for (const c of exp.confirmations) {
    assert(c.timestamp <= expCur, `确认时间${c.timestamp}必须<=回放游标${expCur}`);
    assert(Math.abs(Date.now() - c.timestamp) > 60_000, `确认时间${c.timestamp}非系统当前时间`);
  }

  // 活动告警数量、状态合法
  assertEq(exp.alarms.length, expAlN, '活动告警数正确');
  for (const a of exp.alarms) {
    assert(['active', 'cleared', 'confirmed'].includes(a.status), `告警${a.alarmId}状态合法`);
  }

  // 事件有完整必填字段
  for (const ev of exp.events) {
    assert(ev.eventId, '事件ID存在');
    assert(typeof ev.timestamp === 'number', `事件${ev.eventId}时间戳是数字`);
    assert(['alert', 'clear', 'info'].includes(ev.type), `事件${ev.eventId}类型合法`);
  }
});

// ============================================================
// 测试4：会话加载一致性
// ============================================================
test('Store-会话加载后游标/确认/备注/导出一致', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 5; i++) s.stepForward();
  const al = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
  if (al) s.confirmAlarm(al.alarmId, '恢复确认备注');
  s.setOperatorNotes('会备注测试');
  s.saveSession();

  const snap = {
    cur: useReplayStore.getState().cursor,
    idx: useReplayStore.getState().currentEventIndex,
    conf: JSON.stringify(useReplayStore.getState().confirmations.map(c => ({
      id: c.confirmationId, aid: c.alarmId, ts: c.timestamp, t: c.type, r: c.remark, a: c.active,
    }))),
    notes: useReplayStore.getState().operatorNotes,
    last: useReplayStore.getState().lastExport,
  };

  s.loadSession();

  const after = {
    cur: useReplayStore.getState().cursor,
    idx: useReplayStore.getState().currentEventIndex,
    conf: JSON.stringify(useReplayStore.getState().confirmations.map(c => ({
      id: c.confirmationId, aid: c.alarmId, ts: c.timestamp, t: c.type, r: c.remark, a: c.active,
    }))),
    notes: useReplayStore.getState().operatorNotes,
    last: useReplayStore.getState().lastExport,
  };

  assertEq(after.cur, snap.cur, '游标一致');
  assertEq(after.idx, snap.idx, '索引一致');
  assertEq(after.conf, snap.conf, '确认历史一致');
  assertEq(after.notes, snap.notes, '备注一致');
  assertEq(after.last, snap.last, '上次导出内容一致');
});

// ============================================================
// 测试5：完整回放后导出 — 每条事件都有status，逐条校验
// ============================================================
test('Store-完整回放导出逐条事件状态齐全', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  const total = useReplayStore.getState().events.length;
  for (let i = 0; i < total; i++) s.stepForward();

  const expStr = s.exportTimeline(true);
  const exp = JSON.parse(expStr);

  assertEq(exp.events.length, total, `事件数=${exp.events.length}`);

  const validStatuses = ['normal', 'duplicate', 'pending', 'matched_early_clear', 'orphan_clear'];
  for (let i = 0; i < exp.events.length; i++) {
    const ev = exp.events[i];
    assert(
      ev.status && validStatuses.includes(ev.status),
      `事件[${i}] ${ev.eventId} 的 status="${ev.status ?? '(无)'}" 不合法，期望是 ${validStatuses.join('/')}`,
    );
  }
});

// ============================================================
// 测试6：重复 eventId — 首条保留正常状态，仅后续标 duplicate
// ============================================================
test('Store-重复eventId首条保留正常状态后续标duplicate', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  const total = useReplayStore.getState().events.length;
  for (let i = 0; i < total; i++) s.stepForward();

  const expStr = s.exportTimeline(true);
  const exp = JSON.parse(expStr);

  const evt002Entries = exp.events.filter((e: any) => e.eventId === 'evt-002');
  assertEq(evt002Entries.length, 2, 'evt-002 应出现2次');

  assertEq(evt002Entries[0].status, 'normal', 'evt-002 首次出现应保留 normal 状态');
  assertEq(evt002Entries[1].status, 'duplicate', 'evt-002 第二次出现应为 duplicate');

  const evt006 = exp.events.find((e: any) => e.eventId === 'evt-006');
  assert(evt006, 'evt-006 存在');
  assertEq(evt006.status, 'pending', 'evt-006(早到clear)应为 pending');

  const evt007 = exp.events.find((e: any) => e.eventId === 'evt-007');
  assert(evt007, 'evt-007 存在');
  assertEq(evt007.status, 'matched_early_clear', 'evt-007(alert匹配早到clear)应为 matched_early_clear');

  const normalIds = ['evt-001', 'evt-003', 'evt-004', 'evt-008', 'evt-009', 'evt-010', 'evt-011', 'evt-012', 'evt-013', 'evt-014', 'evt-015'];
  for (const eid of normalIds) {
    const ev = exp.events.find((e: any) => e.eventId === eid);
    assert(ev, `${eid} 存在`);
    assertEq(ev.status, 'normal', `${eid} 应为 normal`);
  }
});

// ============================================================
// 汇总
// ============================================================
console.log('\n========================================');
console.log(`测试完成: ${passed} 通过, ${failed} 失败`);
if (errors.length > 0) {
  console.error('\n失败列表:');
  errors.forEach(e => console.error(e));
  process.exit(1);
} else {
  console.log('🎉 所有Store层集成测试通过！');
  process.exit(0);
}
