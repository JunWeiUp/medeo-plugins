// The panel's rows come only from protocol data; nothing here names a real plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argumentValue, catalogEntries, nextArgument, pinEntries, pinFor, resultEntries, scopeFor, sendTargets } from '../src/model.ts';
import { answer, appEntries } from '../src/results.ts';

const layout = { name: 'action', type: 'enum', title: 'Layout', placeholder: null, optional: false,
  options: [{ value: 'left', title: 'Left half', subtitle: null, icon: 'data:image/svg+xml;base64,AA==', keywords: ['left'] }, { value: 'max', title: 'Maximize', subtitle: null, icon: null, keywords: [] }] };
const plugins = [
  { id: 'x.ring', name: 'Ring', description: null, icon: 'data:ring', has_ui: true, commands: [{ id: 'ring.apply', title: 'Apply layout' }, { id: 'ring.state', title: 'State' }],
    launcher: { keyword: 'win', provider: null, commands: [{ command: 'ring.apply', title: 'Apply layout', subtitle: 'Move the window', icon: null, keywords: ['window'], pinnable: true, arguments: [layout], expand: 'action', accepts: ['application'] }] } },
  { id: 'x.clip', name: 'Clips', description: null, icon: null, has_ui: false, commands: [{ id: 'clip.add', title: 'Add' }],
    launcher: { keyword: 'clip', provider: { types: ['text'] }, commands: [{ command: 'clip.add', title: 'Add to clips', subtitle: null, icon: null, keywords: [], pinnable: false, arguments: [], expand: null, accepts: ['text', 'url'] }] } },
  { id: 'x.plain', name: 'Plain', description: null, icon: null, has_ui: false, commands: [{ id: 'plain.go', title: 'Go' }], launcher: null },
];

test('catalog: windows, commands (declared or not) and expanded options', () => {
  const rows = catalogEntries(plugins, 'Open');
  assert.deepEqual(rows.map(r => r.key), ['open:x.ring', 'command:x.ring:ring.apply', 'option:x.ring:ring.apply:left', 'option:x.ring:ring.apply:max', 'command:x.ring:ring.state', 'command:x.clip:clip.add', 'command:x.plain:plain.go']);
  const apply = rows[1], left = rows[2];
  assert.equal(apply.subtitle, 'Ring · Move the window');
  assert.equal(nextArgument(apply).name, 'action');
  assert.deepEqual(left.args, { action: 'left' });
  assert.equal(nextArgument(left), undefined);
  assert.equal(left.subtitle, 'Ring · Apply layout');
  assert.ok(left.keywords.includes('window') && left.keywords.includes('left') && !left.keywords.includes('ring.apply'));
  assert.equal(left.image, 'data:image/svg+xml;base64,AA==');
  assert.equal(rows[6].pinnable, false);
});
test('scope by keyword or name; send-to by data type, never back to the sender', () => {
  assert.equal(scopeFor('WIN ', plugins).id, 'x.ring');
  assert.equal(scopeFor('clips', plugins).id, 'x.clip');
  assert.equal(scopeFor('nothing', plugins), undefined);
  assert.deepEqual(sendTargets('text', plugins).map(t => t.command), ['clip.add']);
  assert.deepEqual(sendTargets('application', plugins).map(t => t.command), ['ring.apply']);
  assert.deepEqual(sendTargets('text', plugins, 'x.clip'), []);
});
test('provider results keep their item, data and accessory', () => {
  const [row] = resultEntries([{ plugin_id: 'x.clip', items: [{ id: '7', title: 'hello', type: 'text', data: 'hello', icon: { symbol: 'doc' }, accessory: { text: '3' } }] }, { plugin_id: 'gone', items: [{ id: '1', title: 'x' }] }], plugins);
  assert.equal(row.key, 'result:x.clip:7');
  assert.deepEqual(row.data, { type: 'text', value: 'hello', title: 'hello' });
  assert.equal(row.symbol, 'doc');
  assert.deepEqual(row.accessory, { text: '3', tone: 'default' });
  assert.equal(row.subtitle, 'Clips');
});
test('pins remember a command with its arguments and vanish with it', () => {
  const rows = catalogEntries(plugins, 'Open');
  const pin = pinFor(rows[2]);
  assert.deepEqual(pin.args, { action: 'left' });
  assert.equal(pinFor(rows[6]), null);
  const [shown] = pinEntries([pin], rows);
  assert.equal(shown.title, 'Left half');
  assert.equal(nextArgument(shown), undefined);
  assert.deepEqual(pinEntries([pin], rows.filter(r => r.plugin !== 'x.ring')), []);
});
test('typed arguments', () => {
  assert.equal(argumentValue({ type: 'number', options: [] }, ' 12 '), 12);
  assert.equal(argumentValue({ type: 'number', options: [] }, 'x'), null);
  assert.equal(argumentValue({ type: 'boolean', options: [] }, 'yes'), true);
  assert.equal(argumentValue({ type: 'string', options: [] }, '  '), null);
  assert.equal(argumentValue(layout, 'Maximize'), 'max');
});
test('apps carry their path; answers carry the plain value as text', () => {
  const [app] = appEntries([{ id: '1', title: 'Safari', path: '/Applications/Safari.app', bundle_id: 'com.apple.Safari' }]);
  assert.deepEqual(app.data, { type: 'application', value: '/Applications/Safari.app', title: 'Safari' });
  assert.deepEqual(answer('2*3', { calc: 'Calc', convert: 'Conv' }).data, { type: 'text', value: '6', title: '6' });
});
