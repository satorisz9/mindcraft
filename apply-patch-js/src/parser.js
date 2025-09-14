/**
 * This module is responsible for parsing & validating a patch into a list of "hunks".
 * (It does not attempt to actually check that the patch can be applied to the filesystem.)
 *
 * The official Lark grammar for the apply-patch format is:
 *
 * start: begin_patch hunk+ end_patch
 * begin_patch: "*** Begin Patch" LF
 * end_patch: "*** End Patch" LF?
 *
 * hunk: add_hunk | delete_hunk | update_hunk
 * add_hunk: "*** Add File: " filename LF add_line+
 * delete_hunk: "*** Delete File: " filename LF
 * update_hunk: "*** Update File: " filename LF change_move? change?
 * filename: /(.+)/
 * add_line: "+" /(.+)/ LF -> line
 *
 * change_move: "*** Move to: " filename LF
 * change: (change_context | change_line)+ eof_line?
 * change_context: ("@@" | "@@ " /(.+)/) LF
 * change_line: ("+" | "-" | " ") /(.+)/ LF
 * eof_line: "*** End of File" LF
 *
 * The parser below is a little more lenient than the explicit spec and allows for
 * leading/trailing whitespace around patch markers.
 */

import path from 'path';

// Constants
const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

/**
 * Currently, the only OpenAI model that knowingly requires lenient parsing is
 * gpt-4.1. While we could try to require everyone to pass in a strictness
 * param when invoking apply_patch, it is a pain to thread it through all of
 * the call sites, so we resign ourselves allowing lenient parsing for all
 * models. See `ParseMode.Lenient` for details on the exceptions we make for
 * gpt-4.1.
 */
const PARSE_IN_STRICT_MODE = false;

// Error classes
export class ParseError extends Error {
    constructor(message, lineNumber = null) {
        super(message);
        this.name = 'ParseError';
        this.lineNumber = lineNumber;
    }
}

export class InvalidPatchError extends ParseError {
    constructor(message) {
        super(`invalid patch: ${message}`);
        this.name = 'InvalidPatchError';
    }
}

export class InvalidHunkError extends ParseError {
    constructor(message, lineNumber) {
        super(`invalid hunk at line ${lineNumber}, ${message}`);
        this.name = 'InvalidHunkError';
        this.lineNumber = lineNumber;
    }
}

// Enums
const ParseMode = {
    /**
     * Parse the patch text argument as is.
     */
    Strict: 'Strict',
    
    /**
     * GPT-4.1 is known to formulate the `command` array for the `local_shell`
     * tool call for `apply_patch` call using something like the following:
     *
     * ```json
     * [
     *   "apply_patch",
     *   "<<'EOF'\n*** Begin Patch\n*** Update File: README.md\n@@...\n*** End Patch\nEOF\n",
     * ]
     * ```
     *
     * This is a problem because `local_shell` is a bit of a misnomer: the
     * `command` is not invoked by passing the arguments to a shell like Bash,
     * but are invoked using something akin to `execvpe(3)`.
     *
     * This is significant in this case because where a shell would interpret
     * `<<'EOF'...` as a heredoc and pass the contents via stdin (which is
     * fine, as `apply_patch` is specified to read from stdin if no argument is
     * passed), `execvpe(3)` interprets the heredoc as a literal string. To get
     * the `local_shell` tool to run a command the way shell would, the
     * `command` array must be something like:
     *
     * ```json
     * [
     *   "bash",
     *   "-lc",
     *   "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: README.md\n@@...\n*** End Patch\nEOF\n",
     * ]
     * ```
     *
     * In lenient mode, we check if the argument to `apply_patch` starts with
     * `<<'EOF'` and ends with `EOF\n`. If so, we strip off these markers,
     * trim() the result, and treat what is left as the patch text.
     */
    Lenient: 'Lenient'
};

// Data structures
export class Hunk {
    constructor(type, data) {
        this.type = type;
        Object.assign(this, data);
    }

    static AddFile(path, contents) {
        return new Hunk('AddFile', { path, contents });
    }

    static DeleteFile(path) {
        return new Hunk('DeleteFile', { path });
    }

    static UpdateFile(path, movePathOrNull, chunks) {
        return new Hunk('UpdateFile', { 
            path, 
            move_path: movePathOrNull, 
            chunks 
        });
    }

    resolvePath(cwd) {
        switch (this.type) {
            case 'AddFile':
            case 'DeleteFile':
            case 'UpdateFile':
                return path.resolve(cwd, this.path);
            default:
                throw new Error(`Unknown hunk type: ${this.type}`);
        }
    }
}

export class UpdateFileChunk {
    constructor(changeContext, oldLines, newLines, isEndOfFile = false) {
        /**
         * A single line of context used to narrow down the position of the chunk
         * (this is usually a class, method, or function definition.)
         */
        this.change_context = changeContext;

        /**
         * A contiguous block of lines that should be replaced with `new_lines`.
         * `old_lines` must occur strictly after `change_context`.
         */
        this.old_lines = oldLines;
        this.new_lines = newLines;

        /**
         * If set to true, `old_lines` must occur at the end of the source file.
         * (Tolerance around trailing newlines should be encouraged.)
         */
        this.is_end_of_file = isEndOfFile;
    }
}

export class ApplyPatchArgs {
    constructor(patch, hunks, workdir = null) {
        this.patch = patch;
        this.hunks = hunks;
        this.workdir = workdir;
    }
}

export function parsePatch(patch) {
    const mode = PARSE_IN_STRICT_MODE ? ParseMode.Strict : ParseMode.Lenient;
    return parsePatchText(patch, mode);
}

function parsePatchText(patch, mode) {
    const lines = patch.trim().split('\n');
    
    let processedLines;
    try {
        checkPatchBoundariesStrict(lines);
        processedLines = lines;
    } catch (e) {
        if (mode === ParseMode.Strict) {
            throw e;
        }
        processedLines = checkPatchBoundariesLenient(lines, e);
    }
    
    const hunks = [];
    // The above checks ensure that lines.length >= 2.
    const lastLineIndex = processedLines.length - 1;
    let remainingLines = processedLines.slice(1, lastLineIndex);
    let lineNumber = 2;
    
    while (remainingLines.length > 0) {
        const [hunk, hunkLines] = parseOneHunk(remainingLines, lineNumber);
        hunks.push(hunk);
        lineNumber += hunkLines;
        remainingLines = remainingLines.slice(hunkLines);
    }
    
    const patchText = processedLines.join('\n');
    return {
        hunks,
        patch: patchText,
        workdir: null
    };
}

/**
 * Checks the start and end lines of the patch text for `apply_patch`,
 * returning an error if they do not match the expected markers.
 */
function checkPatchBoundariesStrict(lines) {
    const firstLine = lines.length > 0 ? lines[0] : null;
    const lastLine = lines.length > 0 ? lines[lines.length - 1] : null;
    return checkStartAndEndLinesStrict(firstLine, lastLine);
}

/**
 * If we are in lenient mode, we check if the first line starts with `<<EOF`
 * (possibly quoted) and the last line ends with `EOF`. There must be at least
 * 4 lines total because the heredoc markers take up 2 lines and the patch text
 * must have at least 2 lines.
 *
 * If successful, returns the lines of the patch text that contain the patch
 * contents, excluding the heredoc markers.
 */
function checkPatchBoundariesLenient(originalLines, originalParseError) {
    if (originalLines.length >= 4) {
        const first = originalLines[0];
        const last = originalLines[originalLines.length - 1];
        
        if ((first === "<<EOF" || first === "<<'EOF'" || first === '<<"EOF"') &&
            last.endsWith("EOF")) {
            const innerLines = originalLines.slice(1, -1);
            try {
                checkPatchBoundariesStrict(innerLines);
                return innerLines;
            } catch (e) {
                throw e;
            }
        }
    }
    throw originalParseError;
}

function checkStartAndEndLinesStrict(firstLine, lastLine) {
    if (firstLine === BEGIN_PATCH_MARKER && lastLine === END_PATCH_MARKER) {
        return;
    }
    if (firstLine !== BEGIN_PATCH_MARKER) {
        throw new InvalidPatchError("The first line of the patch must be '*** Begin Patch'");
    }
    throw new InvalidPatchError("The last line of the patch must be '*** End Patch'");
}

/**
 * Attempts to parse a single hunk from the start of lines.
 * Returns the parsed hunk and the number of lines parsed (or a ParseError).
 */
function parseOneHunk(lines, lineNumber) {
    // Be tolerant of case mismatches and extra padding around marker strings.
    const firstLine = lines[0].trim();
    
    if (firstLine.startsWith(ADD_FILE_MARKER)) {
        // Add File
        const path = firstLine.substring(ADD_FILE_MARKER.length);
        let contents = '';
        let parsedLines = 1;
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('+')) {
                contents += line.substring(1) + '\n';
                parsedLines++;
            } else {
                break;
            }
        }
        
        return [{
            type: 'AddFile',
            path,
            contents
        }, parsedLines];
        
    } else if (firstLine.startsWith(DELETE_FILE_MARKER)) {
        // Delete File
        const path = firstLine.substring(DELETE_FILE_MARKER.length);
        return [{
            type: 'DeleteFile',
            path
        }, 1];
        
    } else if (firstLine.startsWith(UPDATE_FILE_MARKER)) {
        // Update File
        const path = firstLine.substring(UPDATE_FILE_MARKER.length);
        let remainingLines = lines.slice(1);
        let parsedLines = 1;
        
        // Optional: move file line
        let movePath = null;
        if (remainingLines.length > 0 && remainingLines[0].trim().startsWith(MOVE_TO_MARKER)) {
            movePath = remainingLines[0].trim().substring(MOVE_TO_MARKER.length);
            remainingLines = remainingLines.slice(1);
            parsedLines++;
        }
        
        const chunks = [];
        // NOTE: we need to know to stop once we reach the next special marker header.
        while (remainingLines.length > 0) {
            // Skip over any completely blank lines that may separate chunks.
            if (remainingLines[0].trim() === '') {
                parsedLines++;
                remainingLines = remainingLines.slice(1);
                continue;
            }
            
            if (remainingLines[0].startsWith('***')) {
                break;
            }
            
            const [chunk, chunkLines] = parseUpdateFileChunk(
                remainingLines, 
                lineNumber + parsedLines, 
                chunks.length === 0
            );
            chunks.push(chunk);
            parsedLines += chunkLines;
            remainingLines = remainingLines.slice(chunkLines);
        }
        
        if (chunks.length === 0) {
            throw new InvalidHunkError(`Update file hunk for path '${path}' is empty`, lineNumber);
        }
        
        return [{
            type: 'UpdateFile',
            path,
            move_path: movePath,
            chunks
        }, parsedLines];
    }
    
    throw new InvalidHunkError(
        `'${firstLine}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
        lineNumber
    );
}

function parseUpdateFileChunk(lines, lineNumber, allowMissingContext) {
    if (lines.length === 0) {
        throw new InvalidHunkError('Update hunk does not contain any lines', lineNumber);
    }
    
    // Parse multiple context markers (@@ statements) to support nested context
    // like @@ class BaseClass followed by @@ def method():
    let changeContext = null;
    let startIndex = 0;
    let contextParts = [];
    
    // Collect all consecutive @@ context markers
    while (startIndex < lines.length) {
        const line = lines[startIndex];
        
        if (line === EMPTY_CHANGE_CONTEXT_MARKER) {
            // Empty @@ marker, skip but don't add to context
            startIndex++;
        } else if (line.startsWith(CHANGE_CONTEXT_MARKER)) {
            // @@ with context, add to context parts
            const contextPart = line.substring(CHANGE_CONTEXT_MARKER.length).trim();
            if (contextPart) {
                contextParts.push(contextPart);
            }
            startIndex++;
        } else {
            // Not a context marker, stop collecting
            break;
        }
    }
    
    // If we found context parts, store them as an array for sequential matching
    if (contextParts.length > 0) {
        changeContext = contextParts.length === 1 ? contextParts[0] : contextParts;
    } else if (startIndex === 0 && !allowMissingContext) {
        // No context markers found and context is required
        throw new InvalidHunkError(
            `Expected update hunk to start with a @@ context marker, got: '${lines[0]}'`,
            lineNumber
        );
    }
    
    if (startIndex >= lines.length) {
        throw new InvalidHunkError('Update hunk does not contain any lines', lineNumber + 1);
    }
    
    const chunk = {
        change_context: changeContext,
        old_lines: [],
        new_lines: [],
        is_end_of_file: false
    };
    
    let parsedLines = 0;
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        
        if (line === EOF_MARKER) {
            if (parsedLines === 0) {
                throw new InvalidHunkError('Update hunk does not contain any lines', lineNumber + 1);
            }
            chunk.is_end_of_file = true;
            parsedLines++;
            break;
        }
        
        if (line.length === 0) {
            // Interpret this as an empty line.
            chunk.old_lines.push('');
            chunk.new_lines.push('');
        } else {
            const firstChar = line[0];
            switch (firstChar) {
                case ' ':
                    chunk.old_lines.push(line.substring(1));
                    chunk.new_lines.push(line.substring(1));
                    break;
                case '+':
                    chunk.new_lines.push(line.substring(1));
                    break;
                case '-':
                    chunk.old_lines.push(line.substring(1));
                    break;
                default:
                    if (parsedLines === 0) {
                        throw new InvalidHunkError(
                            `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
                            lineNumber + 1
                        );
                    }
                    // Assume this is the start of the next hunk.
                    return [chunk, parsedLines + startIndex];
            }
        }
        parsedLines++;
    }
    
    return [chunk, parsedLines + startIndex];
}

// Test functions (equivalent to Rust #[test] functions)
export function testParsePatch() {
    // Test bad input
    try {
        parsePatchText("bad", ParseMode.Strict);
        throw new Error("Expected InvalidPatchError");
    } catch (e) {
        if (!(e instanceof InvalidPatchError)) {
            throw new Error(`Expected InvalidPatchError, got ${e.constructor.name}`);
        }
        if (e.message !== "invalid patch: The first line of the patch must be '*** Begin Patch'") {
            throw new Error(`Unexpected error message: ${e.message}`);
        }
    }
    
    // Test missing end patch
    try {
        parsePatchText("*** Begin Patch\nbad", ParseMode.Strict);
        throw new Error("Expected InvalidPatchError");
    } catch (e) {
        if (!(e instanceof InvalidPatchError)) {
            throw new Error(`Expected InvalidPatchError, got ${e.constructor.name}`);
        }
        if (e.message !== "invalid patch: The last line of the patch must be '*** End Patch'") {
            throw new Error(`Unexpected error message: ${e.message}`);
        }
    }
    
    // Test empty update file hunk
    try {
        parsePatchText("*** Begin Patch\n*** Update File: test.py\n*** End Patch", ParseMode.Strict);
        throw new Error("Expected InvalidHunkError");
    } catch (e) {
        if (!(e instanceof InvalidHunkError)) {
            throw new Error(`Expected InvalidHunkError, got ${e.constructor.name}`);
        }
        if (!e.message.includes("Update file hunk for path 'test.py' is empty")) {
            throw new Error(`Unexpected error message: ${e.message}`);
        }
    }
    
    // Test empty patch (should work)
    const emptyResult = parsePatchText("*** Begin Patch\n*** End Patch", ParseMode.Strict);
    if (emptyResult.hunks.length !== 0) {
        throw new Error("Expected empty hunks array");
    }
    
    // Test complex patch with all hunk types
    const complexPatch = `*** Begin Patch
*** Add File: path/add.py
+abc
+def
*** Delete File: path/delete.py
*** Update File: path/update.py
*** Move to: path/update2.py
@@ def f():
-    pass
+    return 123
*** End Patch`;
    
    const complexResult = parsePatchText(complexPatch, ParseMode.Strict);
    if (complexResult.hunks.length !== 3) {
        throw new Error(`Expected 3 hunks, got ${complexResult.hunks.length}`);
    }
    
    // Verify AddFile hunk
    const addHunk = complexResult.hunks[0];
    if (addHunk.type !== 'AddFile' || addHunk.path !== 'path/add.py' || addHunk.contents !== 'abc\ndef\n') {
        throw new Error('AddFile hunk mismatch');
    }
    
    // Verify DeleteFile hunk
    const deleteHunk = complexResult.hunks[1];
    if (deleteHunk.type !== 'DeleteFile' || deleteHunk.path !== 'path/delete.py') {
        throw new Error('DeleteFile hunk mismatch');
    }
    
    // Verify UpdateFile hunk
    const updateHunk = complexResult.hunks[2];
    if (updateHunk.type !== 'UpdateFile' || updateHunk.path !== 'path/update.py' || 
        updateHunk.move_path !== 'path/update2.py' || updateHunk.chunks.length !== 1) {
        throw new Error('UpdateFile hunk mismatch');
    }
    
    const chunk = updateHunk.chunks[0];
    if (chunk.change_context !== 'def f():' || 
        JSON.stringify(chunk.old_lines) !== JSON.stringify(['    pass']) ||
        JSON.stringify(chunk.new_lines) !== JSON.stringify(['    return 123']) ||
        chunk.is_end_of_file !== false) {
        throw new Error('UpdateFile chunk mismatch');
    }
    
    // Test update hunk followed by another hunk (Add File)
    const multiHunkPatch = `*** Begin Patch
*** Update File: file.py
@@
+line
*** Add File: other.py
+content
*** End Patch`;
    
    const multiResult = parsePatchText(multiHunkPatch, ParseMode.Strict);
    if (multiResult.hunks.length !== 2) {
        throw new Error(`Expected 2 hunks, got ${multiResult.hunks.length}`);
    }
    
    // Test update hunk without explicit @@ header for first chunk
    const noHeaderPatch = `*** Begin Patch
*** Update File: file2.py
 import foo
+bar
*** End Patch`;
    
    const noHeaderResult = parsePatchText(noHeaderPatch, ParseMode.Strict);
    if (noHeaderResult.hunks.length !== 1) {
        throw new Error(`Expected 1 hunk, got ${noHeaderResult.hunks.length}`);
    }
    
    const noHeaderChunk = noHeaderResult.hunks[0].chunks[0];
    if (noHeaderChunk.change_context !== null ||
        JSON.stringify(noHeaderChunk.old_lines) !== JSON.stringify(['import foo']) ||
        JSON.stringify(noHeaderChunk.new_lines) !== JSON.stringify(['import foo', 'bar'])) {
        throw new Error('No header chunk mismatch');
    }
    
    console.log("testParsePatch passed");
}

export function testParsePatchLenient() {
    const patchText = `*** Begin Patch
*** Update File: file2.py
 import foo
+bar
*** End Patch`;
    
    const expectedHunks = [{
        type: 'UpdateFile',
        path: 'file2.py',
        move_path: null,
        chunks: [{
            change_context: null,
            old_lines: ['import foo'],
            new_lines: ['import foo', 'bar'],
            is_end_of_file: false
        }]
    }];
    
    const expectedError = new InvalidPatchError("The first line of the patch must be '*** Begin Patch'");
    
    // Test heredoc variants
    const patchTextInHeredoc = `<<EOF
${patchText}
EOF
`;
    
    try {
        parsePatchText(patchTextInHeredoc, ParseMode.Strict);
        throw new Error("Expected error in strict mode");
    } catch (e) {
        if (!(e instanceof InvalidPatchError)) {
            throw new Error(`Expected InvalidPatchError, got ${e.constructor.name}`);
        }
    }
    
    const lenientResult = parsePatchText(patchTextInHeredoc, ParseMode.Lenient);
    if (lenientResult.hunks.length !== 1 || lenientResult.hunks[0].type !== 'UpdateFile') {
        throw new Error('Lenient parsing failed');
    }
    
    // Test single quoted heredoc
    const patchTextInSingleQuotedHeredoc = `<<'EOF'
${patchText}
EOF
`;
    
    const singleQuotedResult = parsePatchText(patchTextInSingleQuotedHeredoc, ParseMode.Lenient);
    if (singleQuotedResult.hunks.length !== 1) {
        throw new Error('Single quoted heredoc parsing failed');
    }
    
    // Test double quoted heredoc
    const patchTextInDoubleQuotedHeredoc = `<<"EOF"
${patchText}
EOF
`;
    
    const doubleQuotedResult = parsePatchText(patchTextInDoubleQuotedHeredoc, ParseMode.Lenient);
    if (doubleQuotedResult.hunks.length !== 1) {
        throw new Error('Double quoted heredoc parsing failed');
    }
    
    console.log("testParsePatchLenient passed");
}

export function testParseOneHunk() {
    try {
        parseOneHunk(["bad"], 234);
        throw new Error("Expected InvalidHunkError");
    } catch (e) {
        if (!(e instanceof InvalidHunkError)) {
            throw new Error(`Expected InvalidHunkError, got ${e.constructor.name}`);
        }
        if (!e.message.includes("'bad' is not a valid hunk header")) {
            throw new Error(`Unexpected error message: ${e.message}`);
        }
        if (e.lineNumber !== 234) {
            throw new Error(`Expected line number 234, got ${e.lineNumber}`);
        }
    }
    
    console.log("testParseOneHunk passed");
}

export function testUpdateFileChunk() {
    // Test bad context marker
    try {
        parseUpdateFileChunk(["bad"], 123, false);
        throw new Error("Expected InvalidHunkError");
    } catch (e) {
        if (!(e instanceof InvalidHunkError)) {
            throw new Error(`Expected InvalidHunkError, got ${e.constructor.name}`);
        }
        if (!e.message.includes("Expected update hunk to start with a @@ context marker, got: 'bad'")) {
            throw new Error(`Unexpected error message: ${e.message}`);
        }
        if (e.lineNumber !== 123) {
            throw new Error(`Expected line number 123, got ${e.lineNumber}`);
        }
    }
    
    // Test empty chunk after @@
    try {
        parseUpdateFileChunk(["@@"], 123, false);
        throw new Error("Expected InvalidHunkError");
    } catch (e) {
        if (!(e instanceof InvalidHunkError)) {
            throw new Error(`Expected InvalidHunkError, got ${e.constructor.name}`);
        }
        if (!e.message.includes("Update hunk does not contain any lines")) {
            throw new Error(`Unexpected error message: ${e.message}`);
        }
        if (e.lineNumber !== 124) {
            throw new Error(`Expected line number 124, got ${e.lineNumber}`);
        }
    }
    
    // Test bad line format
    try {
        parseUpdateFileChunk(["@@", "bad"], 123, false);
        throw new Error("Expected InvalidHunkError");
    } catch (e) {
        if (!(e instanceof InvalidHunkError)) {
            throw new Error(`Expected InvalidHunkError, got ${e.constructor.name}`);
        }
        if (!e.message.includes("Unexpected line found in update hunk: 'bad'")) {
            throw new Error(`Unexpected error message: ${e.message}`);
        }
    }
    
    // Test EOF without content
    try {
        parseUpdateFileChunk(["@@", "*** End of File"], 123, false);
        throw new Error("Expected InvalidHunkError");
    } catch (e) {
        if (!(e instanceof InvalidHunkError)) {
            throw new Error(`Expected InvalidHunkError, got ${e.constructor.name}`);
        }
        if (!e.message.includes("Update hunk does not contain any lines")) {
            throw new Error(`Unexpected error message: ${e.message}`);
        }
    }
    
    // Test successful parsing with complex content
    const [chunk, parsedLines] = parseUpdateFileChunk([
        "@@ change_context",
        "",
        " context",
        "-remove",
        "+add",
        " context2",
        "*** End Patch"
    ], 123, false);
    
    if (chunk.change_context !== "change_context" ||
        JSON.stringify(chunk.old_lines) !== JSON.stringify(["", "context", "remove", "context2"]) ||
        JSON.stringify(chunk.new_lines) !== JSON.stringify(["", "context", "add", "context2"]) ||
        chunk.is_end_of_file !== false ||
        parsedLines !== 6) {
        throw new Error("Complex chunk parsing failed");
    }
    
    // Test EOF marker
    const [eofChunk, eofParsedLines] = parseUpdateFileChunk(["@@", "+line", "*** End of File"], 123, false);
    
    if (eofChunk.change_context !== null ||
        JSON.stringify(eofChunk.old_lines) !== JSON.stringify([]) ||
        JSON.stringify(eofChunk.new_lines) !== JSON.stringify(["line"]) ||
        eofChunk.is_end_of_file !== true ||
        eofParsedLines !== 3) {
        throw new Error("EOF chunk parsing failed");
    }
    
    console.log("testUpdateFileChunk passed");
}

// Run tests if this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testParsePatch();
    testParsePatchLenient();
    testParseOneHunk();
    testUpdateFileChunk();
    console.log("All parser tests passed!");
}
