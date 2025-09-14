import { applyPatch } from './lib.js';
import { readFileSync } from 'fs';

export function main() {
    const exitCode = runMain();
    process.exit(exitCode);
}

/**
 * We would prefer to return `process.ExitCode`, but its `exit_process()`
 * method is still a nightly API and we want main() to return !.
 */
export function runMain() {
    // Expect either one argument (the full apply_patch payload or a file path) or read it from stdin.
    const args = process.argv.slice(2); // Remove 'node' and script name
    
    let patchArg;
    
    if (args.length === 1) {
        const arg = args[0];
        // Check if the argument is a file path or patch content
        if (arg.startsWith('*** Begin Patch') || arg.includes('\n')) {
            // It's patch content directly
            patchArg = arg;
        } else {
            // It's likely a file path, try to read it
            try {
                patchArg = readFileSync(arg, 'utf8');
            } catch (err) {
                console.error(`Error: Failed to read patch file '${arg}'.\n${err.message}`);
                return 1;
            }
        }
    } else if (args.length === 0) {
        // No argument provided; attempt to read the patch from stdin.
        try {
            // For synchronous stdin reading in Node.js
            const buf = readFileSync(0, 'utf8'); // Read from stdin (fd 0)
            
            if (buf.length === 0) {
                console.error("Usage: apply_patch 'PATCH' or apply_patch <file.patch>\n       echo 'PATCH' | apply-patch");
                return 2;
            }
            patchArg = buf;
        } catch (err) {
            console.error(`Error: Failed to read PATCH from stdin.\n${err.message}`);
            return 1;
        }
    } else {
        // Refuse extra args to avoid ambiguity.
        console.error("Error: apply_patch accepts exactly one argument.");
        return 2;
    }

    try {
        applyPatch(patchArg, process.stdout, process.stderr);
        // Flush to ensure output ordering when used in pipelines.
        process.stdout.write('');
        return 0;
    } catch (err) {
        return 1;
    }
}
