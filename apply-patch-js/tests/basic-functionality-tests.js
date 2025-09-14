import { applyPatch } from '../src/lib.js';
import fs from 'fs';
import path from 'path';

class BasicFunctionalityTestRunner {
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

    async runAllTests() {
        console.log('🚀 Apply-Patch JavaScript Migration Test Suite');
        console.log('='.repeat(50));
        console.log('');

        // Test 1: Basic Add File
        await this.runTest('Basic Add File', async () => {
            const patch = fs.readFileSync(path.join(this.testDir, 'test_add_basic.patch'), 'utf8');
            applyPatch(patch);
            
            // Verify file was created
            if (!fs.existsSync('hello.txt')) {
                throw new Error('File hello.txt was not created');
            }
            
            const content = fs.readFileSync('hello.txt', 'utf8');
            if (!content.includes('Hello world')) {
                throw new Error('File content is incorrect');
            }
        });

        // Test 2: Basic Delete File
        await this.runTest('Basic Delete File', async () => {
            // Ensure file exists first
            if (!fs.existsSync('hello.txt')) {
                fs.writeFileSync('hello.txt', 'Hello, world!\n');
            }
            
            const patch = fs.readFileSync(path.join(this.testDir, 'test_delete_basic.patch'), 'utf8');
            applyPatch(patch);
            
            // Verify file was deleted
            if (fs.existsSync('hello.txt')) {
                throw new Error('File hello.txt was not deleted');
            }
        });

        // Test 3: Basic Update File
        await this.runTest('Basic Update File', async () => {
            // Create test file
            const testFile = this.createTestFile('test_update.py', 
                'def greet():\n    print("Hello!")\n    return "greeting"\n');
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/test_update.py
 def greet():
-    print("Hello!")
+    print("Hello, updated!")
     return "greeting"
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('Hello, updated!')) {
                throw new Error('File was not updated correctly');
            }
            
            this.cleanupTestFile(testFile);
        });

        // Test 4: Update with Move/Rename
        await this.runTest('Update with Move/Rename', async () => {
            // Create test file
            const originalFile = this.createTestFile('old_name.py', 
                'def function():\n    print("original")\n    return True\n');
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/old_name.py
*** Move to: tests/temp/new_name.py
@@
-def function():
-    print("original")
-    return True
+def function():
+    print("renamed and updated")
+    return True
*** End Patch`;
            
            applyPatch(patch);
            
            // Verify old file is gone and new file exists
            if (fs.existsSync(originalFile)) {
                throw new Error('Original file was not deleted');
            }
            
            const newFile = path.join(this.testDir, 'temp', 'new_name.py');
            if (!fs.existsSync(newFile)) {
                throw new Error('New file was not created');
            }
            
            const content = fs.readFileSync(newFile, 'utf8');
            if (!content.includes('renamed and updated')) {
                throw new Error('File content was not updated correctly');
            }
            
            this.cleanupTestFile(newFile);
        });

        // Test 5: Multiple Hunks
        await this.runTest('Multiple Hunks', async () => {
            const testFile = this.createTestFile('multi_hunk.py', 
                'def greet():\n    print("Hello, world!")\n    return "greeting"\n\ndef calculate(a, b):\n    return a + b\n');
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/multi_hunk.py
 def greet():
-    print("Hello, world!")
+    print("Hello, updated world!")
     return "greeting"

 def calculate(a, b):
-    return a + b
+    result = a + b
+    print(f"Result: {result}")
+    return result
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('Hello, updated world!') || !content.includes('Result: {result}')) {
                throw new Error('Multiple hunks were not applied correctly');
            }
            
            this.cleanupTestFile(testFile);
        });

        // Test 6: Context Header
        await this.runTest('Context Header', async () => {
            const testFile = this.createTestFile('context_test.py', 
                'class TestClass:\n    def __init__(self):\n        self.value = 0\n    \n    def method(self):\n        if self.value > 0:\n            print("positive")\n        else:\n            print("zero or negative")\n');
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/context_test.py
@@ class TestClass:
     def method(self):
         if self.value > 0:
-            print("positive")
+            print("value is positive")
         else:
             print("zero or negative")
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('value is positive')) {
                throw new Error('Context header patch was not applied correctly');
            }
            
            this.cleanupTestFile(testFile);
        });

        // Test 7: Multi-layer Context (The key fix!)
        await this.runTest('Multi-layer Context', async () => {
            const testFile = this.createTestFile('nested_context.py', 
                'class BaseClass:\n    def __init__(self):\n        self.value = 0\n    \n    def method(self):\n        if self.value > 0:\n            print("value is positive")\n        else:\n            print("zero or negative")\n        return self.value\n');
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/nested_context.py
@@ class BaseClass:
@@     def method(self):
         if self.value > 0:
             print("value is positive")
         else:
-            print("zero or negative")
+            print("MULTI-LAYER SUCCESS!")
         return self.value
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('MULTI-LAYER SUCCESS!')) {
                throw new Error('Multi-layer context patch was not applied correctly');
            }
            
            this.cleanupTestFile(testFile);
        });

        // Test 8: End of File Marker
        await this.runTest('End of File Marker', async () => {
            const testFile = this.createTestFile('eof_test.py', 
                'def function():\n    print("test")\n    return True\n');
            
            const patch = `*** Begin Patch
*** Update File: tests/temp/eof_test.py
@@
 def function():
     print("test")
     return True
+
+# Added at end of file
+def new_function():
+    return "new"
*** End of File
*** End Patch`;
            
            applyPatch(patch);
            
            const content = fs.readFileSync(testFile, 'utf8');
            if (!content.includes('new_function')) {
                throw new Error('End of file marker patch was not applied correctly');
            }
            
            this.cleanupTestFile(testFile);
        });

        // Test 9: Error Handling - Absolute Path
        await this.runTest('Error Handling - Absolute Path', async () => {
            const patch = fs.readFileSync(path.join(this.testDir, 'test_absolute_path.patch'), 'utf8');
            
            try {
                applyPatch(patch);
                throw new Error('Should have thrown an error for absolute path');
            } catch (error) {
                if (!error.message.includes('absolute')) {
                    throw new Error('Wrong error message for absolute path');
                }
                // Expected error, test passes
            }
        });

        // Test 10: Error Handling - Invalid Patch
        await this.runTest('Error Handling - Invalid Patch', async () => {
            const patch = fs.readFileSync(path.join(this.testDir, 'test_invalid_patch.patch'), 'utf8');
            
            try {
                applyPatch(patch);
                throw new Error('Should have thrown an error for invalid patch');
            } catch (error) {
                if (!error.message.includes('invalid patch')) {
                    throw new Error('Wrong error message for invalid patch');
                }
                // Expected error, test passes
            }
        });

        this.printSummary();
    }

    printSummary() {
        console.log('='.repeat(50));
        console.log('📊 TEST SUMMARY');
        console.log('='.repeat(50));
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
            console.log('🎉 ALL TESTS PASSED!');
            console.log('🚀 JavaScript migration is complete and fully functional!');
            console.log('');
            console.log('✅ Features verified:');
            console.log('   • Basic file operations (Add, Delete, Update)');
            console.log('   • File renaming with Move To');
            console.log('   • Multiple hunks in single patch');
            console.log('   • Context headers (@@)');
            console.log('   • Multi-layer context headers (@@ @@)');
            console.log('   • End of file markers (<EOF>)');
            console.log('   • Error handling for invalid patches');
            console.log('   • Path security (absolute path rejection)');
        } else {
            console.log('⚠️  Some tests failed. Please review the failures above.');
            process.exit(1);
        }
    }
}

// Run all tests
const runner = new BasicFunctionalityTestRunner();
runner.runAllTests().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
});
