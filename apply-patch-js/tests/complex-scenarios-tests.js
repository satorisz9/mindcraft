import { applyPatch } from '../src/lib.js';
import fs from 'fs';
import path from 'path';

class ComplexScenariosTestRunner {
    constructor() {
        this.passed = 0;
        this.failed = 0;
        this.results = [];
        this.testDir = path.dirname(new URL(import.meta.url).pathname);
    }

    async runTest(testName, testFn) {
        try {
            console.log(`🧪 Running: ${testName}`);
            await testFn();
            this.passed++;
            this.results.push({ name: testName, status: 'PASSED', error: null });
            console.log(`✅ ${testName}: PASSED\n`);
        } catch (error) {
            this.failed++;
            this.results.push({ name: testName, status: 'FAILED', error: error.message });
            console.log(`❌ ${testName}: FAILED - ${error.message}\n`);
        }
    }

    createTestFile(filename, content) {
        const filepath = path.join(this.testDir, 'temp', filename);
        // Ensure temp directory exists
        fs.mkdirSync(path.dirname(filepath), { recursive: true });
        fs.writeFileSync(filepath, content);
        return filepath;
    }

    cleanupTestFile(filepath) {
        try {
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
        } catch (e) {
            // Ignore cleanup errors
        }
    }

    async runAdvancedTests() {
        console.log('🚀 Apply-Patch Advanced Test Suite - Edge Cases & Complex Scenarios');
        console.log('='.repeat(80));
        console.log('');

        // === COMPLEX MULTI-LAYER CONTEXT TESTS ===
        
        // Test 1: Triple-layer context nesting
        await this.runTest('Triple-layer Context Nesting', async () => {
            const testFile = this.createTestFile('triple_context.py', 
                `class OuterClass:
    def outer_method(self):
        pass
    
    class InnerClass:
        def inner_method(self):
            if True:
                print("nested condition")
            return "inner"
        
        def another_method(self):
            return "another"
`);
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/triple_context.py
@@ class OuterClass:
@@     class InnerClass:
@@         def inner_method(self):
             if True:
-                print("nested condition")
+                print("TRIPLE NESTED SUCCESS!")
             return "inner"
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('TRIPLE NESTED SUCCESS!')) {
                throw new Error('Triple-layer context patch was not applied correctly');
            }
            
            this.cleanupTestFile(testFile);
        });

        // Test 2: Context with special characters and whitespace
        await this.runTest('Context with Special Characters', async () => {
            const testFile = this.createTestFile('special_chars.py', 
                `class Test_Class_123:
    def method_with_$pecial_chars(self):
        # Comment with @special #symbols
        value = "string with spaces and symbols: @#$%"
        return value
`);
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/special_chars.py
@@ class Test_Class_123:
@@     def method_with_$pecial_chars(self):
         # Comment with @special #symbols
-        value = "string with spaces and symbols: @#$%"
+        value = "UPDATED: string with symbols"
         return value
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('UPDATED: string with symbols')) {
                throw new Error('Special characters context patch failed');
            }
            
            this.cleanupTestFile(testFile);
        });

        // Test 3: Very long context lines
        await this.runTest('Long Context Lines', async () => {
            const longLine = 'a'.repeat(200);
            const testFile = this.createTestFile('long_lines.py', 
                `def very_long_function_name_that_exceeds_normal_limits():
    very_long_variable_name_${longLine} = "value"
    return very_long_variable_name_${longLine}
`);
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/long_lines.py
@@ def very_long_function_name_that_exceeds_normal_limits():
-    very_long_variable_name_${longLine} = "value"
+    very_long_variable_name_${longLine} = "UPDATED_VALUE"
     return very_long_variable_name_${longLine}
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('UPDATED_VALUE')) {
                throw new Error('Long context lines patch failed');
            }
            
            this.cleanupTestFile(testFile);
        });

        // === EDGE CASE SYNTAX TESTS ===

        // Test 4: Empty lines and whitespace handling
        await this.runTest('Empty Lines and Whitespace', async () => {
            const testFile = this.createTestFile('whitespace.py', 
                `def function():

    # Empty line above
    
    return True

# Empty line below

`);
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/whitespace.py
@@
 def function():
 
     # Empty line above
-    
+    print("added line")
     return True
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('added line')) {
                throw new Error('Whitespace handling patch failed');
            }
            
            this.cleanupTestFile(testFile);
        });

        // Test 5: Multiple separate hunks (non-overlapping)
        await this.runTest('Multiple Separate Hunks', async () => {
            const testFile = this.createTestFile('separate_hunks.py', 
                `def func1():
    line1 = "value1"
    line2 = "value2"
    line3 = "value3"
    return line1, line2, line3

def func2():
    line4 = "value4"
    line5 = "value5"
    return line4, line5
`);
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/separate_hunks.py
@@ def func1():
     line1 = "value1"
-    line2 = "value2"
+    line2 = "UPDATED2"
     line3 = "value3"

@@ def func2():
     line4 = "value4"
-    line5 = "value5"
+    line5 = "UPDATED5"
     return line4, line5
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('UPDATED2') || !content.includes('UPDATED5')) {
                throw new Error('Multiple separate hunks failed');
            }
            
            this.cleanupTestFile(testFile);
        });

        // === COMPLEX FILE OPERATIONS ===

        // Test 6: Chain of file operations (Add -> Update -> Move -> Delete)
        await this.runTest('Complex File Operation Chain', async () => {
            const patch = `*** Begin Patch
*** Add File: tests/temp/temp_file.py
+def temporary_function():
+    return "temporary"
*** Update File: tests/temp/temp_file.py
*** Move to: tests/temp/renamed_file.py
@@
 def temporary_function():
-    return "temporary"
+    return "updated and renamed"
*** Add File: tests/temp/another_temp.py
+print("another file")
*** Delete File: tests/temp/another_temp.py
*** End Patch`;
            
            applyPatch(patch);
            
            // Verify renamed file exists and has correct content
            const renamedFile = path.join(this.testDir, 'temp', 'renamed_file.py');
            if (!fs.existsSync(renamedFile)) {
                throw new Error('Renamed file does not exist');
            }
            
            const content = fs.readFileSync(renamedFile, 'utf8');
            if (!content.includes('updated and renamed')) {
                throw new Error('File content not updated correctly');
            }
            
            // Verify original file is gone
            const originalFile = path.join(this.testDir, 'temp', 'temp_file.py');
            if (fs.existsSync(originalFile)) {
                throw new Error('Original file was not deleted after move');
            }
            
            // Verify deleted file is gone
            const deletedFile = path.join(this.testDir, 'temp', 'another_temp.py');
            if (fs.existsSync(deletedFile)) {
                throw new Error('File was not deleted');
            }
            
            this.cleanupTestFile(renamedFile);
        });

        // === ERROR HANDLING EDGE CASES ===

        // Test 7: Invalid context that doesn't exist
        await this.runTest('Invalid Context Error', async () => {
            const testFile = this.createTestFile('invalid_context.py', 
                `def existing_function():
    return True
`);
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/invalid_context.py
@@ def nonexistent_function():
-    return False
+    return True
*** End Patch`;
            
            try {
                applyPatch(patch);
                throw new Error('Should have failed with invalid context');
            } catch (error) {
                if (!error.message.includes('Failed to find context')) {
                    throw new Error('Wrong error message for invalid context');
                }
            }
            
            this.cleanupTestFile(testFile);
        });

        // Test 8: Malformed patch syntax variations
        await this.runTest('Malformed Patch Syntax', async () => {
            const malformedPatches = [
                // Missing Begin
                `*** Update File: test.py
@@
-old line
+new line
*** End Patch`,
                
                // Missing End
                `*** Begin Patch
*** Update File: test.py
@@
-old line
+new line`,
                
                // Invalid operation
                `*** Begin Patch
*** Invalid Operation: test.py
@@
-old line
+new line
*** End Patch`,
                
                // Missing file path
                `*** Begin Patch
*** Update File: 
@@
-old line
+new line
*** End Patch`
            ];
            
            for (const [index, patch] of malformedPatches.entries()) {
                try {
                    applyPatch(patch);
                    throw new Error(`Malformed patch ${index + 1} should have failed`);
                } catch (error) {
                    if (!error.message.includes('Invalid') && !error.message.includes('invalid')) {
                        throw new Error(`Wrong error for malformed patch ${index + 1}: ${error.message}`);
                    }
                }
            }
        });

        // Test 9: Unicode and international characters
        await this.runTest('Unicode and International Characters', async () => {
            const testFile = this.createTestFile('unicode.py', 
                `def 函数名():
    变量 = "中文字符串"
    emoji = "🚀🎉✅"
    return 变量 + emoji
`);
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/unicode.py
@@ def 函数名():
-    变量 = "中文字符串"
+    变量 = "更新的中文字符串"
     emoji = "🚀🎉✅"
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('更新的中文字符串')) {
                throw new Error('Unicode characters patch failed');
            }
            
            this.cleanupTestFile(testFile);
        });

        // Test 10: Very large file operations
        await this.runTest('Large File Operations', async () => {
            // Create a large file with 1000 lines
            const largeContent = Array.from({length: 1000}, (_, i) => 
                `def function_${i}():\n    return ${i}\n`
            ).join('\n');
            
            const testFile = this.createTestFile('large_file.py', largeContent);
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/large_file.py
@@ def function_500():
-    return 500
+    return "UPDATED_500"
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('UPDATED_500')) {
                throw new Error('Large file patch failed');
            }
            
            this.cleanupTestFile(testFile);
        });

        // Test 11: Nested directory operations
        await this.runTest('Nested Directory Operations', async () => {
            // Create nested directory structure
            const nestedDir = path.join(this.testDir, 'temp', 'deep', 'nested', 'path');
            fs.mkdirSync(nestedDir, { recursive: true });
            
            const patch = `*** Begin Patch
*** Add File: tests/temp/deep/nested/path/deep_file.py
+def deep_function():
+    return "deep"
*** Update File: tests/temp/deep/nested/path/deep_file.py
*** Move to: tests/temp/deep/nested/path/moved_deep_file.py
@@
 def deep_function():
-    return "deep"
+    return "moved and updated"
*** End Patch`;
            
            applyPatch(patch);
            
            const movedFile = path.join(nestedDir, 'moved_deep_file.py');
            if (!fs.existsSync(movedFile)) {
                throw new Error('Nested directory file was not created/moved');
            }
            
            const content = fs.readFileSync(movedFile, 'utf8');
            if (!content.includes('moved and updated')) {
                throw new Error('Nested directory file content incorrect');
            }
            
            // Cleanup
            fs.rmSync(path.join(this.testDir, 'temp', 'deep'), { recursive: true, force: true });
        });

        // Test 12: Context ambiguity resolution
        await this.runTest('Context Ambiguity Resolution', async () => {
            const testFile = this.createTestFile('ambiguous.py', 
                `class FirstClass:
    def method(self):
        print("first")
        return True

class SecondClass:
    def method(self):
        print("second")
        return True

class ThirdClass:
    def method(self):
        print("third")
        return True
`);
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/ambiguous.py
@@ class SecondClass:
@@     def method(self):
         print("second")
-        return True
+        return "SECOND_UPDATED"
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('SECOND_UPDATED')) {
                throw new Error('Context ambiguity resolution failed');
            }
            
            // Verify other classes unchanged
            if (!content.includes('print("first")') || !content.includes('print("third")')) {
                throw new Error('Other classes were incorrectly modified');
            }
            
            this.cleanupTestFile(testFile);
        });

        this.printSummary();
    }

    printSummary() {
        console.log('='.repeat(80));
        console.log('📊 ADVANCED TEST SUMMARY');
        console.log('='.repeat(80));
        console.log(`✅ Passed: ${this.passed}`);
        if (this.failed > 0) {
            console.log(`❌ Failed: ${this.failed}`);
        }
        console.log(`📈 Success Rate: ${((this.passed / (this.passed + this.failed)) * 100).toFixed(1)}%`);
        console.log('');

        if (this.failed > 0) {
            console.log('❌ FAILED TESTS:');
            this.results.filter(r => r.status === 'FAILED').forEach(result => {
                console.log(`   • ${result.name}: ${result.error}`);
            });
            console.log('');
        }

        if (this.failed === 0) {
            console.log('🎉 ALL ADVANCED TESTS PASSED!');
            console.log('🚀 JavaScript migration handles all edge cases correctly!');
            console.log('');
            console.log('✅ Advanced features verified:');
            console.log('   • Triple-layer context nesting');
            console.log('   • Special characters in context');
            console.log('   • Long context lines handling');
            console.log('   • Complex whitespace scenarios');
            console.log('   • Overlapping context hunks');
            console.log('   • Complex file operation chains');
            console.log('   • Comprehensive error handling');
            console.log('   • Unicode and international characters');
            console.log('   • Large file operations');
            console.log('   • Nested directory operations');
            console.log('   • Context ambiguity resolution');
        } else {
            console.log('⚠️  Some advanced tests failed. Review failures above.');
            process.exit(1);
        }
    }
}

// Run advanced tests
const suite = new ComplexScenariosTestRunner();
suite.runAdvancedTests().catch(error => {
    console.error('Advanced test suite failed:', error);
    process.exit(1);
});
