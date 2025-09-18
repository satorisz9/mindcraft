import fs from 'fs';
import path from 'path';
import { readFile } from 'fs/promises';
import { makeCompartment } from '../src/agent/library/lockdown.js';
import * as skills from '../src/agent/library/skills.js';
import * as world from '../src/agent/library/world.js';
import { Vec3 } from 'vec3';
import { LintTool } from './lint.js';

/**
 * Execute Tool - Executes JavaScript code files in Minecraft bot context
 */
export class ExecuteTool {
    constructor(agent = null) {
        this.name = 'Execute';
        this.description = "Executes a JavaScript file containing bot actions in Minecraft.\n\nUsage:\n- The file_path parameter must be an absolute path to a .js file\n- The file should contain an async function that accepts a bot parameter\n- The function will be executed in the Minecraft bot context with access to skills and world APIs\n- Only files within allowed workspaces can be executed for security\n- The file must exist and be readable before execution";
        this.agent = agent;
        this.input_schema = {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The absolute path to the JavaScript file to execute (must be absolute, not relative)"
                },
                "executable_files": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "description": "Array of executable file paths to choose from (will find action-code files automatically)"
                },
                "description": {
                    "type": "string",
                    "description": "Optional description of what this execution should accomplish"
                }
            },
            "additionalProperties": false,
            "$schema": "http://json-schema.org/draft-07/schema#"
        };
    }

    /**
     * Get tool description
     * @returns {string} Tool description
     */
    getDescription() {
        return this.description;
    }

    /**
     * Get input schema
     * @returns {Object} Input schema
     */
    getInputSchema() {
        return this.input_schema;
    }

    /**
     * Execute JavaScript files - can handle single file or array of files
     * @param {Object} params - The execution parameters
     * @param {string|Array} params.file_path - Absolute path(s) to JavaScript file(s)
     * @param {Array} [params.executable_files] - Array of executable files to choose from
     * @param {string} [params.description] - Optional description
     * @returns {Object} Result object
     */
    async execute(params) {
        try {

            const { file_path, executable_files, description } = params;

            if (!this.agent || !this.agent.bot) {
                throw new Error('[Execute Tool] Agent with bot context is required for execution');
            }

            let targetFile = file_path;

            // If executable_files array is provided, find the main action-code file
            if (executable_files && Array.isArray(executable_files)) {

                if (executable_files.length === 0) {

                    return {
                        success: false,
                        message: 'No executable action-code files found - code generation may have failed',

                    };
                }

                // Find the main action-code file
                targetFile = executable_files.find(f => f.includes('action-code'));
                if (!targetFile) {
                    return {
                        success: false,
                        message: 'No executable action-code file found in provided files',

                    };
                }
            }
            // Validate required parameters
            if (!targetFile) {
                throw new Error('[Execute Tool] Missing required parameter: file_path or executable_files');
            }

            // Validate file path is absolute
            if (!path.isAbsolute(targetFile)) {
                throw new Error('[Execute Tool] file_path must be an absolute path');
            }

            // Check if file exists
            if (!fs.existsSync(targetFile)) {
                throw new Error(`[Execute Tool] File does not exist: ${targetFile}`);
            }

            // Validate file extension
            if (!targetFile.endsWith('.js')) {
                throw new Error('[Execute Tool] Only JavaScript (.js) files can be executed');
            }

            // Read file content
            const fileContent = await readFile(targetFile, 'utf8');
            
            // Basic validation - check if it looks like executable code
            if (!fileContent.trim()) {
                throw new Error('[Execute Tool] File is empty or contains no executable code');
            }

            // Lint the code before execution using registered tool
            const lintTool = this.agent.coder.codeToolsManager.tools.get('Lint');
            const lintResult = await lintTool.execute({ file_path: targetFile });

            if (!lintResult.success) {
                return lintResult;
            }
            
            // Create secure compartment for IIFE execution
            const compartment = makeCompartment({
                // Core JavaScript globals
                Promise,
                console,
                setTimeout,
                setInterval,
                clearTimeout,
                clearInterval,
                
                // Direct module access for IIFE format
                skills,
                world,
                Vec3,
                log: skills.log
            });

            // Execute IIFE format with enhanced error tracking

            const content = fileContent.trim();
            const isIIFE = content.match(/^\(async\s*\(\s*bot\s*\)\s*=>\s*\{[\s\S]*?\}\)$/m);
            
            if (!isIIFE) {
                throw new Error(`[Execute Tool] Unsupported code format. Only IIFE format is supported: (async (bot) => { ... })`);
            }
            
            // Create enhanced error tracking wrapper for IIFE
            const originalLines = content.split('\n');
            const enhancedWrapper = `
                (async function(bot) {
                    try {
                        const iifeFunction = ${content};
                        return await iifeFunction(bot);
                    } catch (error) {
                        // Enhanced error handling with source mapping
                        const enhancedError = new Error(error.message);
                        enhancedError.originalError = error;
                        enhancedError.sourceFile = '${targetFile}';
                        enhancedError.name = error.name || 'Error';
                        
                        // Map error line numbers to original file
                        if (error.stack) {
                            const stackLines = error.stack.split('\\n');
                            const mappedStack = stackLines.map(line => {
                                const lineMatch = line.match(/<anonymous>:(\\d+):(\\d+)/);
                                if (lineMatch) {
                                    const errorLine = parseInt(lineMatch[1]);
                                    const errorColumn = parseInt(lineMatch[2]);
                                    // Map to original file line (accounting for wrapper offset)
                                    const originalLine = Math.max(1, errorLine - 3);
                                    return line.replace(/<anonymous>:(\\d+)/, \`\${enhancedError.sourceFile}:\${originalLine}\`);
                                }
                                return line;
                            });
                            enhancedError.stack = mappedStack.join('\\n');
                        }
                        
                        throw enhancedError;
                    }
                })
            `;
            
     
            const wrappedFunction = compartment.evaluate(enhancedWrapper);
            
            // Create timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error('Code execution timeout: exceeded 60 seconds'));
                }, 60000);
            });
            
            // Race between execution and timeout
            const result = await Promise.race([
                wrappedFunction(this.agent.bot),
                timeoutPromise
            ]);
            
      
            // Get execution output summary
            const code_output = this.agent.actions ? this.agent.actions.getBotOutputSummary() : 'No output summary available';
           
            console.log("Bot connection status:", this.agent.bot?.entity?.position ? "Connected" : "Disconnected");
            console.log("Action manager status:", this.agent.actions ? "Available" : "Not available");

            const fileName = path.basename(targetFile);
            const botPosition = this.agent.bot?.entity?.position;
            
            // Format execution results elegantly
            const executionInfo = {
                file: fileName,
                description: description || 'Code execution',
                botPosition: botPosition ? `(${botPosition.x.toFixed(1)}, ${botPosition.y}, ${botPosition.z.toFixed(1)})` : 'Unknown',
                result: result || 'No return value',
                output: code_output
            };
            
            console.log(`Executed: ${executionInfo.file} - ${executionInfo.description}`);
            console.log(`Bot at: ${executionInfo.botPosition}`);
            console.log(`Output: ${executionInfo.output}`);
            
            const message = "## Code Execution Result ##\n" +
                "**File:** " + executionInfo.file + "\n" +
                "**Task:** " + executionInfo.description + "\n" +
                "**Bot Position:** " + executionInfo.botPosition + "\n" +
                "**Result:** " + executionInfo.result + "\n" +
                "**Log Output: May not be genuine.** \n" + executionInfo.output;
       
            return {
                success: true,
                message: message,
                file_path: targetFile,
                action: 'execute',

            };

        } catch (error) {

            
            // Convert error to string for consistent handling
            const err = error.toString();
            
            // Limit stack trace depth, keep only the first two useful stack frames
            let stackTrace = 'No stack trace available';
            if (error.stack) {
                const stackLines = error.stack.split('\n');
                // Keep error message and first two stack frames
                const relevantLines = stackLines.slice(0, 3); // Error message + 2 stack frames
                stackTrace = relevantLines.join('\n');
            }
            
            // Extract execution code error info with enhanced source mapping
            let codeErrorInfo = '';
            let errorLineContent = '';
            try {
                // Read the executed file content
                const fs = await import('fs');
                const originalFileContent = await fs.promises.readFile(params.file_path, 'utf8');
                const originalLines = originalFileContent.split('\n');
                
                // Enhanced error parsing with source mapping
                let errorLine = null;
                let errorColumn = null;
                let errorMessage = error.message;
                
                // Check if error has enhanced source mapping
                if (error.sourceFile && error.stack) {
                    const sourceMatch = error.stack.match(new RegExp(`${error.sourceFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)`));
                    if (sourceMatch) {
                        errorLine = parseInt(sourceMatch[1]);
                        errorColumn = parseInt(sourceMatch[2]);
                    }
                } else {
                    // Fallback to anonymous parsing with offset correction
                    const lineMatch = error.stack?.match(/<anonymous>:(\d+):(\d+)/);
                    if (lineMatch) {
                        const wrapperLine = parseInt(lineMatch[1]);
                        errorLine = Math.max(1, wrapperLine - 3); // Account for wrapper offset
                        errorColumn = parseInt(lineMatch[2]);
                    }
                }
                
                if (errorLine && errorColumn) {
                    // Get relevant code lines (current line and context)
                    const startLine = Math.max(0, errorLine - 2);
                    const endLine = Math.min(originalLines.length - 1, errorLine + 1);
                    
                    codeErrorInfo = '\n#### CODE EXECUTION ERROR INFO ###\n';
                    codeErrorInfo += `#ERROR 1\n`;
                    codeErrorInfo += `File: ${params.file_path}\n`;
                    codeErrorInfo += `ERROR MESSAGE: ${errorMessage}\n`;
                    codeErrorInfo += `ERROR LOCATION: Line ${errorLine}, Column ${errorColumn}\n`;
                    codeErrorInfo += `\nCode Context:\n`;
                    
                    // Display relevant code lines with enhanced formatting
                    for (let i = startLine; i <= endLine; i++) {
                        const lineNumber = i + 1;
                        const isErrorLine = lineNumber === errorLine;
                        const prefix = isErrorLine ? '>>> ' : '    ';
                        const line = originalLines[i] || '';
                        
                        // Store error line content for skill extraction
                        if (isErrorLine) {
                            errorLineContent = line;
                        }
                        
                        codeErrorInfo += `${prefix}${lineNumber.toString().padStart(3)}: ${line}\n`;
                        
                        // Add column indicator for error line
                        if (isErrorLine && errorColumn > 0) {
                            // Calculate exact spacing based on actual line format
                            const actualPrefix = `${prefix}${lineNumber.toString().padStart(3)}: `;
                            const spaces = ' '.repeat(actualPrefix.length + errorColumn - 1);
                            codeErrorInfo += `${spaces}^\n`;
                        }
                    }
                    
                    // Add error type information
                    if (error.name && error.name !== 'Error') {
                        codeErrorInfo += `\nError Type: ${error.name}\n`;
                    }
                } else {
                    codeErrorInfo = `\n#### CODE EXECUTION ERROR INFO ###\nError: ${errorMessage}\nUnable to map error to source location\n`;
                    errorLineContent = '';
                }
            } catch (readError) {
                // If unable to read file, use basic error info
                codeErrorInfo = `\n#### CODE EXECUTION ERROR INFO ###\nUnable to extract code context: ${readError.message}`;
                errorLineContent = '';
            }
            
            // Extract skills/world functions from error message for intelligent suggestions
            const skillSuggestions = await this.agent.prompter.skill_libary.getRelevantSkillDocs(errorLineContent, 2) + '\n';
            
            // Check if this is a timeout error
            const isTimeoutError = error.message && error.message.includes('Code execution timeout');
            
            let message;
            if (isTimeoutError) {
                message = 
                    '## Code Execution Timeout ##\n' +
                    '**Error:** Code execution exceeded 60 seconds and was terminated\n' +
                    '**Reason:** The code took too long to execute and may have been stuck in an infinite loop, waiting for a resource, or the bot may be stuck in terrain\n' +
                    '**Suggestion:** Review the code for potential infinite loops, long-running operations, or blocking calls\n';
            } else {
                message = 
                    '## Code Execution Error ##\n' +
                    `**Error:** ${error.message}\n` +
                    codeErrorInfo + 
                    skillSuggestions;
            }
                            
            return {
                success: false,
                message: message
            };
        }
    }

    // /**
    //  * Generate intelligent skill suggestions based on error information
    //  * @param {string} errorLineContent - Content of the error line
    //  * @returns {Promise<string>} Formatted skill suggestions
    //  */
    // async _generateSkillSuggestions(errorLineContent) {
    //     try {
    //         // Extract skills/world functions directly from the error line content
    //         if (!errorLineContent) {
    //             return '';
    //         }
            
    //         const skillMatches = errorLineContent.match(/(?:skills|world)\.(\w+)/g);
            
    //         if (!skillMatches || !this.agent.prompter?.skill_libary) {
    //             return '';
    //         }

    //         const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
    //         const uniqueSkills = [...new Set(skillMatches)];
            
    //         const suggestions = [];
    //         for (const skillCall of uniqueSkills) {
    //             // Find matching documentation
    //             const matchingDocs = allDocs.filter(doc => 
    //                 doc.toLowerCase().includes(skillCall.toLowerCase())
    //             );
                
    //             if (matchingDocs.length > 0) {
    //                 suggestions.push(`\n### ${skillCall} Documentation ###`);
    //                 matchingDocs.forEach(doc => {
    //                     // Extract first few lines of documentation
    //                     const lines = doc.split('\n').slice(0, 5);
    //                     suggestions.push(lines.join('\n'));
    //                 });
    //             }
    //         }
            
    //         return suggestions.length > 0 ? '\n\n## SKILL USAGE HELP ##' + suggestions.join('\n') : '';
    //     } catch (suggestionError) {
    //         // Ignore errors in suggestion generation
    //         console.log('Skill suggestion error:', suggestionError.message);
    //         return '';
    //     }
    // }
}

export default ExecuteTool;
