import fs from 'fs';
import path from 'path';

/**
 * TodoWrite Tool - Creates and manages structured task lists for coding sessions
 */
export class TodoWriteTool {
    constructor(agent = null) {
        this.name = 'TodoWrite';
        this.agent = agent;
        this.description = "Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user. It also helps the user understand the progress of the task and overall progress of their requests.";
        this.input_schema = {
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Task description"
                            },
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed"],
                                "description": "Task status"
                            },
                            "id": {
                                "type": "string",
                                "description": "Unique task identifier"
                            }
                        },
                        "required": ["content", "status", "id"],
                        "additionalProperties": false
                    },
                    "description": "The updated todo list"
                }
            },
            "required": ["todos"],
            "additionalProperties": false
        };
    }

    /**
     * Execute the TodoWrite tool
     * @param {Object} params - Tool parameters
     * @returns {Object} Execution result
     */
    execute(params) {
        let message = '';
        try {
            // Validate input
            if (!params.todos || !Array.isArray(params.todos)) {
                return {
                    success: false,
                    message: "todos parameter must be an array"
                };
            }

            // Validate each todo item
            for (const todo of params.todos) {
                if (!todo.content || !todo.status || !todo.id) {
                    return {
                        success: false,
                        message: "Each todo must have content, status, and id"
                    };
                }

                if (!["pending", "in_progress", "completed"].includes(todo.status)) {
                    return {
                        success: false,
                        message: `Invalid status: ${todo.status}. Must be pending, in_progress, or completed`
                    };
                }
            }

            // Check for multiple in_progress tasks
            const inProgressTasks = params.todos.filter(todo => todo.status === "in_progress");
            if (inProgressTasks.length > 1) {
                return {
                    success: false,
                    message: "Only one task can be in_progress at a time"
                };
            }

            // Generate markdown content
            const markdownContent = this.generateMarkdown(params.todos);

            // Determine file path
            const todoFilePath = this.getTodoFilePath();

            // Write to file
            const dir = path.dirname(todoFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(todoFilePath, markdownContent, 'utf8');

            // Generate summary
            const summary = this.generateSummary(params.todos);
            message = `TodoList updated successfully: ${summary}`;

            return {
                success: true,
                message: message
            };

        } catch (error) {
            return {
                success: false,
                message: `TodoWrite execution failed: ${error.message}`
            };
        }
    }

    /**
     * Generate markdown content from todos
     * @param {Array} todos - Array of todo items
     * @returns {string} Markdown content
     */
    generateMarkdown(todos) {
        let content = "# TODO LIST\n\n";
        
        const pendingTasks = todos.filter(todo => todo.status === "pending");
        const inProgressTasks = todos.filter(todo => todo.status === "in_progress");
        const completedTasks = todos.filter(todo => todo.status === "completed");

        if (inProgressTasks.length > 0) {
            content += "## In Progress\n";
            inProgressTasks.forEach(todo => {
                content += `- [x] **${todo.content}** (ID: ${todo.id})\n`;
            });
            content += "\n";
        }

        if (pendingTasks.length > 0) {
            content += "## Pending\n";
            pendingTasks.forEach(todo => {
                content += `- [ ] ${todo.content} (ID: ${todo.id})\n`;
            });
            content += "\n";
        }

        if (completedTasks.length > 0) {
            content += "## Completed\n";
            completedTasks.forEach(todo => {
                content += `- [x] ~~${todo.content}~~ (ID: ${todo.id})\n`;
            });
            content += "\n";
        }

        content += `\n---\n*Last updated: ${new Date().toISOString()}*\n`;
        
        return content;
    }

    /**
     * Generate summary of todo list changes
     * @param {Array} todos - Array of todo items
     * @returns {string} Summary text
     */
    generateSummary(todos) {
        const pendingCount = todos.filter(todo => todo.status === "pending").length;
        const inProgressCount = todos.filter(todo => todo.status === "in_progress").length;
        const completedCount = todos.filter(todo => todo.status === "completed").length;

        return `${pendingCount} pending, ${inProgressCount} in progress, ${completedCount} completed`;
    }

    /**
     * Get the todo file path based on agent configuration
     * @returns {string} File path for todo list
     */
    getTodoFilePath() {
        if (this.agent && this.agent.name) {
            return `/Users/quyi/AI-IDE/mindCraft/mindcraft/bots/${this.agent.name}/TODOLIST.md`;
        }
        return `/Users/quyi/AI-IDE/mindCraft/mindcraft/bots/default/TODOLIST.md`;
    }
}

export default TodoWriteTool;
