import { applyPatch } from '../src/lib.js';
import fs from 'fs';
import path from 'path';

class ProductionScenariosTestRunner {
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

    async runProductionTests() {
        console.log('🏭 Apply-Patch Production-Grade Test Suite');
        console.log('='.repeat(80));
        console.log('Based on apply_patch_tool_instructions.md grammar specification');
        console.log('');

        // === GRAMMAR COMPLIANCE TESTS ===
        await this.runTest('Grammar: Complete Patch Structure', async () => {
            // Create the existing file first
            const existingFile = this.createTestFile('existing.py', `class MyClass:
    def existing_method(self):
        print("old")
        return False`);
            
            // Create the deprecated file first
            const deprecatedFile = this.createTestFile('deprecated.py', `# This file will be deleted
print("deprecated")`);

            const patch = `*** Begin Patch
*** Add File: tests/temp/new_feature.py
+def new_feature():
+    return "Hello World"
+
*** Update File: tests/temp/existing.py
@@ class MyClass:
 def existing_method(self):
     print("old")
-    return False
+    return True
 
*** Delete File: tests/temp/deprecated.py
*** End Patch`;

            const result = await applyPatch(patch);
            if (!result.added.includes('tests/temp/new_feature.py') ||
                !result.modified.includes('tests/temp/existing.py') ||
                !result.deleted.includes('tests/temp/deprecated.py')) {
                throw new Error('Complete patch structure not handled correctly');
            }
            
            // Cleanup
            this.cleanupTestFile(path.join(this.testDir, 'temp', 'new_feature.py'));
        });

        // === COMPLEX CONTEXT SCENARIOS ===
        await this.runTest('Multiple @@ Context Layers', async () => {
            const sourceFile = this.createTestFile('complex_context.py', `class OuterClass:
    def outer_method(self):
        class InnerClass:
            def inner_method(self):
                if True:
                    print("nested code")
                    return "original"
                else:
                    print("alternative")
        return InnerClass()
    
    def another_method(self):
        pass`);

            const patch = `*** Begin Patch
*** Update File: tests/temp/complex_context.py
@@ class OuterClass:
@@     def outer_method(self):
@@         class InnerClass:
@@             def inner_method(self):
                if True:
                    print("nested code")
-                    return "original"
+                    return "UPDATED"
                else:
                    print("alternative")
*** End Patch`;

            await applyPatch(patch);
            const content = fs.readFileSync(sourceFile, 'utf8');
            if (!content.includes('return "UPDATED"')) {
                throw new Error('Multiple context layers not applied correctly');
            }
            this.cleanupTestFile(sourceFile);
        });

        // === EDGE CASE: WHITESPACE HANDLING ===
        await this.runTest('Whitespace Preservation in Context', async () => {
            const sourceFile = this.createTestFile('whitespace_test.py', `def function():
    if condition:
        # Comment with spaces    
        value = "test"    
        return value
    else:
        return None`);

            const patch = `*** Begin Patch
*** Update File: tests/temp/whitespace_test.py
@@ def function():
    if condition:
        # Comment with spaces    
-        value = "test"    
+        value = "MODIFIED"    
        return value
*** End Patch`;

            await applyPatch(patch);
            const content = fs.readFileSync(sourceFile, 'utf8');
            if (!content.includes('value = "MODIFIED"    ')) {
                throw new Error('Whitespace not preserved correctly');
            }
            this.cleanupTestFile(sourceFile);
        });

        // === PRODUCTION SCENARIO: LARGE FILE MODIFICATION ===
        await this.runTest('Large File with Multiple Scattered Changes', async () => {
            const largeContent = Array.from({length: 100}, (_, i) => 
                `def function_${i}():\n    return ${i}\n`
            ).join('\n');
            
            const sourceFile = this.createTestFile('large_file.py', largeContent);

            const patch = `*** Begin Patch
*** Update File: tests/temp/large_file.py
@@ def function_10():
-    return 10
+    return "MODIFIED_10"

@@ def function_50():
-    return 50
+    return "MODIFIED_50"

@@ def function_90():
-    return 90
+    return "MODIFIED_90"
*** End Patch`;

            await applyPatch(patch);
            const content = fs.readFileSync(sourceFile, 'utf8');
            if (!content.includes('return "MODIFIED_10"') ||
                !content.includes('return "MODIFIED_50"') ||
                !content.includes('return "MODIFIED_90"')) {
                throw new Error('Multiple scattered changes not applied correctly');
            }
            this.cleanupTestFile(sourceFile);
        });

        // === FILE OPERATIONS COMBINATION ===
        await this.runTest('Complex Multi-File Refactoring', async () => {
            // Create initial files
            const oldFile = this.createTestFile('old_module.py', `class OldClass:
    def old_method(self):
        return "old"`);
            
            const mainFile = this.createTestFile('main.py', `from old_module import OldClass

def main():
    obj = OldClass()
    return obj.old_method()`);

            const patch = `*** Begin Patch
*** Add File: tests/temp/new_module.py
+class NewClass:
+    def new_method(self):
+        return "new and improved"
+
*** Update File: tests/temp/main.py
-from old_module import OldClass
+from new_module import NewClass

 def main():
-    obj = OldClass()
-    return obj.old_method()
+    obj = NewClass()
+    return obj.new_method()

*** Delete File: tests/temp/old_module.py
*** End Patch`;

            const result = await applyPatch(patch);
            
            // Verify new file created
            const newModulePath = path.join(this.testDir, 'temp', 'new_module.py');
            if (!fs.existsSync(newModulePath)) {
                throw new Error('New module file not created');
            }
            
            // Verify main file updated
            const mainContent = fs.readFileSync(mainFile, 'utf8');
            if (!mainContent.includes('from new_module import NewClass') ||
                !mainContent.includes('obj.new_method()')) {
                throw new Error('Main file not updated correctly');
            }
            
            // Verify old file deleted
            if (fs.existsSync(oldFile)) {
                throw new Error('Old file not deleted');
            }
            
            this.cleanupTestFile(newModulePath);
            this.cleanupTestFile(mainFile);
        });

        // === MOVE/RENAME OPERATIONS ===
        await this.runTest('File Move with Content Modification', async () => {
            const sourceFile = this.createTestFile('source_file.js', `function oldFunction() {
    console.log("old implementation");
    return false;
}`);

            const patch = `*** Begin Patch
*** Update File: tests/temp/source_file.js
*** Move to: tests/temp/renamed_file.js
@@ function oldFunction() {
-    console.log("old implementation");
-    return false;
+    console.log("new implementation");
+    return true;
*** End Patch`;

            await applyPatch(patch);
            
            // Verify original file is gone
            if (fs.existsSync(sourceFile)) {
                throw new Error('Original file still exists after move');
            }
            
            // Verify new file exists with correct content
            const newFile = path.join(this.testDir, 'temp', 'renamed_file.js');
            if (!fs.existsSync(newFile)) {
                throw new Error('Renamed file does not exist');
            }
            
            const content = fs.readFileSync(newFile, 'utf8');
            if (!content.includes('new implementation') || !content.includes('return true')) {
                throw new Error('Content not modified correctly during move');
            }
            
            this.cleanupTestFile(newFile);
        });

        // === END-OF-FILE MARKER SCENARIOS ===
        await this.runTest('End-of-File Marker Handling', async () => {
            const sourceFile = this.createTestFile('eof_test.py', `def function():
    return "value"
# End comment`);

            const patch = `*** Begin Patch
*** Update File: tests/temp/eof_test.py
 def function():
     return "value"
-# End comment
+# Updated end comment
*** End of File
*** End Patch`;

            await applyPatch(patch);
            const content = fs.readFileSync(sourceFile, 'utf8');
            if (!content.includes('Updated end comment')) {
                throw new Error('End-of-file modification not applied');
            }
            this.cleanupTestFile(sourceFile);
        });

        // === ERROR HANDLING TESTS ===
        await this.runTest('Invalid Grammar: Missing Begin', async () => {
            const patch = `*** Add File: test.txt
+content
*** End Patch`;

            try {
                await applyPatch(patch);
                throw new Error('Should have failed with missing begin marker');
            } catch (error) {
                if (!error.message.includes('Begin Patch')) {
                    throw new Error(`Wrong error message: ${error.message}`);
                }
            }
        });

        await this.runTest('Invalid Grammar: Missing End', async () => {
            const patch = `*** Begin Patch
*** Add File: test.txt
+content`;

            try {
                await applyPatch(patch);
                throw new Error('Should have failed with missing end marker');
            } catch (error) {
                if (!error.message.includes('End Patch')) {
                    throw new Error(`Wrong error message: ${error.message}`);
                }
            }
        });

        await this.runTest('Security: Absolute Path Rejection', async () => {
            const patch = `*** Begin Patch
*** Add File: /etc/passwd
+malicious content
*** End Patch`;

            try {
                await applyPatch(patch);
                throw new Error('Should have rejected absolute path');
            } catch (error) {
                if (!error.message.toLowerCase().includes('absolute')) {
                    throw new Error(`Wrong error message: ${error.message}`);
                }
            }
        });

        await this.runTest('Security: Parent Directory Traversal', async () => {
            const patch = `*** Begin Patch
*** Add File: ../../../etc/passwd
+malicious content
*** End Patch`;

            try {
                await applyPatch(patch);
                throw new Error('Should have rejected directory traversal');
            } catch (error) {
                if (!error.message.toLowerCase().includes('traversal')) {
                    throw new Error(`Wrong error message: ${error.message}`);
                }
            }
        });

        // === UNICODE AND SPECIAL CHARACTERS ===
        await this.runTest('Unicode Content Handling', async () => {
            const sourceFile = this.createTestFile('unicode_test.py', `def greet():
    return "Hello"`);

            const patch = `*** Begin Patch
*** Update File: tests/temp/unicode_test.py
 def greet():
-    return "Hello"
+    return "你好世界 🌍 émojis"
*** End Patch`;

            await applyPatch(patch);
            const content = fs.readFileSync(sourceFile, 'utf8');
            if (!content.includes('你好世界 🌍 émojis')) {
                throw new Error('Unicode content not handled correctly');
            }
            this.cleanupTestFile(sourceFile);
        });

        // === EMPTY FILE OPERATIONS ===
        await this.runTest('Empty File Creation', async () => {
            const patch = `*** Begin Patch
*** Add File: tests/temp/empty_file.txt
*** End Patch`;

            await applyPatch(patch);
            const emptyFile = path.join(this.testDir, 'temp', 'empty_file.txt');
            if (!fs.existsSync(emptyFile)) {
                throw new Error('Empty file not created');
            }
            
            const content = fs.readFileSync(emptyFile, 'utf8');
            if (content !== '') {
                throw new Error('File should be empty');
            }
            this.cleanupTestFile(emptyFile);
        });

        // === CONTEXT MATCHING EDGE CASES ===
        await this.runTest('Ambiguous Context Resolution', async () => {
            const sourceFile = this.createTestFile('ambiguous.py', `def function():
    print("line1")
    print("line2")
    print("line3")

def function():
    print("line1")
    print("line2")
    print("line3")`);

            const patch = `*** Begin Patch
*** Update File: tests/temp/ambiguous.py
@@ def function():
    print("line1")
-    print("line2")
+    print("MODIFIED line2")
    print("line3")
*** End Patch`;

            await applyPatch(patch);
            const content = fs.readFileSync(sourceFile, 'utf8');
            const matches = (content.match(/MODIFIED line2/g) || []).length;
            if (matches !== 1) {
                throw new Error(`Expected 1 modification, got ${matches}`);
            }
            this.cleanupTestFile(sourceFile);
        });

        // Print summary
        console.log('='.repeat(80));
        console.log('📊 PRODUCTION TEST SUMMARY');
        console.log('='.repeat(80));
        console.log(`✅ Passed: ${this.passed}`);
        if (this.failed > 0) {
            console.log(`❌ Failed: ${this.failed}`);
        }
        console.log(`📈 Success Rate: ${((this.passed / (this.passed + this.failed)) * 100).toFixed(1)}%`);
        console.log('');

        if (this.failed === 0) {
            console.log('🎉 ALL PRODUCTION TESTS PASSED!');
            console.log('🚀 JavaScript migration is production-ready!');
        } else {
            console.log('❌ Some tests failed. Review the issues above.');
            console.log('');
            console.log('Failed tests:');
            this.results.filter(r => r.status === 'FAILED').forEach(r => {
                console.log(`  - ${r.name}: ${r.error}`);
            });
        }
    }
}

// Run tests if this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const suite = new ProductionScenariosTestRunner();
    suite.runProductionTests().catch(console.error);
}

export { ProductionScenariosTestRunner };
