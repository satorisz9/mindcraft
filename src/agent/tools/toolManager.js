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

// Constants
const COLORS = {
    reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
    brightRed: '\x1b[91m', brightGreen: '\x1b[92m', brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m', brightMagenta: '\x1b[95m', brightCyan: '\x1b[96m'
};

const TOOL_CLASSES = [
    ['Edit', EditTool], ['MultiEdit', MultiEditTool], ['Write', WriteTool],
    ['Execute', ExecuteTool], ['Lint', LintTool], ['Glob', GlobTool],
    ['Grep', GrepTool], ['LS', LSTool], ['Read', ReadTool], ['TodoWrite', TodoWriteTool]
];

const REMINDER_THRESHOLD = 60000; // 1 minute in milliseconds

/**
 * Tool Manager - Manages all available tools and executes Tools with workspace validation
 */
export class ToolManager {
    constructor(agent = null) {
        this.agent = agent;
        this.tools = new Map();
        this.workspaces = [];
        this.promptCache = null;
        this.promptCacheTime = 0;
        
        this.initializeTools();
        this.initializeWorkspaces();
    }

    // Initialization

    initializeTools() {
        const readTool = new ReadTool(this.agent);
        
        for (const [name, ToolClass] of TOOL_CLASSES) {
            const tool = name === 'Read' ? readTool : new ToolClass(this.agent);
            this.tools.set(name, tool);
        }
        
        readTool.setToolRegistry(this.tools);
    }

    initializeWorkspaces() {
        if (!this.agent?.name) {
            this.workspaces = [];
            return;
        }

        // Only use agent.code_workspaces - no fallback to relative paths
        if (this.agent.code_workspaces && Array.isArray(this.agent.code_workspaces)) {
            this.workspaces = this.agent.code_workspaces
                .map(ws => ws.replace('{BOT_NAME}', this.agent.name))
                .map(ws => ws.startsWith('/') ? ws.substring(1) : ws); // Remove leading slash for internal processing
        } else {
            this.logSecurity(`No code_workspaces configured for bot ${this.agent.name}. File operations will be blocked.`);
            this.workspaces = []; // Empty workspaces - all operations will be blocked
        }
    }

    // Core Execution

    async executeTool(Tool) {
        const startTime = Date.now();
        const { tool: toolName, params = {} } = Tool;

        if (!toolName) {
            return this.createErrorResult('unknown', 'Missing tool name in Tool', startTime);
        }

        const toolInstance = this.tools.get(toolName);
        if (!toolInstance) {
            const availableTools = Array.from(this.tools.keys()).join(', ');
            return this.createErrorResult(toolName, `Unknown tool: ${toolName}. Available: ${availableTools}`, startTime);
        }

        try {
            console.log(`${COLORS.brightBlue}[ToolManager]${COLORS.reset} Executing ${COLORS.brightYellow}${toolName}${COLORS.reset} tool...`);
            const result = await toolInstance.execute(params);
            
            if (result.success !== false) {
                console.log(`${COLORS.brightGreen}✓ [ToolManager]${COLORS.reset} ${COLORS.brightYellow}${toolName}${COLORS.reset} executed successfully`);
            } else {
                console.log(`${COLORS.brightRed}✗ [ToolManager]${COLORS.reset} ${COLORS.brightYellow}${toolName}${COLORS.reset} execution failed: ${result.error || result.message}`);
            }
            
            return { tool: toolName, timestamp: new Date().toISOString(), ...result };
        } catch (error) {
            console.log(`${COLORS.brightRed}✗ [ToolManager]${COLORS.reset} ${COLORS.brightYellow}${toolName || 'unknown'}${COLORS.reset} execution error: ${error.message}`);
            return this.createErrorResult(toolName, error.message, startTime);
        }
    }

    async runTools(tools, options = {}) {
        const { validateWorkspaces = false, aggregate = true } = options;
        
        if (!Array.isArray(tools)) {
            console.log(`${COLORS.brightYellow}⚠ [ToolManager]${COLORS.reset} executeTools: tools parameter is not a valid array`);
            return [];
        }

        if (validateWorkspaces) {
            const validation = this.validateWorkspaces(tools);
            if (!validation.valid) {
                throw new Error(`Workspace validation failed: ${validation.error}`);
            }
        }

        console.log(`${COLORS.brightBlue}[ToolManager]${COLORS.reset} Executing ${COLORS.brightMagenta}${tools.length}${COLORS.reset} Tool(s)...`);
        const results = [];

        for (let i = 0; i < tools.length; i++) {
            console.log(`${COLORS.brightBlue}[ToolManager]${COLORS.reset} Tool ${COLORS.brightMagenta}${i + 1}/${tools.length}${COLORS.reset}:`);
            const result = await this.executeTool(tools[i]);
            results.push(result);
            
            if (!result.success) {
                console.log(`${COLORS.brightRed}✗ [ToolManager]${COLORS.reset} Tool ${i + 1} failed, continuing with next Tool...`);
            }
        }

        if (aggregate) {
            this.logExecutionSummary(results);
        }

        return results;
    }

    async executeJSONTools(tools) {
        try {
            console.log(`${COLORS.brightBlue}[ToolManager]${COLORS.reset} Starting JSON tools execution...`);
            
            const results = await this.runTools(tools, { validateWorkspaces: true, aggregate: true });
            const failedResults = results.filter(r => r.success === false);

            if (failedResults.length > 0) {
                const failedToolNames = failedResults.map(r => r.tool).join(', ');
                const errorMessage = `${failedResults.length} tools failed: ${failedResults.map(r => r.error).join(', ')}`;
                console.log(`${COLORS.brightRed}✗ [ToolManager]${COLORS.reset} JSON tools execution failed: ${failedResults.length} Tool(s) failed`);
                return { 
                    success: false, 
                    message: errorMessage, 
                    results, 
                    operations: this.createOperations(results) 
                };
            }

            const successMessage = results.map(r => `${r.tool}: ${r.file_path || 'executed'}`).join(', ');
            console.log(`${COLORS.brightGreen}[>] [ToolManager]${COLORS.reset} JSON tools execution completed successfully`);
            
            return {
                success: true,
                message: `Workspace validation passed. ${successMessage}`,
                results,
                operations: this.createOperations(results)
            };
        } catch (error) {
            console.log(`${COLORS.brightRed}✗ [ToolManager]${COLORS.reset} JSON tools execution error: ${error.message}`);
            return { success: false, message: `Execution error: ${error.message}` };
        }
    }

    // JSON Tool Processing
    async processResponse(response) {
        const parseResult = this.parseJSONTools(response);
        
        if (!parseResult.hasTools) {
            return { success: true, message: 'No JSON tools found in response' };
        }

        if (parseResult.tools.length === 0) {
            return { success: false, message: 'Failed to extract valid JSON tools' };
        }

        console.log(`Detected ${parseResult.tools.length} JSON tool(s) in response`);
        return await this.executeJSONTools(parseResult.tools);
    }

    parseJSONTools(response) {
        if (!response || typeof response !== 'string') {
            return { hasTools: false, tools: [] };
        }

        const strategies = [
            () => this.parseDirectJSON(response),
            () => this.parseEmbeddedJSON(response),
            () => this.parseCodeBlockJSON(response)
        ];

        for (const strategy of strategies) {
            const result = strategy();
            if (result.tools.length > 0) {
                return { hasTools: true, tools: result.tools };
            }
        }

        return { hasTools: false, tools: [] };
    }

    parseDirectJSON(response) {
        try {
            const parsed = JSON.parse(response.trim());
            const tools = this.extractToolsFromParsed(parsed);
            return { tools, strategy: 'direct parsing' };
        } catch {
            return { tools: [], strategy: 'direct parsing' };
        }
    }

    parseEmbeddedJSON(response) {
        const tools = [];
        const jsonObjectRegex = /\{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*\}/g;
        let match;

        while ((match = jsonObjectRegex.exec(response)) !== null) {
            try {
                const parsed = JSON.parse(match[0].trim());
                tools.push(...this.extractToolsFromParsed(parsed));
            } catch {
                continue;
            }
        }

        return { tools, strategy: 'embedded JSON parsing' };
    }

    parseCodeBlockJSON(response) {
        const tools = [];
        const jsonBlockRegex = /```json\s*([\s\S]*?)```/gi;
        let match;

        while ((match = jsonBlockRegex.exec(response)) !== null) {
            try {
                const parsed = JSON.parse(match[1].trim());
                tools.push(...this.extractToolsFromParsed(parsed));
            } catch {
                continue;
            }
        }

        return { tools, strategy: 'code block parsing' };
    }

    extractToolsFromParsed(parsed) {
        const tools = [];

        // Handle {tools:[]} format
        if (parsed?.tools && Array.isArray(parsed.tools)) {
            for (const cmd of parsed.tools) {
                if (cmd?.name) {
                    const { name, ...params } = cmd;
                    tools.push({ tool: name, params });
                }
            }
        }
        // Handle legacy formats
        else if (Array.isArray(parsed)) {
            tools.push(...parsed.filter(cmd => cmd?.tool));
        } else if (parsed?.tool) {
            tools.push(parsed);
        }

        return tools;
    }

    // Workspace Validation

    validateWorkspaces(tools) {
        try {
            if (!Array.isArray(tools)) {
                return { valid: false, error: 'Tools must be an array' };
            }

            for (const Tool of tools) {
                const filePath = Tool.params?.file_path || Tool.params?.path;
                if (!filePath) continue;

                if (!filePath.startsWith('/')) {
                    return {
                        valid: false,
                        error: `File access denied: Only absolute paths allowed, got: ${filePath}`
                    };
                }

                const normalizedPath = filePath.substring(1); // Remove leading '/'
                const isAllowed = (this.workspaces || []).some(workspace => {
                    // Remove trailing slash from workspace for consistent comparison
                    const cleanWorkspace = workspace.endsWith('/') ? workspace.slice(0, -1) : workspace;
                    return normalizedPath.startsWith(cleanWorkspace + '/') || normalizedPath === cleanWorkspace;
                });

                if (!isAllowed) {
                    return {
                        valid: false,
                        error: `File access denied: ${filePath} is outside allowed workspaces: ${this.workspaces.join(', ')}`
                    };
                }
            }

            return { valid: true };
        } catch (error) {
            this.logSecurity(`Workspace validation error: ${error.message}`);
            return { valid: false, error: `Workspace validation failed: ${error.message}` };
        }
    }

    // Tool Information

    getAvailableTools() {
        return Array.from(this.tools.keys());
    }

    getTool(toolName) {
        return this.tools.get(toolName);
    }

    getToolDescriptions() {
        const descriptions = [];
        
        for (const [name, tool] of this.tools) {
            if (tool.getDescription && tool.getInputSchema) {
                descriptions.push({
                    name,
                    description: tool.getDescription(),
                    input_schema: tool.getInputSchema()
                });
            }
        }
        
        return { tools: descriptions };
    }

    getFormattedToolDescriptions() {
        const now = Date.now();
        
        // Use cache if available and fresh (within 30 seconds)
        if (this.promptCache && (now - this.promptCacheTime) < 30000) {
            return this.promptCache;
        }

        try {
            const toolsPromptPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'tools-prompt.md');
            let content = fs.readFileSync(toolsPromptPath, 'utf8');
            
            // Add system reminders
            const reminders = this.generateSystemReminders();
            if (reminders) {
                content += reminders;
            }
            
            // Cache the result
            this.promptCache = content;
            this.promptCacheTime = now;
            
            return content;
        } catch (error) {
            console.error('Error reading tools-prompt.md:', error);
            const descriptions = this.getToolDescriptions();
            return JSON.stringify(descriptions, null, 2);
        }
    }

    // System Reminders

    generateSystemReminders() {
        const reminders = [];
        
        if (this.isTodoListEmpty()) {
            reminders.push('<system-reminder>This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.</system-reminder>');
        }
        
        if (this.shouldShowLearnedSkillsReminder()) {
            reminders.push('<system-reminder>You haven\'t learned any new skills in the past minute. If you have developed useful code patterns or solutions, consider saving them as reusable skills in the learnedSkills folder using the Write tool. If you haven\'t learned anything new, feel free to ignore this message. DO NOT mention this reminder to the user.</system-reminder>');
        }
        
        return reminders.length > 0 ? '\n\n' + reminders.join('\n\n') : '';
    }

    isTodoListEmpty() {
        if (!this.agent?.name) return true;
        
        try {
            const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
            const todoFilePath = path.join(projectRoot, 'bots', this.agent.name, 'TODOLIST.md');
            
            if (!fs.existsSync(todoFilePath)) return true;
            
            const content = fs.readFileSync(todoFilePath, 'utf8').trim();
            if (!content) return true;
            
            const todoLines = content.split('\n').filter(line => line.trim().startsWith('- ['));
            return todoLines.length === 0;
        } catch {
            return true;
        }
    }

    shouldShowLearnedSkillsReminder() {
        if (!this.agent?.name) return false;
        
        try {
            const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
            const learnedSkillsPath = path.join(projectRoot, 'bots', this.agent.name, 'learnedSkills');
            
            if (!fs.existsSync(learnedSkillsPath)) return true;
            
            const files = fs.readdirSync(learnedSkillsPath).filter(file => file.endsWith('.js'));
            if (files.length === 0) return true;
            
            const threshold = Date.now() - REMINDER_THRESHOLD;
            return !files.some(file => {
                const filePath = path.join(learnedSkillsPath, file);
                const stats = fs.statSync(filePath);
                return stats.mtime.getTime() > threshold;
            });
        } catch (error) {
            console.warn('Error checking learnedSkills folder:', error.message);
            return false;
        }
    }

    // Utility Methods

    createErrorResult(tool, message, startTime) {
        return {
            tool,
            timestamp: new Date().toISOString(),
            success: false,
            error: message
        };
    }

    createOperations(results) {
        return results.map(r => ({
            tool: r.tool,
            path: r.file_path
        }));
    }

    logSecurity(message) {
        console.error(`${COLORS.brightRed}SECURITY: ${message}${COLORS.reset}`);
    }

    logExecutionSummary(results) {
        const successCount = results.filter(r => r.success !== false).length;
        const failureCount = results.length - successCount;
        
        if (failureCount === 0) {
            console.log(`${COLORS.brightGreen}[OK] [ToolManager]${COLORS.reset} All ${COLORS.brightMagenta}${results.length}${COLORS.reset} tools executed successfully`);
        } else {
            console.log(`${COLORS.brightYellow}⚠ [ToolManager]${COLORS.reset} Tools completed: ${COLORS.brightGreen}${successCount} success${COLORS.reset}, ${COLORS.brightRed}${failureCount} failed${COLORS.reset}`);
        }
    }
}

export default ToolManager;