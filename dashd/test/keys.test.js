import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKey } from '../src/keys.js';

test('waitforkey output maps to a key name and its action', () => {
  assert.deepEqual(parseKey('21 1'), { press: true, name: 'Y', action: 'allow' });
  assert.deepEqual(parseKey('49 1'), { press: true, name: 'N', action: 'deny' });
  assert.deepEqual(parseKey('194 1'), { press: true, name: 'CENTER', action: 'open' });
  assert.deepEqual(parseKey('28 1'), { press: true, name: 'ENTER', action: 'end' });
});

test('both page-turn pairs move between screens', () => {
  assert.equal(parseKey('104 1').action, 'screen:next');
  assert.equal(parseKey('191 1').action, 'screen:next');
  assert.equal(parseKey('193 1').action, 'screen:prev');
  assert.equal(parseKey('109 1').action, 'screen:prev');
});

test('keys reserved for the Xcode stage and unknown codes do nothing', () => {
  for (const code of ['45 1', '48 1', '20 1', '999 1', 'garbage']) {
    assert.equal(parseKey(code).action, null, code);
  }
});

test('a release is told apart from a press', () => {
  assert.equal(parseKey('21 0').press, false);
  assert.equal(parseKey('21 1').press, true);
});
