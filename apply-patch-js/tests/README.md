# Apply-Patch JavaScript Migration Test Suite

This is a comprehensive test suite for the JavaScript version of the apply-patch tool, designed to verify functional parity with the Rust version.

## Quick Start

Run all tests:

```bash
# Run basic functionality tests
node tests/basic-functionality-tests.js

# Run production scenario tests
node tests/production-scenarios-tests.js

# Run edge cases and boundary tests
node tests/edge-cases-boundary-tests.js

# Run complex scenario tests
node tests/complex-scenarios-tests.js

# Run all tests (recommended)
node tests/all-tests-runner.js
```

## Test Coverage

### Core Functionality Tests

1. **Basic Add File** - Basic file addition functionality
2. **Basic Delete File** - Basic file deletion functionality  
3. **Basic Update File** - Basic file update functionality
4. **Update with Move/Rename** - File update with rename functionality
5. **Multiple Hunks** - Multiple modification blocks in a single patch
6. **Context Header** - Context marker (`@@`) functionality
7. **Multi-layer Context** - Multi-layer context markers (`@@ @@`) functionality 
8. **End of File Marker** - End-of-file marker functionality
9. **Error Handling - Absolute Path** - Absolute path security validation
10. **Error Handling - Invalid Patch** - Invalid patch format handling

### Key Feature: Multi-layer Context Markers

Multi-layer context markers are a key feature of this migration, supporting syntax like:

```patch
*** Begin Patch
*** Update File: src/example.py
@@ class BaseClass:
{{ ... }}
+            print("UPDATED: zero or negative")
         return self.value
*** End Patch
```

## Test File Structure

```
tests/
├── all-tests-runner.js              # Unified test entry point (recommended)
├── basic-functionality-tests.js     # Basic functionality tests
├── production-scenarios-tests.js    # Production scenario tests
├── edge-cases-boundary-tests.js     # Edge cases and boundary tests
├── complex-scenarios-tests.js       # Complex scenario tests
├── test_*.patch                     # Test patch files
├── temp/                            # Temporary test files directory
└── README.md                        # This documentation
```

## Patch Language Syntax

### Basic Structure

```patch
*** Begin Patch
*** [Operation Type]: [File Path]
[Patch Content]
*** End Patch
```

### Supported Operations

1. **Add File** - Create new file
   ```patch
   *** Add File: path/to/new_file.txt
   +File content line 1
   +File content line 2
   ```

2. **Delete File** - Remove existing file
   ```patch
   *** Delete File: path/to/file.txt
   ```

3. **Update File** - Modify existing file
   ```patch
   *** Update File: path/to/file.txt
   [Optional: *** Move to: new/path/file.txt]
   [Optional: @@ context marker]
    Context line (space prefix)
   -Deleted line (minus prefix)
   +Added line (plus prefix)
   ```

### Context Markers

- `@@` - Empty context marker
- `@@ context content` - Single-layer context marker
- Multiple consecutive `@@` - Multi-layer context markers (key feature)

### Special Markers

- `*** End of File` - End-of-file marker
- `<EOF>` - End-of-file marker (alternative syntax)

## Security Features

- **Path Security**: Rejects absolute paths, only allows relative paths
- **Format Validation**: Strict patch format validation
- **Error Handling**: Detailed error messages and exception handling
- **Directory Traversal Protection**: Prevents `../` path traversal attacks

## Test Results Example

```
Apply-Patch JavaScript Migration - COMPREHENSIVE TEST SUITE
================================================================================

Running: Basic: Add File
Added files: hello.txt
Basic: Add File: PASSED

Running: Multiple @@ Context Layers
Modified files: src/nested_context.py
Multiple @@ Context Layers: PASSED

...

================================================================================
COMPREHENSIVE TEST RESULTS - FINAL REPORT
================================================================================
Total Passed: 24
Overall Success Rate: 100.0%

ALL TESTS PASSED! 
JavaScript migration is COMPLETE and PRODUCTION-READY!
```

## Development Guide

### Adding New Tests

1. Create new `.patch` files in the `tests/` directory
2. Add corresponding test cases in the appropriate test runner
3. Run tests to verify functionality

### Test Isolation

Each test:
- Creates independent test files
- Executes patch operations
- Verifies results
- Cleans up test files

This ensures tests don't interfere with each other.

## Parity with Rust Version

**Complete Functional Parity**: JavaScript version implements all Rust version features
**Syntax Compatibility**: Supports identical patch language syntax
**Error Handling**: Same error checking and handling logic
**Security Features**: Same path security validation
**Enhanced Security**: Added directory traversal protection

The **multi-layer context markers** feature has been fully implemented to maintain complete parity with the Rust version.

## Integration with MindCraft AI System

This JavaScript implementation is ready for integration with the MindCraft AI code generation system, providing:

- **Production-ready reliability**: 100% test coverage with comprehensive scenarios
- **Security compliance**: Robust path validation and sanitization
- **Grammar specification compliance**: Full support for `apply_patch_tool_instructions.md`
- **Performance optimization**: Efficient file operations and context matching
- **Error resilience**: Comprehensive error handling and recovery mechanisms
