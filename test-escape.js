const { parseSFC } = require('./lib/compiler/parser');
const { generateScopeId } = require('./lib/compiler/scope-id');

const testTemplate = `
<div>
  <p>Normal interpolation: {{ title }}</p>
  <p>Escaped with backslash: \\{\\{ year \\}\\}</p>
  <p>Escaped with quotes: {{ '{{ month }}' }}</p>
  <p>String literal: {{ 'hello world' }}</p>
</div>
`;

const sfc = `
<template>${testTemplate}</template>
<script>
export default {
  data() {
    return {
      title: 'My Title'
    };
  }
};
</script>
`;

console.log('=== Template Escaping Test ===\n');
console.log('Input template:');
console.log(testTemplate);

const parsed = parseSFC(sfc, '/test.dywo');
const scopeId = generateScopeId('/test.dywo', process.cwd());

console.log('\nParsed template content:');
console.log(parsed.template.content);

console.log('\n=== Testing Runtime Regex ===\n');

const INTERP_RE = /\{\{((?:[^'"{}]|'[^']*'|"[^"]*")*?)\}\}/g;
const ESC_OPEN = '\x00DYWO_ESC_OPEN\x00';
const ESC_CLOSE = '\x00DYWO_ESC_CLOSE\x00';

const testCases = [
  { input: '{{ title }}', expected: 'title' },
  { input: "{{ '{{ year }}' }}", expected: "'{{ year }}'" },
  { input: "{{ 'hello world' }}", expected: "'hello world'" },
  { input: '{{ "test" }}', expected: '"test"' },
  { input: "{{ a > b ? 'yes' : 'no' }}", expected: "a > b ? 'yes' : 'no'" }
];

testCases.forEach(({ input, expected }) => {
  INTERP_RE.lastIndex = 0;
  const match = INTERP_RE.exec(input);
  const captured = match ? match[1].trim() : null;
  const passed = captured === expected;
  console.log(`${passed ? '✓' : '✗'} ${input}`);
  console.log(`  Expected: ${expected}`);
  console.log(`  Captured: ${captured}`);
  console.log();
});

console.log('=== Testing Backslash Escape ===\n');

const escapeInput = '\\{\\{ year \\}\\}';
const withPlaceholders = escapeInput
  .replace(/\\\{\\\{/g, ESC_OPEN)
  .replace(/\\\}\\\}/g, ESC_CLOSE);

console.log('Input:', escapeInput);
console.log('After placeholder replacement:', withPlaceholders);

INTERP_RE.lastIndex = 0;
const match = INTERP_RE.exec(withPlaceholders);
console.log('Regex matches:', match ? 'YES (unexpected)' : 'NO (correct - escaped)');

const finalOutput = withPlaceholders
  .replace(new RegExp(ESC_OPEN, 'g'), '{{')
  .replace(new RegExp(ESC_CLOSE, 'g'), '}}');
console.log('Final output:', finalOutput);
console.log('Expected: {{ year }}');
console.log('Match:', finalOutput === '{{ year }}' ? '✓ PASS' : '✗ FAIL');
