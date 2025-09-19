import fs from 'fs';
import path from 'path';
import { readFile } from 'fs/promises';
import { makeCompartment } from '../src/agent/library/lockdown.js';
import * as skills from '../src/agent/library/skills.js';
import * as world from '../src/agent/library/world.js';
import { Vec3 } from 'vec3';
import { LintTool } from './lint.js';
import { LearnedSkillsManager } from '../src/agent/library/learnedSkillsManager.js';

/**
 * Execute Tool - Executes JavaScript code files in Minecraft bot context
 */
export class ExecuteTool {
    constructor(agent = null) {
        this.name = 'Execute';
        this.description = "Executes a JavaScript file containing bot actions in Minecraft.\n\nUsage:\n- The file_path parameter must be an absolute path to a .js file\n- The file should contain an async function that accepts a bot parameter\n- The function will be executed in the Minecraft bot context with access to skills, world APIs, and learned skills\n- Only files within allowed workspaces can be executed for security\n- The file must exist and be readable before execution";
        this.agent = agent;
        this.learnedSkillsManager = new LearnedSkillsManager();
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
        let originalChat = null;
        
        try {
            // Step 1: Validate and extract target file
            const targetFile = this._validateAndExtractTargetFile(params);
            
            // Validate and prepare file for execution
            const fileContent = await this._validateAndPrepareFile(targetFile);
            
            // Setup execution environment
            originalChat = this._setupChatCapture();
            const compartment = await this._createSecureCompartment();
            
            // Execute the code with timeout and error handling
            const result = await this._executeCodeWithTimeout(compartment, fileContent, targetFile);
            
            // Format and return success result
            return this._formatSuccessResult(result, targetFile, params.description);
            
        } catch (error) {
            // Handle execution errors with detailed reporting
            return await this._handleExecutionError(error, params, originalChat);
        } finally {
            // Always restore original chat function
            if (originalChat && this.agent.bot) {
                this.agent.bot.chat = originalChat;
            }
        }
    }

    /**
     * Validate agent and extract target file path
     * @param {Object} params - Execution parameters
     * @returns {string} Target file path
     */
    _validateAndExtractTargetFile(params) {
        const { file_path, executable_files } = params;

        if (!this.agent || !this.agent.bot) {
            throw new Error('[Execute Tool] Agent with bot context is required for execution');
        }

        let targetFile = file_path;

        // If executable_files array is provided, find the main action-code file
        if (executable_files && Array.isArray(executable_files)) {
            if (executable_files.length === 0) {
                throw new Error('No executable action-code files found - code generation may have failed');
            }

            // Find the main action-code file
            targetFile = executable_files.find(f => f.includes('action-code'));
            if (!targetFile) {
                throw new Error('No executable action-code file found in provided files');
            }
        }

        // Validate required parameters
        if (!targetFile) {
            throw new Error('[Execute Tool] Missing required parameter: file_path or executable_files');
        }

        return targetFile;
    }

    /**
     * Validate and prepare file for execution
     * @param {string} targetFile - Target file path
     * @returns {string} File content
     */
    async _validateAndPrepareFile(targetFile) {
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
            throw new Error(lintResult.message);
        }

        return fileContent;
    }

    /**
     * Setup chat message capture
     * @returns {Function} Original chat function
     */
    _setupChatCapture() {
        let originalChat = null;
        
        // Store original chat function
        if (this.agent.bot && this.agent.bot.chat) {
            originalChat = this.agent.bot.chat;
        }
        
        // Wrap bot.chat to capture messages
        this.agent.bot.chat = (message) => {
            this.agent.bot.output += `[CHAT] ${message}\n`;
            return originalChat.call(this.agent.bot, message);
        };

        return originalChat;
    }

    /**
     * Create secure compartment for code execution
     * @returns {Object} Compartment object
     */
    async _createSecureCompartment() {
        // Create secure compartment for IIFE execution
        const compartment = makeCompartment({
            // Core JavaScript globals (CRITICAL - these were missing!)
            Promise,
            console,
            setTimeout,
            setInterval,
            clearTimeout,
            clearInterval,
            
            // Spread world functions into global scope
            ...world,
            
            // Core skills access - spread all skills functions into global scope
            ...skills,
            
            // Make Vec3 globally available
            Vec3,
            
            // Make log globally available
            log: skills.log,
            
            // Also provide object references for backward compatibility
            world: world,
            skills: skills
        });
        
        // Load learned skills and execute them in the same compartment context
        const learnedSkills = await this._loadLearnedSkillsInCompartment(compartment);
        
        // Add learned skills to compartment
        compartment.globalThis.learnedSkills = learnedSkills;
        
        return compartment;
    }

    /**
     * Load learned skills as file-level modules in compartment
     * @param {Object} compartment - The secure compartment
     * @returns {Object} Learned skills object
     */
    async _loadLearnedSkillsInCompartment(compartment) {
        const learnedSkills = {};
        
        try {
            const skillModules = await this.learnedSkillsManager.getLearnedSkillsForBot(this.agent.name);
            
            for (const module of skillModules) {
                try {
                    // Transform ES module export to function declaration and wrap in IIFE
                    const transformedContent = module.content.replace(/export\s+async\s+function\s+(\w+)/g, 'async function $1');
                    
                    // Execute the transformed content with inline source mapping
                    // Use inline sourceURL comment for proper error stack traces
                    const codeWithSourceMap = `${transformedContent}
// Make function available globally
globalThis.${module.functionName} = ${module.functionName};
//# sourceURL=${module.filePath}`;
                    
                    // console.log(`Loading skill with sourceURL: ${module.filePath}`);
                    compartment.evaluate(codeWithSourceMap);
                    
                    // Get the function from the compartment's global scope
                    const moduleFunction = compartment.globalThis[module.functionName];
                    
                    if (typeof moduleFunction === 'function') {
                        learnedSkills[module.functionName] = moduleFunction;
                        // console.log(`Successfully loaded skill: ${module.functionName}`);
                    } else {
                        console.warn(`Function ${module.functionName} not found in module ${module.filePath}`);
                        console.warn(`Available functions in compartment:`, Object.keys(compartment.globalThis).filter(key => typeof compartment.globalThis[key] === 'function'));
                    }
                    
                } catch (error) {
                    console.warn(`Failed to load skill module ${module.functionName}: ${error.message}`);
                }
            }
        } catch (error) {
            console.log(`Failed to load learned skills: ${error.message}`);
        }
        
        return learnedSkills;
    }

    /**
     * Execute code with timeout and error handling
     * @param {Object} compartment - Secure compartment for execution
     * @param {string} fileContent - File content to execute
     * @param {string} targetFile - Target file path for error mapping
     * @returns {*} Execution result
     */
    async _executeCodeWithTimeout(compartment, fileContent, targetFile) {
        // Validate IIFE format
        const content = fileContent.trim();
        const isIIFE = content.match(/^\(async\s*\(\s*bot\s*\)\s*=>\s*\{[\s\S]*?\}\)$/m);
        
        if (!isIIFE) {
            throw new Error(`[Execute Tool] Unsupported code format. Only IIFE format is supported: (async (bot) => { ... })`);
        }
        
        // Create enhanced error tracking wrapper for IIFE
        const enhancedWrapper = `
            (async function(bot) {
                try {
                    const iifeFunction = ${content};
                    return await iifeFunction(bot);
                } catch (error) {
                    // Preserve original error with enhanced source mapping
                    error.sourceFile = '${targetFile}';
                    
                    // Map error line numbers to original file while preserving stack
                    if (error.stack) {
                        const stackLines = error.stack.split('\\n');
                        const mappedStack = stackLines.map(line => {
                            const lineMatch = line.match(/<anonymous>:(\\d+):(\\d+)/);
                            if (lineMatch) {
                                const errorLine = parseInt(lineMatch[1]);
                                const errorColumn = parseInt(lineMatch[2]);
                                // Map to original file line (accounting for wrapper offset)
                                const originalLine = Math.max(1, errorLine - 3);
                                return line.replace(/<anonymous>:(\\d+)/, \`\${error.sourceFile}:\${originalLine}\`);
                            }
                            return line;
                        });
                        error.stack = mappedStack.join('\\n');
                    }
                    
                    // Re-throw original error with enhanced stack info
                    throw error;
                }
            })
        `;
        
        const wrappedFunction = compartment.evaluate(enhancedWrapper);
        
        // Create AbortController for cancellation
        const abortController = new AbortController();
        let timeoutId;
        
        // Create timeout promise that aborts execution
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                abortController.abort();
                reject(new Error('Code execution timeout: exceeded 60 seconds'));
            }, 60000);
        });
        
        let result;
        try {
            // Race between execution and timeout
            result = await Promise.race([
                wrappedFunction(this.agent.bot),
                timeoutPromise
            ]);
            
            // Clear timeout if execution completes first
            clearTimeout(timeoutId);
            
            // Reset interrupt flag after successful execution
            if (this.agent.bot) {
                this.agent.bot.interrupt_code = false;
            }
            
            return result;
            
        } catch (error) {
            // Clear timeout on any error
            clearTimeout(timeoutId);
            
            // If execution was aborted, try to stop bot actions
            if (abortController.signal.aborted) {
                this._stopBotActions();
            }
            
            throw error;
        }
    }

    /**
     * Stop all bot actions when execution is aborted
     */
    _stopBotActions() {
        console.log('Code execution was aborted due to timeout, attempting to stop bot actions...');
        
        if (this.agent.bot) {
            try {
                // Stop all movement and control states
                this.agent.bot.clearControlStates();
                
                // Stop pathfinding
                if (this.agent.bot.pathfinder) {
                    this.agent.bot.pathfinder.stop();
                }
                
                // Stop digging
                this.agent.bot.stopDigging();
                
                // Stop PvP actions
                if (this.agent.bot.pvp) {
                    this.agent.bot.pvp.stop();
                }
                
                // Cancel collect block tasks
                if (this.agent.bot.collectBlock) {
                    this.agent.bot.collectBlock.cancelTask();
                }
                
                // Set interrupt flag
                this.agent.bot.interrupt_code = true;
                
                console.log('Successfully stopped all bot actions');
            } catch (stopError) {
                console.warn('Failed to stop bot actions:', stopError.message);
            }
        }
    }

    /**
     * Format successful execution result
     * @param {*} result - Execution result
     * @param {string} targetFile - Target file path
     * @param {string} description - Execution description
     * @returns {Object} Formatted result object
     */
    _formatSuccessResult(result, targetFile, description) {
        // Capture all execution output including log and chat
        const executionOutput = this._captureExecutionOutput();
        
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
            output: executionOutput
        };
        
        console.log(`Executed: ${executionInfo.file} - ${executionInfo.description}`);
        console.log(`Bot at: ${executionInfo.botPosition}`);
        console.log(`Output: ${executionInfo.output}`);
        
        const message = "## Code Execution Result ##\n" +
            "**File:** " + executionInfo.file + "\n" +
            "**Task:** " + executionInfo.description + "\n" +
            "**Your Position:** " + executionInfo.botPosition + "\n" +
            "**Result:** " + executionInfo.result + "\n" +
            "**Execution Log:** \n" + executionInfo.output;
   
        return {
            success: true,
            message: message,
            file_path: targetFile,
            action: 'execute'
        };
    }

    /**
     * Capture execution output from bot.output (includes both log and chat)
     * @returns {string} Formatted execution output
     */
    _captureExecutionOutput() {
        let executionOutput = 'No output captured during execution';
        
        if (this.agent.bot && this.agent.bot.output) {
            const output = this.agent.bot.output.trim();
            if (output) {
                executionOutput = output;
                // Clear the output after capturing it
                this.agent.bot.output = '';
            }
        }
        
        return executionOutput;
    }

    /**
     * Handle execution errors with detailed reporting
     * @param {Error} error - The error that occurred
     * @param {Object} params - Original execution parameters
     * @param {Function} originalChat - Original chat function to restore
     * @returns {Object} Error result object
     */
    async _handleExecutionError(error, params, originalChat) {
        // Restore original bot.chat function in case of error during setup
        if (this.agent.bot && this.agent.bot.chat && typeof originalChat === 'function') {
            this.agent.bot.chat = originalChat;
        }
        
        // Capture execution output even when there's an error
        const executionOutput = this._captureExecutionOutput();
        
        // Extract detailed error information
        const codeErrorInfo = await this._extractCodeErrorInfo(error, params);
        
        // Check if this is a timeout error
        const isTimeoutError = error.message && error.message.includes('Code execution timeout');
        
        let message;
        if (isTimeoutError) {
            message = 
                '## Code Execution Timeout ##\n' +
                '**Error:** Code execution exceeded 60 seconds and was terminated\n' +
                '**Reason:** The code took too long to execute and may have been stuck in an infinite loop, waiting for a resource, or the bot may be stuck in terrain\n' +
                '**Suggestion:** Review the code for potential infinite loops, long-running operations, or blocking calls\n' +
                '**Execution Log:** \n' + executionOutput;
        } else {
            message = 
                '## Code Execution Error ##\n' +
                `**Error:** ${error.message}\n` +
                codeErrorInfo.errorReport + 
                codeErrorInfo.skillSuggestions +
                '\n**Execution Log:** \n' + executionOutput;
        }
                        
        return {
            success: false,
            message: message
        };
    }

    /**
     * Extract detailed code error information with enhanced stack processing
     * @param {Error} error - The error that occurred
     * @param {Object} params - Original execution parameters
     * @returns {Object} Error information object
     */
    async _extractCodeErrorInfo(error, params) {
        let codeErrorInfo = '';
        let errorLineContent = '';
        
        try {
            // Read the executed file content
            const fs = await import('fs');
            const originalFileContent = await fs.promises.readFile(params.file_path, 'utf8');
            const originalLines = originalFileContent.split('\n');
            
            // Enhanced error stack processing with comprehensive filtering
            const errorMessage = error.message;
            const userCodePaths = ['action-code', 'learned-skills'];
            let allUserErrors = [];
            
            if (error.stack) {
                const stackLines = error.stack.split('\n');
                
                // Process stack frames from bottom to top to find the root cause
                const stackFrames = [];
                
                // First pass: collect all stack frames with user code
                for (let i = 0; i < stackLines.length; i++) {
                    const line = stackLines[i];
                    
                    // Skip error message line and empty lines
                    if (i === 0 || !line.trim()) continue;
                    
                    // Check for user code paths (action-code or learned-skills)
                    const isUserCodePath = userCodePaths.some(path => line.includes(path));
                    
                    // Also check for source file mapping from our wrapper
                    const hasSourceFile = error.sourceFile && line.includes(error.sourceFile);
                    
                    if (isUserCodePath || hasSourceFile) {
                        // Extract line and column information
                        let errorLine = null;
                        let errorColumn = null;
                        let filePath = params.file_path;
                        
                        if (hasSourceFile) {
                            // Use enhanced source mapping
                            const sourceMatch = line.match(new RegExp(`${error.sourceFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)`));
                            if (sourceMatch) {
                                errorLine = parseInt(sourceMatch[1]);
                                errorColumn = parseInt(sourceMatch[2]);
                            }
                        } else {
                            // Extract from file path in stack trace - handle both regular paths and sourceURL paths
                            let pathMatch = line.match(/at.*?\(([^)]+\.(js|ts)):(\d+):(\d+)\)/);
                            if (!pathMatch) {
                                pathMatch = line.match(/at.*?([^\s]+\.(js|ts)):(\d+):(\d+)/);
                            }
                            if (pathMatch) {
                                filePath = pathMatch[1];
                                errorLine = parseInt(pathMatch[3]);
                                errorColumn = parseInt(pathMatch[4]);
                                
                                // Debug: log the extracted file path
                                console.log(`Extracted file path from stack: ${filePath}`);
                            }
                        }
                        
                        if (errorLine && filePath) {
                            try {
                                const fileContent = await fs.promises.readFile(filePath, 'utf8');
                                const fileLines = fileContent.split('\n');
                                const errorLineContent = fileLines[errorLine - 1];
                                
                                stackFrames.push({
                                    filePath,
                                    errorLine,
                                    errorColumn,
                                    stackFrame: line.trim(),
                                    lineContent: errorLineContent,
                                    isActionCode: filePath.includes('action-code'),
                                    isLearnedSkill: filePath.includes('learned-skills'),
                                    isThrowStatement: this._isThrowStatement(errorLineContent),
                                    stackIndex: i
                                });
                            } catch (readError) {
                                stackFrames.push({
                                    filePath,
                                    errorLine,
                                    errorColumn,
                                    stackFrame: line.trim(),
                                    lineContent: '',
                                    isActionCode: filePath.includes('action-code'),
                                    isLearnedSkill: filePath.includes('learned-skills'),
                                    isThrowStatement: false,
                                    stackIndex: i
                                });
                            }
                        }
                    }
                }
                
                // Second pass: analyze stack frames from deepest to shallowest to find root cause
                const rootCauseFrames = [];
                const throwFrames = [];
                
                // Separate throw statements from actual error locations
                for (const frame of stackFrames) {
                    if (frame.isThrowStatement) {
                        throwFrames.push(frame);
                    } else {
                        rootCauseFrames.push(frame);
                    }
                }
                
                // Prioritize root cause frames, but include throw frames if no root cause found
                if (rootCauseFrames.length > 0) {
                    // Sort root cause frames by stack depth (deeper first) to show the original error
                    rootCauseFrames.sort((a, b) => b.stackIndex - a.stackIndex);
                    allUserErrors = rootCauseFrames;
                } else if (throwFrames.length > 0) {
                    // If only throw statements found, show them but mark as secondary
                    throwFrames.sort((a, b) => b.stackIndex - a.stackIndex);
                    allUserErrors = throwFrames;
                }
                
                // Final sort by file type priority if multiple errors at same level
                allUserErrors.sort((a, b) => {
                    // First by stack depth (deeper errors first)
                    if (a.stackIndex !== b.stackIndex) {
                        return b.stackIndex - a.stackIndex;
                    }
                    // Then by file type priority
                    if (a.isActionCode && !b.isActionCode) return -1;
                    if (!a.isActionCode && b.isActionCode) return 1;
                    if (a.isLearnedSkill && !b.isLearnedSkill) return -1;
                    if (!a.isLearnedSkill && b.isLearnedSkill) return 1;
                    return a.errorLine - b.errorLine;
                });
            }
            
            // Filter out errors without meaningful content (like empty stack frames)
            const meaningfulErrors = allUserErrors.filter(error => 
                error.lineContent && error.lineContent.trim().length > 0
            );
            
            // Generate comprehensive error information
            if (meaningfulErrors.length > 0) {
                codeErrorInfo = '\n#### ERROR CALL CHAIN ###\n';
                
                for (let i = 0; i < meaningfulErrors.length; i++) {
                    const userError = meaningfulErrors[i];
                    const depth = '  '.repeat(i); // Indentation to show call depth
                    const arrow = i > 0 ? '↳ ' : '';
                    
                    codeErrorInfo += `${depth}${arrow}**${errorMessage}**\n`;
                    codeErrorInfo += `${depth}  File: ${userError.filePath}\n`;
                    codeErrorInfo += `${depth}  Location: Line ${userError.errorLine}, Column ${userError.errorColumn}\n`;
                    
                    // Store the deepest error line content for skill extraction (last meaningful error)
                    errorLineContent = userError.lineContent;
                    
                    // Add code context if we have the line content
                    if (userError.lineContent) {
                        try {
                            const fileContent = await fs.promises.readFile(userError.filePath, 'utf8');
                            const fileLines = fileContent.split('\n');
                            
                            codeErrorInfo += `${depth}  Code Context:\n`;
                            const startLine = Math.max(0, userError.errorLine - 2);
                            const endLine = Math.min(fileLines.length - 1, userError.errorLine + 1);
                            
                            for (let j = startLine; j <= endLine; j++) {
                                const lineNumber = j + 1;
                                const isErrorLine = lineNumber === userError.errorLine;
                                const prefix = isErrorLine ? '>>> ' : '    ';
                                const line = fileLines[j] || '';
                                
                                codeErrorInfo += `${depth}  ${prefix}${lineNumber.toString().padStart(3)}: ${line}\n`;
                                
                                // Add column indicator for error line
                                if (isErrorLine && userError.errorColumn > 0) {
                                    const actualPrefix = `${depth}  ${prefix}${lineNumber.toString().padStart(3)}: `;
                                    const spaces = ' '.repeat(actualPrefix.length + userError.errorColumn - 1);
                                    codeErrorInfo += `${spaces}^\n`;
                                }
                            }
                        } catch (readError) {
                            codeErrorInfo += `${depth}  Unable to read code context: ${readError.message}\n`;
                        }
                    }
                    
                    if (i < meaningfulErrors.length - 1) {
                        codeErrorInfo += '\n';
                    }
                }
                
                // Add error type information
                if (error.name && error.name !== 'Error') {
                    codeErrorInfo += `\nError Type: ${error.name}\n`;
                }
            } else {
                // Fallback to basic error processing if no user code errors found
                let errorLine = null;
                let errorColumn = null;
                
                // Try to extract basic location info
                if (error.sourceFile && error.stack) {
                    const sourceMatch = error.stack.match(new RegExp(`${error.sourceFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)`));
                    if (sourceMatch) {
                        errorLine = parseInt(sourceMatch[1]);
                        errorColumn = parseInt(sourceMatch[2]);
                    }
                } else {
                    const lineMatch = error.stack?.match(/<anonymous>:(\\d+):(\\d+)/);
                    if (lineMatch) {
                        const wrapperLine = parseInt(lineMatch[1]);
                        errorLine = Math.max(1, wrapperLine - 3);
                        errorColumn = parseInt(lineMatch[2]);
                    }
                }
                
                if (errorLine && errorColumn) {
                    const startLine = Math.max(0, errorLine - 2);
                    const endLine = Math.min(originalLines.length - 1, errorLine + 1);
                    
                    codeErrorInfo = '\n#### CODE EXECUTION ERROR INFO ###\n';
                    codeErrorInfo += `#ERROR 1\n`;
                    codeErrorInfo += `File: ${params.file_path}\n`;
                    codeErrorInfo += `ERROR MESSAGE: ${errorMessage}\n`;
                    codeErrorInfo += `ERROR LOCATION: Line ${errorLine}, Column ${errorColumn}\n`;
                    codeErrorInfo += `\nCode Context:\n`;
                    
                    for (let i = startLine; i <= endLine; i++) {
                        const lineNumber = i + 1;
                        const isErrorLine = lineNumber === errorLine;
                        const prefix = isErrorLine ? '>>> ' : '    ';
                        const line = originalLines[i] || '';
                        
                        if (isErrorLine) {
                            errorLineContent = line;
                        }
                        
                        codeErrorInfo += `${prefix}${lineNumber.toString().padStart(3)}: ${line}\n`;
                        
                        if (isErrorLine && errorColumn > 0) {
                            const actualPrefix = `${prefix}${lineNumber.toString().padStart(3)}: `;
                            const spaces = ' '.repeat(actualPrefix.length + errorColumn - 1);
                            codeErrorInfo += `${spaces}^\n`;
                        }
                    }
                    
                    if (error.name && error.name !== 'Error') {
                        codeErrorInfo += `\nError Type: ${error.name}\n`;
                    }
                } else {
                    codeErrorInfo = `\n#### CODE EXECUTION ERROR INFO ###\nError: ${errorMessage}\nUnable to map error to source location\n`;
                    errorLineContent = '';
                }
            }
        } catch (readError) {
            // If unable to read file, use basic error info
            codeErrorInfo = `\n#### CODE EXECUTION ERROR INFO ###\nUnable to extract code context: ${readError.message}`;
            errorLineContent = '';
        }
        
        // Extract skills/world functions from error message for intelligent suggestions
        const skillSuggestions = await this.agent.prompter.skill_libary.getRelevantSkillDocs(errorLineContent, 2) + '\n';
        
        return {
            errorReport: codeErrorInfo,
            skillSuggestions: skillSuggestions
        };
    }

    /**
     * Check if a line contains a throw statement that should be filtered out
     * @param {string} lineContent - The line content to check
     * @returns {boolean} True if this is a throw statement to filter
     */
    _isThrowStatement(lineContent) {
        const trimmed = lineContent.trim();
        
        // Enhanced throw statement patterns
        const throwPatterns = [
            /^\s*throw\s+error\s*;?\s*$/i,                    // throw error;
            /^\s*throw\s+new\s+Error\s*\(/i,                  // throw new Error(...)
            /^\s*throw\s+\w+\s*;?\s*$/i,                     // throw errorMsg;
            /^\s*throw\s+.*\.message\s*;?\s*$/i,             // throw error.message;
            /^\s*throw\s+.*Error\s*\(/i,                     // throw SomeError(...)
            /^\s*throw\s+.*error.*\s*;?\s*$/i,               // throw anyVariableWithError;
        ];
        
        return throwPatterns.some(pattern => pattern.test(trimmed));
    }
}

export default ExecuteTool;
