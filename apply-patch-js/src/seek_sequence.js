/**
 * Attempt to find the sequence of `pattern` lines within `lines` beginning at or after `start`.
 * Returns the starting index of the match or `null` if not found. Matches are attempted with
 * decreasing strictness: exact match, then ignoring trailing whitespace, then ignoring leading
 * and trailing whitespace. When `eof` is true, we first try starting at the end-of-file (so that
 * patterns intended to match file endings are applied at the end), and fall back to searching
 * from `start` if needed.
 *
 * Special cases handled defensively:
 *  • Empty `pattern` → returns `start` (no-op match)
 *  • `pattern.length > lines.length` → returns `null` (cannot match, avoids
 *    out‑of‑bounds panic that occurred pre‑2025‑04‑12)
 */
export function seekSequence(lines, pattern, start, eof) {
    if (pattern.length === 0) {
        return start;
    }

    // When the pattern is longer than the available input there is no possible
    // match. Early‑return to avoid the out‑of‑bounds slice that would occur in
    // the search loops below (previously caused a panic when
    // `pattern.length > lines.length`).
    if (pattern.length > lines.length) {
        return null;
    }
    
    const searchStart = (eof && lines.length >= pattern.length) 
        ? lines.length - pattern.length 
        : start;
    
    // Helper function to perform a search with a given comparison function
    function searchWithComparison(compareFunc) {
        if (eof && searchStart > start) {
            // In EOF mode, search backwards from the end to find the last occurrence
            for (let i = lines.length - pattern.length; i >= start; i--) {
                let match = true;
                for (let j = 0; j < pattern.length; j++) {
                    if (!compareFunc(lines[i + j], pattern[j])) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    return i;
                }
            }
        } else {
            // Normal forward search
            for (let i = searchStart; i <= lines.length - pattern.length; i++) {
                let match = true;
                for (let j = 0; j < pattern.length; j++) {
                    if (!compareFunc(lines[i + j], pattern[j])) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    return i;
                }
            }
        }
        
        return null;
    }
    
    // Exact match first.
    let result = searchWithComparison((a, b) => a === b);
    if (result !== null) return result;
    
    // Then rstrip match.
    result = searchWithComparison((a, b) => a.trimEnd() === b.trimEnd());
    if (result !== null) return result;
    
    // Finally, trim both sides to allow more lenience.
    result = searchWithComparison((a, b) => a.trim() === b.trim());
    if (result !== null) return result;

    // ------------------------------------------------------------------
    // Final, most permissive pass – attempt to match after *normalising*
    // common Unicode punctuation to their ASCII equivalents so that diffs
    // authored with plain ASCII characters can still be applied to source
    // files that contain typographic dashes / quotes, etc.  This mirrors the
    // fuzzy behaviour of `git apply` which ignores minor byte-level
    // differences when locating context lines.
    // ------------------------------------------------------------------

    function normalise(s) {
        return s.trim()
            .split('')
            .map(c => {
                switch (c) {
                    // Various dash / hyphen code-points → ASCII '-'
                    case '\u2010': // HYPHEN
                    case '\u2011': // NON-BREAKING HYPHEN
                    case '\u2012': // FIGURE DASH
                    case '\u2013': // EN DASH
                    case '\u2014': // EM DASH
                    case '\u2015': // HORIZONTAL BAR
                    case '\u2212': // MINUS SIGN
                        return '-';
                    // Fancy single quotes → '\''
                    case '\u2018': // LEFT SINGLE QUOTATION MARK
                    case '\u2019': // RIGHT SINGLE QUOTATION MARK
                    case '\u201A': // SINGLE LOW-9 QUOTATION MARK
                    case '\u201B': // SINGLE HIGH-REVERSED-9 QUOTATION MARK
                        return "'";
                    // Fancy double quotes → '"'
                    case '\u201C': // LEFT DOUBLE QUOTATION MARK
                    case '\u201D': // RIGHT DOUBLE QUOTATION MARK
                    case '\u201E': // DOUBLE LOW-9 QUOTATION MARK
                    case '\u201F': // DOUBLE HIGH-REVERSED-9 QUOTATION MARK
                        return '"';
                    // Non-breaking space and other odd spaces → normal space
                    case '\u00A0': // NON-BREAKING SPACE
                    case '\u2002': // EN SPACE
                    case '\u2003': // EM SPACE
                    case '\u2004': // THREE-PER-EM SPACE
                    case '\u2005': // FOUR-PER-EM SPACE
                    case '\u2006': // SIX-PER-EM SPACE
                    case '\u2007': // FIGURE SPACE
                    case '\u2008': // PUNCTUATION SPACE
                    case '\u2009': // THIN SPACE
                    case '\u200A': // HAIR SPACE
                    case '\u202F': // NARROW NO-BREAK SPACE
                    case '\u205F': // MEDIUM MATHEMATICAL SPACE
                    case '\u3000': // IDEOGRAPHIC SPACE
                        return ' ';
                    default:
                        return c;
                }
            })
            .join('');
    }

    result = searchWithComparison((a, b) => normalise(a) === normalise(b));
    return result;
}

// Test functions (equivalent to Rust #[test] functions)
function toVec(strings) {
    return strings.slice(); // Create a copy
}

export function testExactMatchFindsSequence() {
    const lines = toVec(["foo", "bar", "baz"]);
    const pattern = toVec(["bar", "baz"]);
    const result = seekSequence(lines, pattern, 0, false);
    if (result !== 1) {
        throw new Error(`Expected 1, got ${result}`);
    }
    console.log("testExactMatchFindsSequence passed");
}

export function testRstripMatchIgnoresTrailingWhitespace() {
    const lines = toVec(["foo   ", "bar\t\t"]);
    // Pattern omits trailing whitespace.
    const pattern = toVec(["foo", "bar"]);
    const result = seekSequence(lines, pattern, 0, false);
    if (result !== 0) {
        throw new Error(`Expected 0, got ${result}`);
    }
    console.log("testRstripMatchIgnoresTrailingWhitespace passed");
}

export function testTrimMatchIgnoresLeadingAndTrailingWhitespace() {
    const lines = toVec(["    foo   ", "   bar\t"]);
    // Pattern omits any additional whitespace.
    const pattern = toVec(["foo", "bar"]);
    const result = seekSequence(lines, pattern, 0, false);
    if (result !== 0) {
        throw new Error(`Expected 0, got ${result}`);
    }
    console.log("testTrimMatchIgnoresLeadingAndTrailingWhitespace passed");
}

export function testPatternLongerThanInputReturnsNull() {
    const lines = toVec(["just one line"]);
    const pattern = toVec(["too", "many", "lines"]);
    // Should not panic – must return null when pattern cannot possibly fit.
    const result = seekSequence(lines, pattern, 0, false);
    if (result !== null) {
        throw new Error(`Expected null, got ${result}`);
    }
    console.log("testPatternLongerThanInputReturnsNull passed");
}

export function testEmptyPatternReturnsStart() {
    const lines = toVec(["foo", "bar"]);
    const pattern = toVec([]);
    const result = seekSequence(lines, pattern, 5, false);
    if (result !== 5) {
        throw new Error(`Expected 5, got ${result}`);
    }
    console.log("testEmptyPatternReturnsStart passed");
}

export function testEofModeSearchesFromEnd() {
    const lines = toVec(["foo", "bar", "baz", "bar", "qux"]);
    const pattern = toVec(["bar"]);
    
    // Normal search finds first occurrence
    const normalResult = seekSequence(lines, pattern, 0, false);
    if (normalResult !== 1) {
        throw new Error(`Expected 1, got ${normalResult}`);
    }
    
    // EOF search finds last occurrence
    const eofResult = seekSequence(lines, pattern, 0, true);
    if (eofResult !== 3) {
        throw new Error(`Expected 3, got ${eofResult}`);
    }
    
    console.log("testEofModeSearchesFromEnd passed");
}

export function testUnicodeNormalization() {
    // Test with EN DASH and NON-BREAKING HYPHEN
    const lines = toVec(["import asyncio  # local import \u2013 avoids top\u2011level dep"]);
    const pattern = toVec(["import asyncio  # local import - avoids top-level dep"]);
    
    const result = seekSequence(lines, pattern, 0, false);
    if (result !== 0) {
        throw new Error(`Expected 0, got ${result}`);
    }
    
    console.log("testUnicodeNormalization passed");
}

export function testFancyQuotesNormalization() {
    // Test with fancy quotes
    const lines = toVec(["const msg = \u201CHello World\u201D;"]);
    const pattern = toVec(["const msg = \"Hello World\";"]);
    
    const result = seekSequence(lines, pattern, 0, false);
    if (result !== 0) {
        throw new Error(`Expected 0, got ${result}`);
    }
    
    console.log("testFancyQuotesNormalization passed");
}

export function testNonBreakingSpaceNormalization() {
    // Test with non-breaking space
    const lines = toVec(["function\u00A0test() {"]);
    const pattern = toVec(["function test() {"]);
    
    const result = seekSequence(lines, pattern, 0, false);
    if (result !== 0) {
        throw new Error(`Expected 0, got ${result}`);
    }
    
    console.log("testNonBreakingSpaceNormalization passed");
}

// Run tests if this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testExactMatchFindsSequence();
    testRstripMatchIgnoresTrailingWhitespace();
    testTrimMatchIgnoresLeadingAndTrailingWhitespace();
    testPatternLongerThanInputReturnsNull();
    testEmptyPatternReturnsStart();
    testEofModeSearchesFromEnd();
    testUnicodeNormalization();
    testFancyQuotesNormalization();
    testNonBreakingSpaceNormalization();
    console.log("All seek_sequence tests passed!");
}
