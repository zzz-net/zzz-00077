// 告警回放工具核心引擎回归测试
// 使用: npx tsx tests/engine.test.ts

import { importEvents } from '../src/engine/eventProcessor';
import { OutOfOrderHandler, validateUndoConfirmation } from '../src/engine/outOfOrderHandler';
import { Event } from '../src/engine/types';

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

function assertEqual<T>(actual: T, expected: T, msg: string = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${msg}\n   期望: ${expectedStr}\n   实际: ${actualStr}`);
  }
}

function assertTrue(cond: boolean, msg: string = '') {
  if (!cond) {
    throw new Error(msg || '断言失败，期望为 true');
  }
}

function assertFalse(cond: boolean, msg: string = '') {
  if (cond) {
    throw new Error(msg || '断言失败，期望为 false');
  }
}

function assertThrows(fn: () => unknown, expectedMsgPart?: string) {
  let threw = false;
  let actualMsg = '';
  try {
    fn();
  } catch (e) {
    threw = true;
    actualMsg = (e as Error).message;
  }
  if (!threw) {
    throw new Error('期望抛出异常，但实际没有抛出');
  }
  if (expectedMsgPart && !actualMsg.includes(expectedMsgPart)) {
    throw new Error(`异常信息不包含期望内容\n   期望包含: ${expectedMsgPart}\n   实际: ${actualMsg}`);
  }
}

// ============================================================
// 测试1: importEvents - 重复 eventId 应该被明确拒绝
// ============================================================
test('导入-重复eventId应该被拒绝', () => {
  const duplicateData = JSON.stringify([
    { eventId: 'a-001', timestamp: 1000, type: 'alert', title: 'A', payload: {} },
    { eventId: 'a-002', timestamp: 2000, type: 'clear', title: 'B', payload: {} },
    { eventId: 'a-001', timestamp: 3000, type: 'alert', title: 'A duplicate', payload: {} },
  ]);

  assertThrows(() => importEvents(duplicateData), '发现重复的 eventId');
});

test('导入-多个重复eventId应全部列出', () => {
  const duplicateData = JSON.stringify([
    { eventId: 'x-1', timestamp: 1000, type: 'info', title: '', payload: {} },
    { eventId: 'x-2', timestamp: 2000, type: 'info', title: '', payload: {} },
    { eventId: 'x-1', timestamp: 3000, type: 'info', title: '', payload: {} },
    { eventId: 'x-2', timestamp: 4000, type: 'info', title: '', payload: {} },
    { eventId: 'x-3', timestamp: 5000, type: 'info', title: '', payload: {} },
    { eventId: 'x-3', timestamp: 6000, type: 'info', title: '', payload: {} },
  ]);

  assertThrows(() => importEvents(duplicateData), 'x-1');
  assertThrows(() => importEvents(duplicateData), 'x-2');
  assertThrows(() => importEvents(duplicateData), 'x-3');
});

test('导入-无重复应正常通过并排序', () => {
  const goodData = JSON.stringify([
    { eventId: 'c', timestamp: 3000, type: 'info', title: 'C', payload: {} },
    { eventId: 'a', timestamp: 1000, type: 'info', title: 'A', payload: {} },
    { eventId: 'b', timestamp: 2000, type: 'info', title: 'B', payload: {} },
  ]);

  const result = importEvents(goodData);
  assertEqual(result.length, 3);
  assertEqual(result[0].eventId, 'a');
  assertEqual(result[1].eventId, 'b');
  assertEqual(result[2].eventId, 'c');
  assertEqual(result.map(e => e.status), [undefined, undefined, undefined]);
});

test('导入-缺字段应报错', () => {
  const noId = JSON.stringify([{ timestamp: 1000, type: 'info' }]);
  assertThrows(() => importEvents(noId), '缺少 eventId');

  const badType = JSON.stringify([{ eventId: 'x', timestamp: 1000, type: 'bad' }]);
  assertThrows(() => importEvents(badType), 'type 必须是');

  const notArray = JSON.stringify({ eventId: 'x', timestamp: 1000 });
  assertThrows(() => importEvents(notArray), '数组格式');
});

// ============================================================
// 测试2: OutOfOrderHandler - 乱序处理的正确性
// ============================================================
test('乱序-重复事件检测', () => {
  const h = new OutOfOrderHandler();
  const e1: Event = { eventId: 'e1', timestamp: 1000, type: 'alert', source: 's', title: 't', payload: {} };
  const r1 = h.checkDuplicate(e1);
  assertFalse(r1.isDuplicate);
  h.markAsProcessed(e1);

  const r2 = h.checkDuplicate(e1);
  assertTrue(r2.isDuplicate);
  assertEqual(r2.markedEvent.status, 'duplicate');
});

test('乱序-早到clear事件缓存', () => {
  const h = new OutOfOrderHandler();
  const clear: Event = { eventId: 'c1', timestamp: 1000, type: 'clear', source: 's', title: 'clear', payload: {}, correlationId: 'corr-1' };
  const r = h.checkEarlyClear(clear);
  assertEqual(r.status, 'pending');
  assertTrue(r.pendingEvent !== undefined);
  assertEqual(r.pendingEvent?.status, 'pending');
  assertEqual(h.getPendingClearEvents().length, 1);
});

test('乱序-clear先到，alert后到应自动匹配', () => {
  const h = new OutOfOrderHandler();
  const clear: Event = { eventId: 'c1', timestamp: 1000, type: 'clear', source: 's', title: 'clear', payload: {}, correlationId: 'corr-1' };
  const alert: Event = { eventId: 'a1', timestamp: 2000, type: 'alert', source: 's', title: 'alert', payload: {}, correlationId: 'corr-1' };

  h.checkEarlyClear(clear);
  h.markAsProcessed({ ...clear, status: 'pending' });

  const matchResult = h.checkMatchingClear(alert);
  assertTrue(matchResult.hasMatchingClear);
  assertTrue(matchResult.clearEvent !== undefined);
  assertEqual(matchResult.updatedEvent.status, 'matched_early_clear');
  assertEqual(h.getPendingClearEvents().length, 0);
});

test('乱序-撤销不存在的确认校验', () => {
  const confirmations = [
    { confirmationId: 'ok-1', active: true },
    { confirmationId: 'ok-2', active: false },
  ];

  const r1 = validateUndoConfirmation('not-exist', confirmations);
  assertFalse(r1.valid);
  assertTrue(r1.error?.includes('不存在'));

  const r2 = validateUndoConfirmation('ok-2', confirmations);
  assertFalse(r2.valid);
  assertTrue(r2.error?.includes('已被撤销'));

  const r3 = validateUndoConfirmation('ok-1', confirmations);
  assertTrue(r3.valid);
  assertTrue(r3.error === undefined);
});

// ============================================================
// 测试3: 导入事件数组完整性（不重复、不遗漏）
// ============================================================
test('导入-15个事件原样数目不缺失', () => {
  const data: any[] = [];
  for (let i = 1; i <= 15; i++) {
    data.push({
      eventId: `evt-${String(i).padStart(3, '0')}`,
      timestamp: 1000 * i,
      type: i % 3 === 0 ? 'clear' : i % 2 === 0 ? 'alert' : 'info',
      source: 'test',
      title: `事件${i}`,
      payload: { index: i },
      correlationId: `corr-${Math.floor((i - 1) / 2)}`,
    });
  }

  const shuffled = [...data].sort(() => Math.random() - 0.5);
  const result = importEvents(JSON.stringify(shuffled));

  assertEqual(result.length, 15);
  // 应该已排序
  for (let i = 1; i < result.length; i++) {
    assertTrue(result[i].timestamp >= result[i - 1].timestamp, `第${i}项时间戳应递增`);
  }
  // 所有eventId都存在
  const ids = new Set(result.map(e => e.eventId));
  for (let i = 1; i <= 15; i++) {
    assertTrue(ids.has(`evt-${String(i).padStart(3, '0')}`), `缺少evt-${String(i).padStart(3, '0')}`);
  }
});

// ============================================================
// 汇总结果
// ============================================================
console.log('\n========================================');
console.log(`测试完成: ${passed} 通过, ${failed} 失败`);
if (errors.length > 0) {
  console.error('\n失败列表:');
  errors.forEach(e => console.error(e));
  process.exit(1);
} else {
  console.log('🎉 所有测试通过！');
  process.exit(0);
}
