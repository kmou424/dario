#!/usr/bin/env node
/**
 * A third-party client's own advisor tool reaches the API (dario#1812).
 *
 * `advisor` is a name the bundle knows but cannot advertise (dario#1376), and
 * it used to do two things to a foreign client that declared it:
 *
 *   1. It counted as a Claude Code tool in detectNonCCByTools, so a client
 *      whose other tools were unmapped was no longer detected as foreign and
 *      went down the remap path, where its own tools were renamed.
 *   2. An Anthropic-defined advisor_YYYYMMDD entry was never advertised.
 *
 * Properties:
 *   1. An unadvertisable bundled name does not make a foreign surface native.
 *   2. A genuine Claude Code surface is detected exactly as before.
 *   3. A client advisor_YYYYMMDD entry goes out verbatim, once, on the remap path.
 *   4. A request that declares none of these is byte-identical to before.
 *
 * In-process — no proxy / OAuth / upstream.
 */
import { buildCCRequest, detectNonCCByTools, CC_TOOL_DEFINITIONS_UNADVERTISABLE } from '../dist/cc-template.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log(`  OK ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${detail !== undefined ? ' :: ' + String(detail).slice(0, 400) : ''}`); fail++; }
};
const header = (n) => console.log(`\n=== ${n} ===`);

const id = { deviceId: 'd', accountUuid: 'a', sessionId: 's' };
const tool = (name) => ({ name, description: name, input_schema: { type: 'object', properties: { __intent: { type: 'string' } }, required: ['__intent'] } });
// The tool names a real pi session declares: enough foreign tools that the surface is
// detected as foreign without an advisor, and few enough that a counted advisor flips it.
const foreign = ['read', 'bash', 'edit', 'write', 'todo', 'git_diff', 'git_status', 'git_log', 'git_show', 'git_checkpoint_create', 'git_checkpoint_list', 'git_checkpoint_drop', 'git_commit', 'git_undo', 'session_search', 'session_read', 'session_list', 'session_summary', 'obs_recall', '__pi_deferred_placeholder__'].map(tool);
const serverAdvisor = { type: 'advisor_20260301', name: 'advisor', model: 'claude-opus-5-5', max_tokens: 2048 };
const body = (tools) => ({ model: 'claude-sonnet-5-5', max_tokens: 100, system: 'You are a coding agent.', messages: [{ role: 'user', content: 'hi' }], tools });
const wire = (tools, opts = {}) => buildCCRequest(body(tools), [], id, opts).body.tools;

header('1. an unadvertisable bundled name is not evidence of Claude Code');
{
  check('the fixture name is in the unadvertisable set', CC_TOOL_DEFINITIONS_UNADVERTISABLE.has('advisor'));
  check('a foreign surface stays foreign with a client advisor', detectNonCCByTools([...foreign, tool('advisor')]) === 'unknown-non-cc');
  check('the foreign surface alone is foreign', detectNonCCByTools(foreign) === 'unknown-non-cc');
  const out = wire([...foreign, tool('advisor')]);
  check('its own tools are forwarded under their own names', foreign.every((t) => out.some((o) => o.name === t.name && JSON.stringify(o) === JSON.stringify(t))));
  check('the client advisor goes out once with its own schema', out.filter((o) => o.name === 'advisor').length === 1 && JSON.stringify(out.find((o) => o.name === 'advisor')) === JSON.stringify(tool('advisor')));
}

header('2. a Claude Code surface is detected as before');
{
  const cc = ['Read', 'Bash', 'Grep'].map(tool);
  check('exact-case CC tools are not foreign', detectNonCCByTools(cc) === null);
  check('with a client advisor it is still not foreign', detectNonCCByTools([...cc, tool('advisor')]) === null);
}

header('3. an Anthropic-defined advisor goes out verbatim');
{
  const cc = ['Read', 'Bash'].map(tool);
  for (const [label, tools] of [['foreign surface', foreign], ['Claude Code surface', cc]]) {
    const out = wire([...tools, serverAdvisor]);
    const entries = out.filter((o) => o.name === 'advisor');
    check(`${label}: exactly one advisor entry`, entries.length === 1);
    check(`${label}: the entry is unchanged`, JSON.stringify(entries[0]) === JSON.stringify(serverAdvisor));
    check(`${label}: it is last`, out[out.length - 1].name === 'advisor');
  }
  const alone = wire([serverAdvisor]);
  check('declared alone it is still sent', alone.some((o) => o.type === 'advisor_20260301'));
  const cc2 = ['Read', 'Bash'].map(tool);
  let refused = false;
  try { wire([...cc2, { type: 'computer_20251124', name: 'computer' }]); } catch (e) { refused = e.name === 'UnsupportedClientToolError'; }
  check('on the Claude Code surface an unrelated Anthropic-defined tool is still refused by name', refused);
}

header('4. other requests are unchanged');
{
  const ccTools = ['Read', 'Bash', 'Grep'].map(tool);
  const a = JSON.stringify(wire(ccTools)), b = JSON.stringify(wire([...ccTools]));
  check('a Claude Code request is deterministic', a === b);
  check('a request without tools gains no advisor', !(wire(undefined) || []).some((o) => o.name === 'advisor'));
  check('a foreign request without advisor does not gain one', !wire(foreign).some((o) => o.name === 'advisor'));
}

console.log(`\nadvisor-passthrough: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
