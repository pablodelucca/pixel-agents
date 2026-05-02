/**
 * Unit tests for the RADAR assessment queue.
 *
 * Run with: npm test (from webview-ui/)
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  clearQueue,
  createRadarQueue,
  dequeue,
  enqueue,
  isInQueue,
  removeFromQueue,
} from '../src/office/engine/radarQueue.ts';

describe('radarQueue', () => {
  test('createRadarQueue returns empty state', () => {
    const q = createRadarQueue();
    assert.equal(q.visitorSeatId, null);
    assert.equal(q.currentAgentId, null);
    assert.deepEqual(q.waiting, []);
  });

  test('enqueue first agent goes directly to currentAgentId', () => {
    const q = createRadarQueue();
    const result = enqueue(q, 1);
    assert.equal(result, true);
    assert.equal(q.currentAgentId, 1);
    assert.deepEqual(q.waiting, []);
  });

  test('enqueue second agent goes to waiting list', () => {
    const q = createRadarQueue();
    enqueue(q, 1);
    const result = enqueue(q, 2);
    assert.equal(result, true);
    assert.equal(q.currentAgentId, 1);
    assert.deepEqual(q.waiting, [2]);
  });

  test('enqueue rejects duplicate at visitor seat', () => {
    const q = createRadarQueue();
    enqueue(q, 1);
    const result = enqueue(q, 1);
    assert.equal(result, false);
    assert.equal(q.currentAgentId, 1);
    assert.deepEqual(q.waiting, []);
  });

  test('enqueue rejects duplicate in waiting list', () => {
    const q = createRadarQueue();
    enqueue(q, 1);
    enqueue(q, 2);
    const result = enqueue(q, 2);
    assert.equal(result, false);
    assert.deepEqual(q.waiting, [2]);
  });

  test('dequeue promotes next waiting agent', () => {
    const q = createRadarQueue();
    enqueue(q, 1);
    enqueue(q, 2);
    enqueue(q, 3);

    const promoted = dequeue(q);
    assert.equal(promoted, 2);
    assert.equal(q.currentAgentId, 2);
    assert.deepEqual(q.waiting, [3]);
  });

  test('dequeue returns null when no one waiting', () => {
    const q = createRadarQueue();
    enqueue(q, 1);

    const promoted = dequeue(q);
    assert.equal(promoted, null);
    assert.equal(q.currentAgentId, null);
  });

  test('removeFromQueue removes current agent and promotes next', () => {
    const q = createRadarQueue();
    enqueue(q, 1);
    enqueue(q, 2);

    const result = removeFromQueue(q, 1);
    assert.equal(result, true);
    assert.equal(q.currentAgentId, 2);
    assert.deepEqual(q.waiting, []);
  });

  test('removeFromQueue removes waiting agent', () => {
    const q = createRadarQueue();
    enqueue(q, 1);
    enqueue(q, 2);
    enqueue(q, 3);

    const result = removeFromQueue(q, 2);
    assert.equal(result, true);
    assert.equal(q.currentAgentId, 1);
    assert.deepEqual(q.waiting, [3]);
  });

  test('removeFromQueue returns false for unknown agent', () => {
    const q = createRadarQueue();
    enqueue(q, 1);

    const result = removeFromQueue(q, 99);
    assert.equal(result, false);
  });

  test('clearQueue returns all agents and empties queue', () => {
    const q = createRadarQueue();
    enqueue(q, 1);
    enqueue(q, 2);
    enqueue(q, 3);

    const evicted = clearQueue(q);
    assert.deepEqual(evicted, [1, 2, 3]);
    assert.equal(q.currentAgentId, null);
    assert.deepEqual(q.waiting, []);
  });

  test('clearQueue on empty queue returns empty array', () => {
    const q = createRadarQueue();
    const evicted = clearQueue(q);
    assert.deepEqual(evicted, []);
  });

  test('isInQueue checks current and waiting', () => {
    const q = createRadarQueue();
    enqueue(q, 1);
    enqueue(q, 2);

    assert.equal(isInQueue(q, 1), true);
    assert.equal(isInQueue(q, 2), true);
    assert.equal(isInQueue(q, 3), false);
  });

  test('FIFO order preserved across multiple enqueue/dequeue cycles', () => {
    const q = createRadarQueue();
    enqueue(q, 10);
    enqueue(q, 20);
    enqueue(q, 30);

    assert.equal(dequeue(q), 20); // 10 leaves, 20 promoted
    assert.equal(dequeue(q), 30); // 20 leaves, 30 promoted
    assert.equal(dequeue(q), null); // 30 leaves, empty
    assert.equal(q.currentAgentId, null);
  });
});
