// 快照功能端到端主流程验证
// 使用: npx tsx tests/snapshot_e2e.ts
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

const storage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => (k in storage ? storage[k] : null),
  setItem: (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
  length: 0,
  key: () => null,
};

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

(global as any).React = {};

import { useReplayStore } from '../src/store/useReplayStore';

function log(msg: string) {
  console.log(`\n📌 ${msg}`);
}

function getState() {
  return useReplayStore.getState();
}

function printState(label: string) {
  const s = getState();
  console.log(`   [${label}] cursor=${s.cursor}, idx=${s.currentEventIndex}, alarms=${s.activeAlarms.length}(active:${s.activeAlarms.filter(a=>a.status==='active').length}), confs=${s.confirmations.length}, notes="${s.operatorNotes}"`);
}

function printSnapshots() {
  const s = getState();
  console.log(`   🗂️  快照列表 (${s.snapshots.length}个):`);
  s.snapshots.forEach((snap, i) => {
    console.log(`      ${i + 1}. "${snap.name}"${snap.description ? ` - ${snap.description}` : ''} | cursor=${snap.cursor} | alarms=${snap.activeAlarms.length} | confs=${snap.confirmations.length}`);
  });
}

function assertEq<T>(actual: T, expected: T, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`❌ ${msg}\n   期望: ${b}\n   实际: ${a}`);
  }
  console.log(`   ✅ ${msg}`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          回放场景快照功能 端到端主流程验证                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  let s = getState();

  log('步骤1: 初始化会话，加载样例事件');
  s.clearSession();
  s.loadSampleEvents();
  s = getState();
  printState('初始');
  console.log(`   事件总数: ${s.events.length}`);

  log('步骤2: 推进到第3个事件，保存快照【节点A-初始状态】');
  for (let i = 0; i < 3; i++) s.stepForward();
  s = getState();
  printState('节点A');
  const resultA = s.saveSnapshot('节点A-初始状态', '演练开始时的基准状态');
  assertEq(resultA.success, true, '保存成功');
  assertEq(resultA.snapshot?.name, '节点A-初始状态', '快照名称正确');
  printSnapshots();

  log('步骤3: 继续推进到第6个事件，发现活动告警并确认');
  for (let i = 0; i < 3; i++) s.stepForward();
  s = getState();
  const alarm1 = s.activeAlarms.find(a => a.status === 'active');
  if (alarm1) {
    s.confirmAlarm(alarm1.alarmId, '已核实，是测试告警');
    console.log(`   ✅ 已确认告警: ${alarm1.title}`);
  }
  s.setOperatorNotes('已处理第一个告警，情况正常');
  s = getState();
  printState('节点B');
  assertEq(s.confirmations.length, 1, '确认记录数=1');

  log('步骤4: 尝试用同名保存，验证冲突检测');
  const conflictResult = s.saveSnapshot('节点A-初始状态');
  assertEq(conflictResult.success, false, '同名保存返回失败');
  assertEq(conflictResult.conflict, true, '检测到冲突');
  assertEq(conflictResult.existingSnapshot?.name, '节点A-初始状态', '返回已有快照信息');
  s = getState();
  assertEq(s.snapshots.length, 1, '冲突后快照数量不变');

  log('步骤5: 用新名称保存快照【节点B-已确认首告警】');
  const resultB = s.saveSnapshot('节点B-已确认首告警', '第一个告警已确认处理');
  assertEq(resultB.success, true, '保存成功');
  s = getState();
  assertEq(s.snapshots.length, 2, '快照数量=2');
  printSnapshots();

  log('步骤6: 继续推进到第10个事件，多确认几个告警');
  for (let i = 0; i < 4; i++) {
    s.stepForward();
    s = getState();
    const activeAlarm = s.activeAlarms.find(a => a.status === 'active');
    if (activeAlarm) {
      s.confirmAlarm(activeAlarm.alarmId, `确认处理: ${activeAlarm.title}`);
    }
  }
  s.setOperatorNotes('已处理完主要告警，准备交接');
  s = getState();
  printState('节点C');
  assertEq(s.confirmations.length >= 2, true, '至少2条确认记录');

  log('步骤7: 保存快照【节点C-大部分告警已处理】');
  const resultC = s.saveSnapshot('节点C-大部分告警已处理', '适合演示给下一班同事');
  assertEq(resultC.success, true, '保存成功');
  s = getState();
  assertEq(s.snapshots.length, 3, '快照数量=3');
  printSnapshots();

  log('步骤8: 模拟导出【节点B】快照给同事');
  const exportJson = s.exportSnapshot(resultB.snapshot!.snapshotId);
  const exportData = JSON.parse(exportJson);
  console.log(`   📤 导出信息:`);
  console.log(`      - Schema版本: v${exportData.schemaVersion}`);
  console.log(`      - 导出时间: ${new Date(exportData.exportTime).toLocaleString()}`);
  console.log(`      - 快照名称: ${exportData.snapshot.name}`);
  console.log(`      - 快照大小: ${(exportJson.length / 1024).toFixed(2)} KB`);
  assertEq(exportData.schemaVersion, 1, 'Schema版本正确');
  assertEq(exportData.snapshot.cursor, resultB.snapshot!.cursor, '导出游标一致');
  assertEq(exportData.snapshot.confirmations.length, resultB.snapshot!.confirmations.length, '导出确认记录数一致');

  log('步骤9: 模拟同事收到文件，导入快照');
  const beforeImport = getState().snapshots.length;
  const importResult = s.importSnapshot(exportJson);
  assertEq(importResult.success, true, '导入成功');
  s = getState();
  assertEq(s.snapshots.length, beforeImport + 1, '导入后快照数+1');
  assertEq(importResult.snapshot?.name.includes('节点B'), true, '名称保留原名');
  assertEq(importResult.snapshot?.name.includes('导入'), true, '名称标记导入');
  console.log(`   📥 导入后名称: ${importResult.snapshot?.name}`);
  printSnapshots();

  log('步骤10: 模拟刷新页面（持久化测试）');
  console.log('   💾 保存会话到 localStorage...');
  s.saveSession();

  const backup: Record<string, string | null> = {};
  ['replay:session', 'replay:events', 'replay:rules', 'replay:lastExport', 'replay:snapshots'].forEach(k => {
    backup[k] = localStorage.getItem(k);
  });

  console.log('   🔄 清空内存状态（模拟页面刷新）...');
  s.clearSession();
  s = getState();
  printState('清空后');
  assertEq(s.snapshots.length, 0, '清空后快照数=0');

  console.log('   📂 从 localStorage 恢复...');
  Object.entries(backup).forEach(([k, v]) => {
    if (v !== null) localStorage.setItem(k, v);
  });
  s.loadSession();
  s = getState();
  printState('恢复后');
  assertEq(s.snapshots.length, 4, '恢复后快照数=4');
  printSnapshots();

  log('步骤11: 一键恢复到【节点A】状态');
  const snapA = s.snapshots.find(x => x.name === '节点A-初始状态');
  assertEq(!!snapA, true, '节点A快照存在');

  const stateBeforeRestore = {
    cursor: s.cursor,
    confs: s.confirmations.length,
    notes: s.operatorNotes,
  };
  console.log(`   恢复前: cursor=${stateBeforeRestore.cursor}, confs=${stateBeforeRestore.confs}, notes="${stateBeforeRestore.notes}"`);

  const restoreOk = s.restoreSnapshot(snapA.snapshotId);
  assertEq(restoreOk, true, '恢复成功');
  s = getState();
  printState('恢复到节点A');
  assertEq(s.cursor, snapA.cursor, '游标一致');
  assertEq(s.confirmations.length, snapA.confirmations.length, '确认记录数一致');
  assertEq(!!s.preRestoreSnapshot, true, '保存了恢复前状态');
  assertEq(s.preRestoreSnapshot?.cursor, stateBeforeRestore.cursor, '恢复前游标正确');

  log('步骤12: 撤销恢复，回到恢复前的状态');
  const undoOk = s.undoRestoreSnapshot();
  assertEq(undoOk, true, '撤销恢复成功');
  s = getState();
  printState('撤销后');
  assertEq(s.cursor, stateBeforeRestore.cursor, '游标已还原');
  assertEq(s.confirmations.length, stateBeforeRestore.confs, '确认数已还原');
  assertEq(s.operatorNotes, stateBeforeRestore.notes, '备注已还原');
  assertEq(s.preRestoreSnapshot, null, 'preRestore已清空');

  log('步骤13: 测试异常导入保护（损坏数据）');
  const badCases = [
    { name: '无效JSON', data: 'this is not json' },
    { name: '版本不兼容', data: JSON.stringify({ schemaVersion: 999, snapshot: {} }) },
    { name: '缺少字段', data: JSON.stringify({ schemaVersion: 1, snapshot: { name: 'bad' } }) },
    { name: '空事件数组', data: JSON.stringify({ schemaVersion: 1, snapshot: { snapshotId:'x',name:'x',createdAt:1,cursor:1,currentEventIndex:0,events:[],activeAlarms:[],processedEvents:[],pendingEvents:[],confirmations:[],rules:[],operator:'x',startTime:0,endTime:100 } }) },
  ];
  const beforeBad = getState().snapshots.length;
  const beforeState = {
    cursor: getState().cursor,
    eventsLen: getState().events.length,
    confsLen: getState().confirmations.length,
  };
  for (const bc of badCases) {
    const r = s.importSnapshot(bc.data);
    assertEq(r.success, false, `${bc.name} 失败`);
    assertEq(!!r.error, true, `${bc.name} 有错误信息`);
    console.log(`   ❌ ${bc.name}: error="${r.error?.slice(0, 50)}..."`);
  }
  s = getState();
  assertEq(s.snapshots.length, beforeBad, '异常导入后快照数不变');
  assertEq(s.cursor, beforeState.cursor, '游标不变');
  assertEq(s.events.length, beforeState.eventsLen, '事件数不变');
  assertEq(s.confirmations.length, beforeState.confsLen, '确认数不变');

  log('步骤14: 强制覆盖同名快照');
  const snapshotA = s.snapshots.find(x => x.name === '节点A-初始状态');
  assertEq(!!snapshotA, true, '节点A存在');
  const oldCursor = snapshotA!.cursor;
  console.log(`   覆盖前游标: ${oldCursor}`);
  s.stepForward();
  s.stepForward();
  s = getState();
  const overwriteResult = s.saveSnapshot('节点A-初始状态', '更新后的描述', true);
  assertEq(overwriteResult.success, true, '强制覆盖成功');
  s = getState();
  const updatedA = s.snapshots.find(x => x.snapshotId === snapshotA!.snapshotId);
  console.log(`   覆盖后游标: ${updatedA?.cursor}`);
  assertEq(updatedA?.snapshotId, snapshotA!.snapshotId, 'ID保持不变');
  assertEq(updatedA!.cursor > oldCursor, true, '游标已更新');
  assertEq(updatedA?.description, '更新后的描述', '描述已更新');

  log('步骤15: 删除不需要的快照');
  const initialCount = s.snapshots.length;
  const toDelete = s.snapshots[0];
  console.log(`   删除快照: "${toDelete.name}"`);
  const delOk = s.deleteSnapshot(toDelete.snapshotId);
  assertEq(delOk, true, '删除成功');
  s = getState();
  assertEq(s.snapshots.length, initialCount - 1, '快照数-1');
  assertEq(s.snapshots.find(x => x.snapshotId === toDelete.snapshotId), undefined, '已删除的快照不存在');

  log('步骤16: 最终验证 - 所有快照数据完整');
  for (const snap of s.snapshots) {
    assertEq(!!snap.name, true, `快照 ${snap.snapshotId} 有名称`);
    assertEq(Array.isArray(snap.events), true, `快照 ${snap.name} 有事件数组`);
    assertEq(snap.events.length > 0, true, `快照 ${snap.name} 有事件数据`);
    assertEq(typeof snap.cursor, 'number', `快照 ${snap.name} 游标有效`);
    assertEq(Array.isArray(snap.activeAlarms), true, `快照 ${snap.name} 有告警数组`);
    assertEq(Array.isArray(snap.confirmations), true, `快照 ${snap.name} 有确认数组`);
    assertEq(Array.isArray(snap.rules), true, `快照 ${snap.name} 有规则数组`);
    assertEq(snap.rules.length > 0, true, `快照 ${snap.name} 有规则数据`);
    console.log(`   ✅ 快照 "${snap.name}" 数据完整`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('🎉 端到端主流程验证完成！所有功能正常工作。');
  console.log('═'.repeat(60));
  console.log('\n📋 最终快照清单:');
  s.snapshots.forEach((snap, i) => {
    console.log(`   ${i + 1}. 📌 ${snap.name}`);
    console.log(`      描述: ${snap.description || '(无)'}`);
    console.log(`      游标位置: ${snap.cursor}`);
    console.log(`      事件数量: ${snap.events.length}`);
    console.log(`      活动告警: ${snap.activeAlarms.length}个`);
    console.log(`      确认记录: ${snap.confirmations.length}条`);
    console.log(`      规则配置: ${snap.rules.length}条`);
    console.log(`      操作员备注: ${snap.operatorNotes || '(无)'}`);
    console.log(`      创建时间: ${new Date(snap.createdAt).toLocaleString()}`);
  });

  process.exit(0);
}

main().catch(e => {
  console.error('\n❌ 验证失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});
