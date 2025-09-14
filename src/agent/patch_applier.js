import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import settings from '../../settings.js';
import { applyPatch as applyPatchJS } from '../../apply-patch-js/src/lib.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PatchApplier {
    constructor(agent) {
        this.agent = agent;
        this.allowedWorkspaces = this.initializeWorkspaces(agent);
    }

    /**
     * Initialize workspace configuration with secure defaults
     */
    initializeWorkspaces(agent) {
        const configuredWorkspaces = settings.code_workspaces;
        const defaultWorkspaces = [
            `bots/${agent.name}/action-code`,
            `bots/${agent.name}/learned-skills`
        ];
        
        const workspaces = configuredWorkspaces && configuredWorkspaces.length > 0 
            ? configuredWorkspaces 
            : defaultWorkspaces;
            
        const resolvedWorkspaces = workspaces.map(ws => ws.replace('{BOT_NAME}', agent.name));
        console.log(`SECURITY: Bot ${agent.name} initialized with workspaces: ${resolvedWorkspaces.join(', ')}`);
        return resolvedWorkspaces;
    }

    /**
     * Validate file path is within allowed workspaces
     */
    validateWorkspacePath(filePath) {
        const normalizedPath = path.normalize(filePath);
        
        const isValid = this.allowedWorkspaces.some(workspace => {
            const workspacePath = path.normalize(workspace);
            return normalizedPath.startsWith(workspacePath);
        });
        
        if (!isValid) {
            console.warn(`SECURITY: Blocked file access outside workspace: ${filePath}`);
            console.warn(`SECURITY: Allowed workspaces: ${this.allowedWorkspaces.join(', ')}`);
        }
        
        return isValid;
    }

    /**
     * Extract file operations from patch content
     */
    extractFileOperations(patchContent) {
        const operations = [];
        const regex = /\*\*\* (Add|Update|Delete) File: (.+)/g;
        let match;
        
        while ((match = regex.exec(patchContent)) !== null) {
            operations.push({
                operation: match[1],
                path: match[2].trim()
            });
        }
        
        return operations;
    }

    /**
     * Validate all file paths in patch content
     */
    validatePatchWorkspaces(patchContent) {
        const fileOperations = this.extractFileOperations(patchContent);
        const invalidPaths = [];
        
        for (const op of fileOperations) {
            if (!this.validateWorkspacePath(op.path)) {
                invalidPaths.push(op.path);
            }
        }
        
        return {
            valid: invalidPaths.length === 0,
            invalidPaths: invalidPaths,
            operations: fileOperations
        };
    }

    /**
     * Apply a patch to modify existing code files
     * @param {string} patchContent - The patch content in the specified format
     * @param {string} workingDir - The directory to apply patches in
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async applyPatch(patchContent, workingDir) {
        try {
            // Mandatory workspace validation - cannot be bypassed
            const workspaceValidation = this.validatePatchWorkspaces(patchContent);
            if (!workspaceValidation.valid) {
                const errorMessage = `SECURITY VIOLATION: Attempted to access files outside allowed workspaces.\n` +
                    `Blocked paths: ${workspaceValidation.invalidPaths.join(', ')}\n` +
                    `Allowed workspaces: ${this.allowedWorkspaces.join(', ')}\n` +
                    `This operation has been blocked for security reasons.`;
                
                console.error(errorMessage);
                return {
                    success: false,
                    message: errorMessage,
                    operations: workspaceValidation.operations
                };
            }

            // Apply the patch using the JavaScript implementation
            const result = await this.runPatchToolJS(patchContent, workingDir);

            return {
                ...result,
                operations: workspaceValidation.operations
            };
        } catch (error) {
            console.error('Error applying patch:', error);
            return {
                success: false,
                message: `Patch application failed: ${error.message}`,
                operations: []
            };
        }
    }

    /**
     * Run the patch tool using the JavaScript implementation
     */
    async runPatchToolJS(patchContent, workingDir) {
        try {
            // Change to the working directory for the patch application
            const originalCwd = process.cwd();
            process.chdir(workingDir);
            
            try {
                // Apply the patch using the JavaScript implementation
                const result = await applyPatchJS(patchContent);
                
                return {
                    success: true,
                    message: result.message || 'Patch applied successfully'
                };
            } finally {
                // Always restore the original working directory
                process.chdir(originalCwd);
            }
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Patch application failed'
            };
        }
    }


    /**
     * Generate a patch instruction for AI to edit existing code
     * @param {string} filePath - Path to the file to be edited
     * @param {string} errorMessage - The error message to fix
     * @returns {string} - Instructions for AI to generate patch
     */
    generatePatchInstructions(filePath, errorMessage) {
        return `
PATCH EDITING MODE: You need to edit the existing file "${filePath}" to fix the following error:

ERROR: ${errorMessage}

Instead of generating a complete new file, generate a PATCH using the following format:

\`\`\`patch
*** Begin Patch
*** Update File: ${filePath}
@@
- [exact code lines to find and replace]
+ [new code lines to replace with]
*** End Patch
\`\`\`

IMPORTANT PATCH RULES:
1. Must start with "*** Begin Patch" and end with "*** End Patch"
2. Use "*** Update File: filepath" to specify the file to edit
3. Use "@@" to start a hunk (code change section)
4. Use "-" prefix for lines to remove
5. Use "+" prefix for lines to add
6. Include 3 lines of context before and after changes for unique identification
7. Use EXACT matching - the lines with "-" must match the existing code exactly

Example patch format:
\`\`\`patch
*** Begin Patch
*** Update File: src/example.js
@@
 function oldFunction() {
-    console.log("old code");
-    return false;
+    console.log("fixed code");
+    return true;
 }
*** End Patch
\`\`\`

Now generate a patch to fix the error in "${filePath}".
`;
    }

    /**
     * Extract patch content from AI response
     * @param {string} response - AI response containing patch
     * @returns {string|null} - Extracted patch content or null if not found
     */
    extractPatchFromResponse(response) {
        // First try to extract from code block
        const codeBlockMatch = response.match(/```patch\n([\s\S]*?)\n```/);
        if (codeBlockMatch) {
            return codeBlockMatch[1];
        }
        
        // If no code block, try to extract direct patch format
        const directPatchMatch = response.match(/\*\*\* Begin Patch([\s\S]*?)\*\*\* End Patch/);
        if (directPatchMatch) {
            return '*** Begin Patch' + directPatchMatch[1] + '*** End Patch';
        }
        
        return null;
    }

    /**
     * Check if response contains a patch
     * @param {string} response - AI response to check
     * @returns {boolean} - True if response contains patch
     */
    isPatchResponse(response) {
        // Check for patch with code block wrapper
        const hasCodeBlockPatch = response.includes('```patch') && response.includes('*** Begin Patch');
        
        // Check for patch without code block wrapper (direct patch format)
        const hasDirectPatch = response.includes('*** Begin Patch') && response.includes('*** End Patch');
        
        return hasCodeBlockPatch || hasDirectPatch;
    }

    /**
     * Track generated code files for patch editing
     * @param {string} filePath - Path to the generated code file
     * @param {string} code - The generated code content
     */
    trackGeneratedFile(filePath, code) {
        if (!this.generatedFiles) {
            this.generatedFiles = new Map();
        }
        this.generatedFiles.set(filePath, {
            content: code,
            timestamp: Date.now()
        });
    }

    /**
     * Get the last generated file path for patch editing
     * @returns {string|null} - Path to last generated file or null
     */
    getLastGeneratedFile() {
        if (!this.generatedFiles || this.generatedFiles.size === 0) {
            console.log('No generated files found');
            return null;
        }
        console.log('Generated files found: ' + this.generatedFiles.size);
        let lastFile = null;
        let lastTimestamp = 0;
        
        for (const [filePath, info] of this.generatedFiles.entries()) {
            if (info.timestamp > lastTimestamp) {
                lastTimestamp = info.timestamp;
                lastFile = filePath;
            }
        }
        console.log('Last generated file: ' + lastFile);
        
        return lastFile;
    }

    /**
     * Clear tracked files (call when starting new code generation)
     */
    clearTrackedFiles() {
        if (this.generatedFiles) {
            this.generatedFiles.clear();
        }
    }

    /**
     * Validate patch format
     * @param {string} patchContent - The patch content to validate
     * @returns {{valid: boolean, error?: string}} - Validation result
     */
    validatePatch(patchContent) {
        if (!patchContent) {
            return { valid: false, error: 'Empty patch content' };
        }

        if (!patchContent.includes('*** Begin Patch')) {
            return { valid: false, error: 'Missing "*** Begin Patch" header' };
        }

        if (!patchContent.includes('*** End Patch')) {
            return { valid: false, error: 'Missing "*** End Patch" footer' };
        }

        if (!patchContent.includes('*** Update File:') && !patchContent.includes('*** Add File:') && !patchContent.includes('*** Delete File:')) {
            return { valid: false, error: 'Missing file operation directive' };
        }

        return { valid: true };
    }
}
