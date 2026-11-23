import assert from 'node:assert/strict';
import test from 'node:test';
import { activityDay, HOUR, type AgentTurn } from '../src/agent-activity';

test('daily totals clip overnight turns and count parallel work in separate lanes', () => {
  const turns: AgentTurn[] = [
    { agent: 'claude', project: 'one', start: -HOUR, end: HOUR },
    { agent: 'codex', project: 'two', start: HOUR / 2, end: HOUR * 2 },
    { agent: 'claude', project: 'three', start: HOUR * 23, end: HOUR * 25 },
  ];
  const day = activityDay(turns, 0, HOUR * 24);
  assert.equal(day.duration, HOUR * 3.5);
  assert.equal(day.lanes, 2);
  assert.deepEqual(day.blocks.map(({ lane }) => lane), [0, 1, 0]);
  assert.equal(activityDay(turns, HOUR * 24, HOUR * 48).duration, HOUR);
});
