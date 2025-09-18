import { EditTool } from './edit.js';
import { MultiEditTool } from './multiEdit.js';
import { WriteTool } from './write.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { LSTool } from './ls.js';
import { ReadTool } from './read.js';
import { ExecuteTool } from './execute.js';
import { LintTool } from './lint.js';
import { TodoWriteTool } from './todoWrite.js';
import fs from 'fs';
import path from 'path';

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
 * Tool Manager - Manages all available tools, executes tools, and provides tool descriptions for prompts
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
        this.tools.set('TodoWrite', new TodoWriteTool(this.agent));

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
     * Execute multiple tools in sequence
     * @param {Array} tools - Array of command objects
     * @returns {Array} Array of execution results
     */
    async executetools(tools) {
        const results = [];
        
        // Validate tools parameter
        if (!tools || !Array.isArray(tools)) {
            console.log(`${colors.brightYellow}⚠ [ToolManager]${colors.reset} executetools: tools parameter is not a valid array`);
            return results;
        }
        
        console.log(`${colors.brightBlue}[ToolManager]${colors.reset} Executing ${colors.brightMagenta}${tools.length}${colors.reset} command(s)...`);
        
        for (let i = 0; i < tools.length; i++) {
            const command = tools[i];
            console.log(`${colors.brightBlue}[ToolManager]${colors.reset} Command ${colors.brightMagenta}${i + 1}/${tools.length}${colors.reset}:`);
            
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
            console.log(`${colors.brightGreen}[OK] [ToolManager]${colors.reset} All ${colors.brightMagenta}${tools.length}${colors.reset} tools executed successfully`);
        } else {
            console.log(`${colors.brightYellow}⚠ [ToolManager]${colors.reset} tools completed: ${colors.brightGreen}${successCount} success${colors.reset}, ${colors.brightRed}${failureCount} failed${colors.reset}`);
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
     * Check if a response contains JSON tool tools
     * @param {string} response - The response text to check
     * @returns {boolean} True if response contains JSON tools
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
     * Extract JSON tools from a response
     * @param {string} response - The response text
     * @returns {Array} Array of command objects
     */
    extractJSONtools(response) {
        const tools = [];
        
        if (!response || typeof response !== 'string') {
            return tools;
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
                        tools.push({ tool: name, params });
                    }
                }
            }
            // Handle legacy formats: single tools and arrays
            else if (Array.isArray(parsed)) {
                for (const cmd of parsed) {
                    if (cmd && typeof cmd === 'object' && cmd.tool) {
                        tools.push(cmd);
                    }
                }
            } else if (parsed && typeof parsed === 'object' && parsed.tool) {
                tools.push(parsed);
            }
            
            // If we successfully parsed JSON and found tools, return them
            if (tools.length > 0) {
                console.log(`Extracted ${tools.length} JSON command(s) from direct parsing`);
                return tools;
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
                            tools.push({ tool: name, params });
                        }
                    }
                }
                // Check if this is a legacy tool command
                else if (parsed && typeof parsed === 'object' && parsed.tool) {
                    tools.push(parsed);
                }
            } catch (error) {
                // Continue to next match
                continue;
            }
        }
        
        // If we found tools from object extraction, return them
        if (tools.length > 0) {
            console.log(`Extracted ${tools.length} JSON command(s) from object parsing`);
            return tools;
        }

        // Strategy 3: Look for code block wrapped JSON (original behavior)
        const jsonBlockRegex = /```json\s*([\s\S]*?)```/gi;
        
        while ((match = jsonBlockRegex.exec(response)) !== null) {
            try {
                const jsonContent = match[1].trim();
                const parsed = JSON.parse(jsonContent);
                
                // Handle both single tools and arrays
                if (Array.isArray(parsed)) {
                    for (const cmd of parsed) {
                        if (cmd && typeof cmd === 'object' && cmd.tool) {
                            tools.push(cmd);
                        }
                    }
                } else if (parsed && typeof parsed === 'object' && parsed.tool) {
                    tools.push(parsed);
                }
            } catch (error) {
                console.warn('Failed to parse JSON command from code block:', error.message);
            }
        }
        
        if (tools.length > 0) {
            console.log(`Extracted ${tools.length} JSON command(s) from code blocks`);
        } else {
            console.log('No valid JSON tools found in response');
        }
        
        return tools;
    }

    /**
     * Validate that tools only operate within allowed workspaces
     * @param {Array} tools - Array of command objects
     * @returns {Object} Validation result
     */
    validateCommandWorkspaces(tools) {
        try {
            if (!Array.isArray(tools)) {
                //console.log(`SECURITY: validateCommandWorkspaces - tools is not an array: ${typeof tools}`);
                return { valid: false, error: 'tools must be an array' };
            }

            //console.log(`SECURITY: validateCommandWorkspaces - processing ${tools.length} tools`);
            //console.log(`SECURITY: validateCommandWorkspaces - this.workspaces:`, this.workspaces);

            for (const command of tools) {
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
                const isAllowed = (this.workspaces || []).some(workspace => {
                    // Remove trailing slash from workspace for consistent comparison
                    const cleanWorkspace = workspace.endsWith('/') ? workspace.slice(0, -1) : workspace;
                    return normalizedPath.startsWith(cleanWorkspace + '/') || normalizedPath === cleanWorkspace;
                });

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
            console.error(`SECURITY: validateCommandWorkspaces - tools:`, JSON.stringify(tools, null, 2));
            console.error(`SECURITY: validateCommandWorkspaces - this.workspaces:`, this.workspaces);
            return { 
                valid: false, 
                error: `Workspace validation failed: ${error.message}. tools type: ${typeof tools}, workspaces: ${this.workspaces}` 
            };
        }
    }

    /**
     * Execute JSON tools with workspace validation
     * @param {Array} tools - Array of command objects
     * @returns {Object} Execution result
     */
    async executeJSONtools(tools) {
        let message = '';
        try {
            console.log(`${colors.brightBlue}[ToolManager]${colors.reset} Starting JSON tools execution...`);
            // Validate workspaces
            const validation = this.validateCommandWorkspaces(tools);
  
            if (!validation.valid) {
                message += `Workspace validation failed: ${validation.error}`;
                console.log(`${colors.brightRed}✗ [ToolManager]${colors.reset} Workspace validation failed: ${validation.error}`);
                return {
                    success: false,
                    message: message
                };
            }
            message += `Workspace validation passed`;
            console.log(`${colors.brightGreen}[·] [ToolManager]${colors.reset} Workspace validation passed`);

            // Execute tools
            const results = await this.executetools(tools) || [];
            const successCount = results.filter(r => r.success !== false).length;
            const failedResults = results.filter(r => r.success === false);

            if (failedResults.length > 0) {
                message += `${failedResults.length} tools failed: ${failedResults.map(r => r.error).join(', ')}`;
                console.log(`${colors.brightRed}✗ [ToolManager]${colors.reset} JSON tools execution failed: ${failedResults.length} command(s) failed`);
                return {
                    success: false,
                    message: message,
                    results
                };
            }

            const executedTools = results.map(r => `${r.tool}: ${r.file_path || 'executed'}`).join(', ');
            
            // Create operations array for coder.js compatibility
            const operations = results.map(r => ({
                tool: r.tool || r.action,
                path: r.file_path
            }));
            
            console.log(`${colors.brightGreen}[>] [ToolManager]${colors.reset} JSON tools execution completed successfully`);
            message += executedTools;
            return {
                success: true,
                message: message,
                results,
                operations
            };
        } catch (error) {
            console.log(`${colors.brightRed}✗ [ToolManager]${colors.reset} JSON tools execution error: ${error.message}`);
            message += `Execution error: ${error.message}`;
            return {
                success: false,
                message: message
            };
        }
    }

    /**
     * Process a response and execute any JSON tools found
     * @param {string} response - The response text
     * @returns {Object} Processing result
     */
    async processResponse(response) {
        if (!this.isJSONToolResponse(response)) {
            return {
                success: true,
                message: 'No JSON tool tools found in response'
            };
        }

        console.log('Detected JSON tool tools in response');
        const tools = this.extractJSONtools(response);
        
        if (tools.length === 0) {
            return {
                success: false,
                message: 'Failed to extract valid JSON tools'
            };
        }

        return await this.executeJSONtools(tools);
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
     * Check if TODOLIST.md is empty or doesn't exist
     * @returns {boolean} True if todo list is empty or doesn't exist
     */
    isTodoListEmpty() {
        if (!this.agent || !this.agent.name) {
            return true;
        }
        
        // Get the base directory from the current module path
        const currentDir = path.dirname(new URL(import.meta.url).pathname);
        const projectRoot = path.resolve(currentDir, '..');
        const todoFilePath = path.join(projectRoot, 'bots', this.agent.name, 'TODOLIST.md');
        
        try {
            if (!fs.existsSync(todoFilePath)) {
                return true;
            }
            
            const content = fs.readFileSync(todoFilePath, 'utf8').trim();
            
            // Check if file is empty or only contains basic structure without actual todos
            if (!content) {
                return true;
            }
            
            // Check if file only contains header and no actual todo items
            const lines = content.split('\n').filter(line => line.trim());
            const todoLines = lines.filter(line => line.trim().startsWith('- ['));
            
            return todoLines.length === 0;
        } catch (error) {
            // If there's an error reading the file, consider it empty
            return true;
        }
    }

    /**
     * Generate formatted tool descriptions for prompts
     * @returns {string} Formatted tool descriptions
     */
    getFormattedToolDescriptions() {
        try {
            const toolsPromptPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'tools-prompt.md');
            let content = fs.readFileSync(toolsPromptPath, 'utf8');
            
            // Check if todo list is empty and add system reminder
            if (this.isTodoListEmpty()) {
                content += '\n\n<system-reminder>This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.</system-reminder>';
            }
            
            return content;
        } catch (error) {
            console.error('Error reading tools-prompt.md:', error);
            // Fallback to original method if file reading fails
            const descriptions = this.getToolDescriptions();
            return JSON.stringify(descriptions, null, 2);
        }
    }

}

export default ToolManager;
