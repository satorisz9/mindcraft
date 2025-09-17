import { EditTool } from './edit.js';
import { MultiEditTool } from './multiEdit.js';
import { WriteTool } from './write.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { LSTool } from './ls.js';
import { ReadTool } from './read.js';
import { ExecuteTool } from './execute.js';
import { LintTool } from './lint.js';

// ANSI color codes for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    brightWhite: '\x1b[97m'
};

/**
 * Tool Manager - Manages all available tools, executes commands, and provides tool descriptions for prompts
 */
export class ToolManager {
    constructor(agent = null) {
        this.agent = agent;
        this.tools = new Map();
        this.workspaces = [];
        this.initializeTools();
        this.initializeWorkspaces();
    }

    /**
     * Initialize workspaces based on agent configuration
     */
    initializeWorkspaces() {
        if (this.agent && this.agent.name) {
            // Only use agent.code_workspaces - no fallback to relative paths
            if (this.agent.code_workspaces && Array.isArray(this.agent.code_workspaces)) {
                this.workspaces = this.agent.code_workspaces
                    .map(ws => ws.replace('{BOT_NAME}', this.agent.name))
                    .map(ws => ws.startsWith('/') ? ws.substring(1) : ws); // Remove leading slash for internal processing
                //console.log(`SECURITY: Bot ${this.agent.name} initialized with workspaces: ${this.workspaces.join(', ')}`);
            } else {
                console.error(`SECURITY: No code_workspaces configured for bot ${this.agent.name}. File operations will be blocked.`);
                this.workspaces = []; // Empty workspaces - all operations will be blocked
            }
        }
    }

    /**
     * Initialize all available tools
     */
    initializeTools() {
        // Register all tools with agent parameter
        const readTool = new ReadTool(this.agent);
        
        this.tools.set('Edit', new EditTool(this.agent));
        this.tools.set('MultiEdit', new MultiEditTool(this.agent));
        this.tools.set('Write', new WriteTool(this.agent));
        this.tools.set('Execute', new ExecuteTool(this.agent));
        this.tools.set('Lint', new LintTool(this.agent));
        this.tools.set('Glob', new GlobTool(this.agent));
        this.tools.set('Grep', new GrepTool(this.agent));
        this.tools.set('LS', new LSTool(this.agent));
        this.tools.set('Read', readTool);

        // Set tool registry for cross-tool communication
        readTool.setToolRegistry(this.tools);
    }

    /**
     * Execute a tool command
     * @param {Object} command - The command object
     * @param {string} command.tool - Tool name
     * @param {Object} command.params - Tool parameters
     * @returns {Object} Execution result
     */
    async executeCommand(command) {
        try {
            const { tool, params } = command;

            if (!tool) {
                throw new Error('Missing tool name in command');
            }

            const toolInstance = this.tools.get(tool);
            if (!toolInstance) {
                throw new Error(`Unknown tool: ${tool}. Available tools: ${Array.from(this.tools.keys()).join(', ')}`);
            }

            // Execute the tool - all tools now have agent in constructor
            console.log(`${colors.brightBlue}[ToolManager]${colors.reset} Executing ${colors.brightYellow}${tool}${colors.reset} tool...`);
            const result = await toolInstance.execute(params || {});
            
            // Log success or failure with colors
            if (result.success !== false) {
                console.log(`${colors.brightGreen}✓ [ToolManager]${colors.reset} ${colors.brightYellow}${tool}${colors.reset} executed successfully`);
            } else {
                console.log(`${colors.brightRed}✗ [ToolManager]${colors.reset} ${colors.brightYellow}${tool}${colors.reset} execution failed: ${result.error || result.message}`);
            }
            
            return {
                tool,
                timestamp: new Date().toISOString(),
                ...result
            };

        } catch (error) {
            console.log(`${colors.brightRed}✗ [ToolManager]${colors.reset} ${colors.brightYellow}${command.tool || 'unknown'}${colors.reset} execution error: ${error.message}`);
            return {
                tool: command.tool || 'unknown',
                timestamp: new Date().toISOString(),
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Execute multiple commands in sequence
     * @param {Array} commands - Array of command objects
     * @returns {Array} Array of execution results
     */
    async executeCommands(commands) {
        const results = [];
        
        // Validate commands parameter
        if (!commands || !Array.isArray(commands)) {
            console.log(`${colors.brightYellow}⚠ [ToolManager]${colors.reset} executeCommands: commands parameter is not a valid array`);
            return results;
        }
        
        console.log(`${colors.brightBlue}[ToolManager]${colors.reset} Executing ${colors.brightMagenta}${commands.length}${colors.reset} command(s)...`);
        
        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            console.log(`${colors.brightBlue}[ToolManager]${colors.reset} Command ${colors.brightMagenta}${i + 1}/${commands.length}${colors.reset}:`);
            
            const result = await this.executeCommand(command);
            results.push(result);
            
            // Stop execution if a command fails (optional behavior)
            if (!result.success) {
                console.log(`${colors.brightRed}✗ [ToolManager]${colors.reset} Command ${i + 1} failed, continuing with next command...`);
            }
        }
        
        const successCount = results.filter(r => r.success !== false).length;
        const failureCount = results.length - successCount;
        
        if (failureCount === 0) {
            console.log(`${colors.brightGreen}[OK] [ToolManager]${colors.reset} All ${colors.brightMagenta}${commands.length}${colors.reset} commands executed successfully`);
        } else {
            console.log(`${colors.brightYellow}⚠ [ToolManager]${colors.reset} Commands completed: ${colors.brightGreen}${successCount} success${colors.reset}, ${colors.brightRed}${failureCount} failed${colors.reset}`);
        }
        
        return results;
    }

    /**
     * Get list of available tools
     * @returns {Array} Array of tool names
     */
    getAvailableTools() {
        return Array.from(this.tools.keys());
    }

    /**
     * Get tool instance
     * @param {string} toolName - Name of the tool
     * @returns {Object} Tool instance
     */
    getTool(toolName) {
        return this.tools.get(toolName);
    }

    /**
     * Check if a response contains JSON tool commands
     * @param {string} response - The response text to check
     * @returns {boolean} True if response contains JSON commands
     */
    isJSONToolResponse(response) {
        if (!response || typeof response !== 'string') {
            return false;
        }

        // Strategy 1: Try to parse the entire response as JSON first
        try {
            const trimmedResponse = response.trim();
            const parsed = JSON.parse(trimmedResponse);
            
            // Check for {tools:[]} format
            if (parsed && typeof parsed === 'object' && parsed.tools && Array.isArray(parsed.tools)) {
                for (const cmd of parsed.tools) {
                    if (cmd && typeof cmd === 'object' && cmd.name) {
                        return true;
                    }
                }
            }
            // Check for legacy formats
            else if (Array.isArray(parsed)) {
                for (const cmd of parsed) {
                    if (cmd && typeof cmd === 'object' && cmd.tool) {
                        return true;
                    }
                }
            } else if (parsed && typeof parsed === 'object' && parsed.tool) {
                return true;
            }
        } catch (error) {
            // Continue to other strategies
        }

        // Strategy 2: Look for JSON objects within the text
        const jsonObjectRegex = /\{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*\}/g;
        let match;
        
        while ((match = jsonObjectRegex.exec(response)) !== null) {
            try {
                const jsonContent = match[0].trim();
                const parsed = JSON.parse(jsonContent);
                
                // Check for {tools:[]} format
                if (parsed && typeof parsed === 'object' && parsed.tools && Array.isArray(parsed.tools)) {
                    for (const cmd of parsed.tools) {
                        if (cmd && typeof cmd === 'object' && cmd.name) {
                            return true;
                        }
                    }
                }
                // Check for legacy tool command
                else if (parsed && typeof parsed === 'object' && parsed.tool) {
                    return true;
                }
            } catch (error) {
                continue;
            }
        }

        // Strategy 3: Look for JSON code blocks (legacy)
        const jsonBlockRegex = /```json\s*([\s\S]*?)```/gi;
        const matches = response.match(jsonBlockRegex);
        
        if (matches) {
            for (const match of matches) {
                try {
                    const jsonContent = match.replace(/```json\s*|```/gi, '').trim();
                    const parsed = JSON.parse(jsonContent);
                    
                    // Check for {tools:[]} format
                    if (parsed && typeof parsed === 'object' && parsed.tools && Array.isArray(parsed.tools)) {
                        for (const cmd of parsed.tools) {
                            if (cmd && typeof cmd === 'object' && cmd.name) {
                                return true;
                            }
                        }
                    }
                    // Check legacy formats
                    else if (Array.isArray(parsed)) {
                        for (const cmd of parsed) {
                            if (cmd && typeof cmd === 'object' && cmd.tool) {
                                return true;
                            }
                        }
                    } else if (parsed && typeof parsed === 'object' && parsed.tool) {
                        return true;
                    }
                } catch (error) {
                    continue;
                }
            }
        }
        
        return false;
    }

    /**
     * Extract JSON commands from a response
     * @param {string} response - The response text
     * @returns {Array} Array of command objects
     */
    extractJSONCommands(response) {
        const commands = [];
        
        if (!response || typeof response !== 'string') {
            return commands;
        }

        // Strategy 1: Try to parse the entire response as JSON first
        try {
            const trimmedResponse = response.trim();
            const parsed = JSON.parse(trimmedResponse);
            
            // Handle {tools:[]} format
            if (parsed && typeof parsed === 'object' && parsed.tools && Array.isArray(parsed.tools)) {
                for (const cmd of parsed.tools) {
                    if (cmd && typeof cmd === 'object' && cmd.name) {
                        // Create command object with tool name and params
                        const { name, ...params } = cmd;
                        commands.push({ tool: name, params });
                    }
                }
            }
            // Handle legacy formats: single commands and arrays
            else if (Array.isArray(parsed)) {
                for (const cmd of parsed) {
                    if (cmd && typeof cmd === 'object' && cmd.tool) {
                        commands.push(cmd);
                    }
                }
            } else if (parsed && typeof parsed === 'object' && parsed.tool) {
                commands.push(parsed);
            }
            
            // If we successfully parsed JSON and found commands, return them
            if (commands.length > 0) {
                console.log(`Extracted ${commands.length} JSON command(s) from direct parsing`);
                return commands;
            }
        } catch (error) {
            // Direct parsing failed, continue to code block parsing
            console.log('Direct JSON parsing failed, trying code block extraction...');
        }

        // Strategy 2: Look for JSON objects within the text (not in code blocks)
        // Use a more robust regex to find complete JSON objects
        const jsonObjectRegex = /\{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*\}/g;
        let match;
        
        while ((match = jsonObjectRegex.exec(response)) !== null) {
            try {
                const jsonContent = match[0].trim();
                const parsed = JSON.parse(jsonContent);
                
                // Check if this is a {tools:[]} format
                if (parsed && typeof parsed === 'object' && parsed.tools && Array.isArray(parsed.tools)) {
                    for (const cmd of parsed.tools) {
                        if (cmd && typeof cmd === 'object' && cmd.name) {
                            // Create command object with tool name and params
                            const { name, ...params } = cmd;
                            commands.push({ tool: name, params });
                        }
                    }
                }
                // Check if this is a legacy tool command
                else if (parsed && typeof parsed === 'object' && parsed.tool) {
                    commands.push(parsed);
                }
            } catch (error) {
                // Continue to next match
                continue;
            }
        }
        
        // If we found commands from object extraction, return them
        if (commands.length > 0) {
            console.log(`Extracted ${commands.length} JSON command(s) from object parsing`);
            return commands;
        }

        // Strategy 3: Look for code block wrapped JSON (original behavior)
        const jsonBlockRegex = /```json\s*([\s\S]*?)```/gi;
        
        while ((match = jsonBlockRegex.exec(response)) !== null) {
            try {
                const jsonContent = match[1].trim();
                const parsed = JSON.parse(jsonContent);
                
                // Handle both single commands and arrays
                if (Array.isArray(parsed)) {
                    for (const cmd of parsed) {
                        if (cmd && typeof cmd === 'object' && cmd.tool) {
                            commands.push(cmd);
                        }
                    }
                } else if (parsed && typeof parsed === 'object' && parsed.tool) {
                    commands.push(parsed);
                }
            } catch (error) {
                console.warn('Failed to parse JSON command from code block:', error.message);
            }
        }
        
        if (commands.length > 0) {
            console.log(`Extracted ${commands.length} JSON command(s) from code blocks`);
        } else {
            console.log('No valid JSON commands found in response');
        }
        
        return commands;
    }

    /**
     * Validate that commands only operate within allowed workspaces
     * @param {Array} commands - Array of command objects
     * @returns {Object} Validation result
     */
    validateCommandWorkspaces(commands) {
        try {
            if (!Array.isArray(commands)) {
                //console.log(`SECURITY: validateCommandWorkspaces - commands is not an array: ${typeof commands}`);
                return { valid: false, error: 'Commands must be an array' };
            }

            //console.log(`SECURITY: validateCommandWorkspaces - processing ${commands.length} commands`);
            //console.log(`SECURITY: validateCommandWorkspaces - this.workspaces:`, this.workspaces);

            for (const command of commands) {
                if (!command || !command.params) {
                    //console.log(`SECURITY: validateCommandWorkspaces - skipping command without params:`, command);
                    continue;
                }

                const filePath = command.params.file_path || command.params.path;
                if (!filePath) {
                    continue;
                }

                // Check if file path is within allowed workspaces
                // Only support absolute paths (must start with /)
                if (!filePath.startsWith('/')) {
                    //console.log(`SECURITY: Blocked relative path, only absolute paths allowed: ${filePath}`);
                    return {
                        valid: false,
                        error: `File access denied: Only absolute paths are allowed, got relative path: ${filePath}`
                    };
                }

                const normalizedPath = filePath.substring(1); // Remove leading '/'
                const isAllowed = (this.workspaces || []).some(workspace => 
                    normalizedPath.startsWith(workspace + '/') || normalizedPath === workspace
                );

                if (!isAllowed) {
                    //console.log(`SECURITY: Blocked file access outside workspace: ${filePath}`);
                    //console.log(`SECURITY: Allowed workspaces: ${(this.workspaces || []).join(', ')}`);
                    return {
                        valid: false,
                        error: `File access denied: ${filePath} is outside allowed workspaces: ${(this.workspaces || []).join(', ')}`
                    };
                }
            }

            return { valid: true };
        } catch (error) {
            console.error(`SECURITY: validateCommandWorkspaces - Error in validation:`, error);
            console.error(`SECURITY: validateCommandWorkspaces - Error stack:`, error.stack);
            console.error(`SECURITY: validateCommandWorkspaces - Commands:`, JSON.stringify(commands, null, 2));
            console.error(`SECURITY: validateCommandWorkspaces - this.workspaces:`, this.workspaces);
            return { 
                valid: false, 
                error: `Workspace validation failed: ${error.message}. Commands type: ${typeof commands}, workspaces: ${this.workspaces}` 
            };
        }
    }

    /**
     * Execute JSON commands with workspace validation
     * @param {Array} commands - Array of command objects
     * @returns {Object} Execution result
     */
    async executeJSONCommands(commands) {
        try {
            console.log(`${colors.brightBlue}[ToolManager]${colors.reset} Starting JSON commands execution...`);
            
            // Validate workspaces
            const validation = this.validateCommandWorkspaces(commands);
            if (!validation.valid) {
                console.log(`${colors.brightRed}✗ [ToolManager]${colors.reset} Workspace validation failed: ${validation.error}`);
                return {
                    success: false,
                    message: validation.error
                };
            }
            
            console.log(`${colors.brightGreen}[·] [ToolManager]${colors.reset} Workspace validation passed`);

            // Execute commands
            const results = await this.executeCommands(commands) || [];
            const successCount = results.filter(r => r.success !== false).length;
            const failedResults = results.filter(r => r.success === false);

            if (failedResults.length > 0) {
                console.log(`${colors.brightRed}✗ [ToolManager]${colors.reset} JSON commands execution failed: ${failedResults.length} command(s) failed`);
                return {
                    success: false,
                    message: `${failedResults.length} commands failed: ${failedResults.map(r => r.error).join(', ')}`,
                    results
                };
            }

            const executedTools = results.map(r => `${r.tool}: ${r.file_path || 'executed'}`).join(', ');
            
            // Create operations array for coder.js compatibility
            const operations = results.map(r => ({
                tool: r.tool || r.action,
                path: r.file_path
            }));
            
            console.log(`${colors.brightGreen}[>] [ToolManager]${colors.reset} JSON commands execution completed successfully`);
            
            return {
                success: true,
                message: `JSON tool used successfully: ${executedTools}`,
                results,
                operations
            };
        } catch (error) {
            console.log(`${colors.brightRed}✗ [ToolManager]${colors.reset} JSON commands execution error: ${error.message}`);
            return {
                success: false,
                message: `Execution error: ${error.message}`
            };
        }
    }

    /**
     * Process a response and execute any JSON commands found
     * @param {string} response - The response text
     * @returns {Object} Processing result
     */
    async processResponse(response) {
        if (!this.isJSONToolResponse(response)) {
            return {
                success: true,
                message: 'No JSON tool commands found in response'
            };
        }

        console.log('Detected JSON tool commands in response');
        const commands = this.extractJSONCommands(response);
        
        if (commands.length === 0) {
            return {
                success: false,
                message: 'Failed to extract valid JSON commands'
            };
        }

        return await this.executeJSONCommands(commands);
    }

    /**
     * Generate tool descriptions for prompts
     * @returns {Object} Tool descriptions in {tools:[]} format
     */
    getToolDescriptions() {
        const descriptions = [];
        
        for (const [name, tool] of this.tools) {
            if (tool.getDescription && tool.getInputSchema) {
                descriptions.push({
                    name: name,
                    description: tool.getDescription(),
                    input_schema: tool.getInputSchema()
                });
            }
        }
        
        return { tools: descriptions };
    }

    /**
     * Generate formatted tool descriptions for prompts
     * @returns {string} Formatted tool descriptions
     */
    getFormattedToolDescriptions() {
        const descriptions = this.getToolDescriptions();
        return JSON.stringify(descriptions, null, 2);
    }

}

export default ToolManager;
