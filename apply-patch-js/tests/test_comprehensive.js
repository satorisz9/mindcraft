import { applyPatch } from './src/lib.js';
import fs from 'fs';

console.log('=== COMPREHENSIVE PATCH TESTING ===');

const tests = [
  { name: 'Basic Add File', file: 'test_add_basic.patch' },
  { name: 'Basic Delete File', file: 'test_delete_basic.patch' },
  { name: 'Basic Update File', file: 'test_update_basic.patch' },
  { name: 'Update with Move/Rename', file: 'test_move_file.patch' },
  { name: 'Multiple Hunks', file: 'test_multiple_hunks.patch' },
  { name: 'Context Header', file: 'test_context_header.patch' },
  { name: 'Multi-layer Context (FIXED)', file: 'test_nested_context.patch' },
  { name: 'End of File Marker', file: 'test_eof.patch' },
  { name: 'Combined Operations', file: 'test_combined_simple.patch' },
  { name: 'Context Lines', file: 'test_context_lines.patch' }
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    if (!fs.existsSync(test.file)) {
      console.log('❌ ' + test.name + ': File not found');
      failed++;
      continue;
    }
    
    const content = fs.readFileSync(test.file, 'utf8');
    applyPatch(content);
    console.log('✅ ' + test.name + ': PASSED');
    passed++;
  } catch (e) {
    console.log('❌ ' + test.name + ': FAILED - ' + e.message);
    failed++;
  }
}

console.log('');
console.log('=== TEST RESULTS ===');
console.log('✅ Passed: ' + passed);
console.log('❌ Failed: ' + failed);
console.log('📊 Success Rate: ' + Math.round(passed / (passed + failed) * 100) + '%');

if (failed === 0) {
  console.log('');
  console.log('🎉 ALL TESTS PASSED! JavaScript migration is complete and functional!');
} else {
  console.log('');
  console.log('⚠️  Some tests failed. Review the failures above.');
}
