import { ToolManager } from '../../tools/toolManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class Coder {
    constructor(agent) {
        this.agent = agent;
        this.codeToolsManager = new ToolManager(agent);
    }

    async generateCode(agent_history) {
        console.log('### Generating code...');
        this.agent.bot.modes.pause('unstuck');
        // this message history is transient and only maintained in this function
        let messages = agent_history.getHistory();

        const MAX_ATTEMPTS = 5;

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            if (this.agent.bot.interrupt_code) return null;

            try {
                const response = await this.agent.prompter.promptCoding(messages);
                messages.push({
                    role: 'assistant',
                    content: response
                });
                //console.log('=============================');
                console.log('Response:', response);
                //console.log('=============================');
                
                // Check if response is in JSON tool format
                if (!this.codeToolsManager.isJSONToolResponse(response)) {
                    console.log('Response is not in JSON tool format. Please use JSON tool command format.');
                    messages.push({
                        role: 'user',
                        content: 'Response is not in JSON tool format. Please use JSON tool command format as described above.'
                    });
                    console.log('1=============================messages :\n', messages);

                    continue;
                }
                //console.log('=============coder.js file1=============');    
                // Process JSON tool commands
                const toolResult = await this.codeToolsManager.processResponse(response);
                //console.log('=============coder.js file2============='); 
                if (!toolResult.success) {
                    console.log('\x1b[31mJSON tool execution failed: ' + toolResult.message + '\x1b[0m');
                    
                    // 构建详细的错误信息
                    let detailedError = `##JSON tool execution failed##\nPlease check command format and parameters.\n${toolResult.message}`;
                    
                    // 如果有具体的工具执行结果，添加详细信息
                    if (toolResult.results && toolResult.results.length > 0) {
                        detailedError += '\n\nDetailed tool results:';
                        toolResult.results.forEach((result, index) => {
                            detailedError += `\n- Tool ${index + 1} (${result.tool}): `;
                            if (result.success === false) {
                                detailedError += `FAILED - ${result.error || result.message || 'Unknown error'}`;
                                if (result.summary) {
                                    detailedError += `\nSummary: ${result.summary}`;
                                }
                                // 添加完整的错误消息，包括堆栈信息
                                if (result.message && result.message.includes('## Code Executing Error ##')) {
                                    detailedError += `\nFull Error Details:\n${result.message}`;
                                }
                            } else {
                                detailedError += `SUCCESS`;
                            }
                        });
                    }
                    
                    messages.push({
                        role: 'user',
                        content: detailedError
                    });
                    console.log('2=============================messages :\n', messages);
                    continue;
                }
                //console.log('=============coder.js file3============='); 
                // Filter files to only include action-code files for execution
                const actionCodePath = path.normalize(`bots/${this.agent.name}/action-code`);
                const executableActionFiles = toolResult.operations
                    .filter(op => op.tool === 'Write' || op.tool === 'Edit' || op.tool === 'MultiEdit')
                    .map(op => op.path)
                    .filter(file => {
                        const normalizedFile = path.normalize(file);
                        return normalizedFile.startsWith(actionCodePath + path.sep) || 
                               normalizedFile === actionCodePath;
                    });
                    //console.log('=============coder.js file4============='); 
                // Generate operation summary for reporting
                const operationSummary = toolResult.operations.map(op => 
                    `${op.tool}: ${op.path}`
                ).join(', ');
                //console.log('=============coder.js file5============='); 
                // Execute action-code files using Execute tool
                const executionResult = await this.codeToolsManager.executeJSONCommands([{
                    tool: 'Execute',
                    params: {
                        executable_files: executableActionFiles,
                        description: 'Execute generated action-code'
                    }
                }]);
                //console.log('=============coder.js file6============='); 
                if (executionResult.success) {
                    //console.log('=============coder.js file7============='); 
                    console.log('Code execution completed successfully');
                    console.log( `${operationSummary}. ${executionResult.results[0].summary || 'Code executed successfully'}`);
                    return `${operationSummary}. ${executionResult.results[0].summary || 'Code executed successfully'}`;
                } else {
                    console.log('Code execution failed: ' + executionResult.message);
                    //console.log('=============coder.js file8============='); 
                    
                    // 构建详细的执行失败信息
                    let detailedExecutionError = `Code execution failed: ${executionResult.message}`;
                    
                    // 如果有具体的执行结果，添加详细信息
                    if (executionResult.results && executionResult.results.length > 0) {
                        detailedExecutionError += '\n\nDetailed execution results:';
                        executionResult.results.forEach((result, index) => {
                            detailedExecutionError += `\n- Execution ${index + 1} (${result.tool}): `;
                            if (result.success === false) {
                                detailedExecutionError += `FAILED - ${result.error || result.message || 'Unknown error'}`;
                                if (result.summary) {
                                    detailedExecutionError += `\nSummary: ${result.summary}`;
                                }
                                // 添加完整的执行错误信息，包括堆栈跟踪
                                if (result.message && result.message.includes('## Code Executing Error ##')) {
                                    detailedExecutionError += `\nFull Execution Error Details:\n${result.message}`;
                                }
                            } else {
                                detailedExecutionError += `SUCCESS`;
                            }
                        });
                    }
                    
                    messages.push({
                        role: 'assistant',
                        content: response
                    });
                    messages.push({
                        role: 'user',
                        content: detailedExecutionError
                    });
                    console.log('3=============================messages :\n', messages);
                }
            } catch (error) {
                messages.push({
                    role: 'user',
                    content: `Code generation error: ${error.message}`
                });
                console.log('4=============================messages :\n', messages);
                console.warn(`Security check: Attempt ${i + 1} failed: ${error.message}`);
            }
        }

        return `Code generation failed after ${MAX_ATTEMPTS} attempts.`;
    }


}