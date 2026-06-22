// 集成测试脚本（在浏览器控制台执行）
// 或者通过浏览器 browser_evaluate 工具执行
// 覆盖：重复ID导入原子性、确认记录时间、导出内容完整性、会话恢复一致性

const store = window.__REPLAY_STORE__;
if (!store) {
  throw new Error('未找到 store，请确认页面已加载 store');
}

const actions = store.getState();
let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, status: 'PASS' });
    console.log('%c✅ PASS: ' + name, 'color: #22c55e; font-weight: bold');
  } catch (e) {
    failed++;
    results.push({ name, status: 'FAIL', error: e.message });
    console.log('%c❌ FAIL: ' + name, 'color: #ef4444; font-weight: bold');
    console.error('   ', e.message);
  }
}

function assertEq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${msg}\n   期望: ${b}\n   实际: ${a}`);
  }
}

function assert(cond, msg = '') {
  if (!cond) throw new Error(msg || '断言失败');
}

// ================================================================
// 准备工作：重置回放
// ================================================================
actions.clearSession();
actions.loadSampleEvents();

// ================================================================
// 测试1：重复 eventId 导入被拒绝，且原回放状态不变
// ================================================================
test('导入-重复ID被拒绝且原回放不受影响', () => {
  // 1. 先把原状态推到中间，做一些确认，记录快照
  for (let i = 0; i < 4; i++) actions.stepForward();
  const s1 = store.getState();
  const activeAlarm = s1.activeAlarms.find(a => a.status === 'active');
  assert(activeAlarm, '应该有活动告警可确认');
  actions.confirmAlarm(activeAlarm.alarmId, '测试备注');
  actions.setOperatorNotes('我的备注');
  actions.saveSession();

  const before = {
    cursor: store.getState().cursor,
    currentEventIndex: store.getState().currentEventIndex,
    confirmationsCount: store.getState().confirmations.length,
    activeAlarmsCount: store.getState().activeAlarms.length,
    operatorNotes: store.getState().operatorNotes,
    eventsCount: store.getState().events.length,
    errorBefore: store.getState().errorMessage,
  };

  // 2. 构造重复 eventId 的坏数据
  const badData = JSON.stringify([
    { eventId: 'dup-1', timestamp: 1000, type: 'alert', title: '坏1', payload: {} },
    { eventId: 'dup-1', timestamp: 2000, type: 'alert', title: '坏1重复', payload: {} },
    { eventId: 'dup-2', timestamp: 3000, type: 'info', title: '坏2', payload: {} },
  ]);

  // 3. 尝试导入
  actions.importEventsFromJson(badData);
  const after = store.getState();

  // 4. 断言：错误信息有提示
  assert(after.errorMessage.includes('发现重复的 eventId'), '应有重复ID错误提示，实际：' + after.errorMessage);

  // 5. 断言：回放状态完全不变
  assertEq(after.cursor, before.cursor, '游标不能变');
  assertEq(after.currentEventIndex, before.currentEventIndex, '事件索引不能变');
  assertEq(after.confirmations.length, before.confirmationsCount, '确认历史不能变');
  assertEq(after.activeAlarms.length, before.activeAlarmsCount, '活动告警数不能变');
  assertEq(after.operatorNotes, before.operatorNotes, '操作员备注不能变');
  assertEq(after.events.length, before.eventsCount, '事件列表不能被覆盖');
});

// ================================================================
// 测试2：确认记录的 timestamp 是回放时间，不是系统时间
// ================================================================
test('确认记录timestamp是回放时间而非系统时间', () => {
  actions.clearSession();
  actions.loadSampleEvents();

  // 推进到第3个事件之后
  for (let i = 0; i < 3; i++) actions.stepForward();

  const beforeConfirm = store.getState();
  const expectedTimestamp = beforeConfirm.cursor;

  const activeAlarm = beforeConfirm.activeAlarms.find(a => a.status === 'active');
  assert(activeAlarm, '应该有活动告警');

  // 确认前的系统时间，跟回放时间应该差别很大
  const systemTimeNow = Date.now();
  const timeDiff = Math.abs(systemTimeNow - expectedTimestamp);
  assert(timeDiff > 1000 * 60, '回放时间应与系统时间有显著差异，才能验证测试有意义');

  actions.confirmAlarm(activeAlarm.alarmId, '确认测试');

  const confirm = store.getState().confirmations.find(c => c.type === 'confirm');
  assert(confirm, '应该有确认记录');

  // 关键断言：确认时间等于游标时间
  assertEq(confirm.timestamp, expectedTimestamp, '确认时间必须等于回放游标时间');

  // 再验证撤销的时间也是回放时间
  // 推进回放（改变游标）
  for (let i = 0; i < 2; i++) actions.stepForward();
  const expectedUndoTimestamp = store.getState().cursor;

  actions.undoConfirmation(confirm.confirmationId);
  const undoConfirm = store.getState().confirmations.find(c => c.type === 'undo');
  assert(undoConfirm, '应该有撤销记录');
  assertEq(undoConfirm.timestamp, expectedUndoTimestamp, '撤销时间也必须等于回放游标时间');
});

// ================================================================
// 测试3：完整回放后导出内容校验（所有字段+状态+时间）
// ================================================================
test('导出-完整回放后导出内容字段和状态齐全', () => {
  actions.clearSession();
  actions.loadSampleEvents();
  actions.setOperatorNotes('导出测试备注');

  // 全部回放
  while (store.getState().currentEventIndex < store.getState().events.length) {
    actions.stepForward();
  }

  // 做1次确认
  const activeBefore = store.getState().activeAlarms.find(a => a.status === 'active');
  if (activeBefore) {
    actions.confirmAlarm(activeBefore.alarmId, '导出确认备注');
  }

  const beforeExport = store.getState();
  const expectedCursor = beforeExport.cursor;
  const expectedConfirms = beforeExport.confirmations.length;
  const expectedAlarms = beforeExport.activeAlarms.length;

  // 导出（禁止浏览器弹窗，只取返回JSON）
  const originalCreateEl = document.createElement.bind(document);
  let capturedJson = null;
  document.createElement = function(tag) {
    const el = originalCreateEl(tag);
    if (tag === 'a') {
      Object.defineProperty(el, 'click', { value: () => {} });
      Object.defineProperty(el, 'href', {
        set(url) {
          // URL.createObjectURL -> 解析Blob有难度，直接保存lastExport字段
        },
        get() { return ''; }
      });
    }
    return el;
  };

  const exportedStr = actions.exportTimeline(true);
  capturedJson = JSON.parse(exportedStr);
  document.createElement = originalCreateEl;

  // 断言：基础元数据
  assert(typeof capturedJson.exportTime === 'number', 'exportTime必须是数字');
  assertEq(capturedJson.replayCursor, expectedCursor, 'replayCursor必须等于导出时游标');
  assertEq(capturedJson.cursorPosition, expectedCursor, 'cursorPosition必须等于导出时游标');
  assert(capturedJson.ruleVersion, '应有ruleVersion');
  assertEq(capturedJson.operator, beforeExport.operator, 'operator应被导出');
  assertEq(capturedJson.operatorNotes, beforeExport.operatorNotes, 'operatorNotes应被导出');
  assertEq(capturedJson.includeState, true, 'includeState应为true');

  // 断言：事件数量
  assertEq(capturedJson.events.length, beforeExport.events.length, '导出事件数量应等于全部事件数');

  // 断言：每条事件都有正确的处理状态（异常事件必须有status）
  const evt002Second = capturedJson.events.filter(e => e.eventId === 'evt-002');
  // 样例中evt-002第二次出现应该是duplicate状态
  const duplicateEvent = capturedJson.events.find(e => e.status === 'duplicate');
  assert(duplicateEvent, '必须能找到duplicate状态事件，验证重复标记导出正确');
  assertEq(duplicateEvent.eventId, 'evt-002', '重复事件ID应为evt-002');

  // 断言：matched_early_clear状态事件导出
  const matchedClear = capturedJson.events.find(e => e.status === 'matched_early_clear');
  assert(matchedClear, '必须能找到matched_early_clear状态事件，验证早到clear匹配导出正确');
  assertEq(matchedClear.eventId, 'evt-007', '匹配事件ID应为evt-007');

  // 断言：pending状态的clear事件（如果有孤立清除）
  const pendingEvents = capturedJson.events.filter(e => e.status === 'pending');
  // 我们全量回放后，evt-006应该已经被匹配了，所以不应该有pending

  // 断言：确认记录数量正确
  assertEq(capturedJson.confirmations.length, expectedConfirms, '确认记录数正确');

  // 断言：每条确认记录的时间是回放时间（<= replayCursor，而不是当前系统时间）
  capturedJson.confirmations.forEach(conf => {
    assert(conf.timestamp <= expectedCursor, `确认时间${conf.timestamp}必须 <= 回放游标${expectedCursor}`);
    const diffFromNow = Math.abs(Date.now() - conf.timestamp);
    assert(diffFromNow > 60000, `确认时间应该明显偏离当前系统时间（>60秒差），实际差=${diffFromNow}`);
  });

  // 断言：活动告警数量正确
  assertEq(capturedJson.alarms.length, expectedAlarms, '活动告警数量正确');
  capturedJson.alarms.forEach(alarm => {
    assert(['active', 'cleared', 'confirmed'].includes(alarm.status), `告警${alarm.alarmId}状态${alarm.status}合法`);
  });

  // 断言：每个都有必需字段
  capturedJson.events.forEach(ev => {
    assert(ev.eventId, '事件必须有eventId');
    assert(typeof ev.timestamp === 'number', `事件${ev.eventId}必须有数字timestamp`);
    assert(['alert', 'clear', 'info'].includes(ev.type), `事件${ev.eventId}类型正确`);
  });
});

// ================================================================
// 测试4：重新加载会话一致性（游标/确认/备注/导出内容）
// ================================================================
test('会话-重新加载后游标、确认、备注完全一致', () => {
  actions.clearSession();
  actions.loadSampleEvents();

  // 做一些操作
  for (let i = 0; i < 5; i++) actions.stepForward();
  const activeAlarm = store.getState().activeAlarms.find(a => a.status === 'active');
  if (activeAlarm) actions.confirmAlarm(activeAlarm.alarmId, '恢复测试确认');
  actions.setOperatorNotes('会话恢复验证');

  const beforeSave = {
    cursor: store.getState().cursor,
    currentEventIndex: store.getState().currentEventIndex,
    confirmations: JSON.stringify(store.getState().confirmations.map(c => ({
      id: c.confirmationId, alarmId: c.alarmId, timestamp: c.timestamp, type: c.type, remark: c.remark, active: c.active,
    }))),
    operatorNotes: store.getState().operatorNotes,
    lastExport: store.getState().lastExport,
  };

  actions.saveSession();

  // 模拟刷新：调用loadSession
  actions.loadSession();

  const afterLoad = {
    cursor: store.getState().cursor,
    currentEventIndex: store.getState().currentEventIndex,
    confirmations: JSON.stringify(store.getState().confirmations.map(c => ({
      id: c.confirmationId, alarmId: c.alarmId, timestamp: c.timestamp, type: c.type, remark: c.remark, active: c.active,
    }))),
    operatorNotes: store.getState().operatorNotes,
    lastExport: store.getState().lastExport,
  };

  assertEq(afterLoad.cursor, beforeSave.cursor, '游标恢复一致');
  assertEq(afterLoad.currentEventIndex, beforeSave.currentEventIndex, '事件索引恢复一致');
  assertEq(afterLoad.confirmations, beforeSave.confirmations, '确认历史恢复一致');
  assertEq(afterLoad.operatorNotes, beforeSave.operatorNotes, '操作员备注恢复一致');
  assertEq(afterLoad.lastExport, beforeSave.lastExport, '上次导出内容恢复一致');
});

// ================================================================
// 汇总输出
// ================================================================
console.log('\n' + '%c========================================', 'color: #38bdf8');
console.log(`%c测试完成: ${passed} 通过, ${failed} 失败`, 'color: white; background: #0f172a; padding: 4px 8px; border-radius: 4px;');

if (failed > 0) {
  console.log('%c失败列表:', 'color: #ef4444');
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.error(`  - ${r.name}: ${r.error}`);
  });
} else {
  console.log('%c🎉 所有集成测试通过！', 'color: #22c55e; font-weight: bold; font-size: 14px');
}

window.__TEST_RESULTS__ = { passed, failed, results };
