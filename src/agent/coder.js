import { readFile, writeFile } from 'fs/promises';
import { makeCompartment, lockdown } from './library/lockdown.js';
import * as skills from './library/skills.js';
import * as world from './library/world.js';
import { Vec3 } from 'vec3';
import { ESLint } from "eslint";
import { PatchApplier } from './patch_applier.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class Coder {
    constructor(agent) {
        this.agent = agent;
        this.patchApplier = new PatchApplier(agent);
        this.code_lint_template = null;
        this._loadLintTemplate();
    }
    
    async _loadLintTemplate() {
        try {
            this.code_lint_template = await readFile('./bots/lintTemplate.js', 'utf8');
        } catch (err) {
            console.error('Failed to load lintTemplate.js:', err);
            throw new Error('lintTemplate.js file is required but could not be loaded');
        }
    }

    async generateCode(agent_history) {
        this.agent.bot.modes.pause('unstuck');
        lockdown();
        
        let messages = agent_history.getHistory();
        messages.push({
            role: 'system', 
            content: 'Code generation started. Use patch format to write code. Remember: strict workspace restrictions are enforced.'
        });

        const MAX_ATTEMPTS = 1;

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            if (this.agent.bot.interrupt_code) return null;

            try {
                const response = await this.agent.prompter.promptCoding(messages);
                console.log('=============================');
                console.log('Response:', response);
                console.log('=============================');
                if (!this.patchApplier.isPatchResponse(response)) {
                    console.log('Response is not in patch format. Please use the required patch syntax with proper workspace paths.');
                    messages.push({
                        role: 'system',
                        content: 'Response is not in patch format. Please use the required patch syntax with proper workspace paths.'
                    });
                    continue;
                }

                const patchContent = this.patchApplier.extractPatchFromResponse(response);
                
                // Double security check before applying
                const preValidation = this.patchApplier.validatePatchWorkspaces(patchContent);
                if (!preValidation.valid) {
                    console.log('SECURITY: Workspace violation detected. You can only modify files in: ' + this.patchApplier.allowedWorkspaces.join(', '));
                    messages.push({
                        role: 'system',
                        content: `SECURITY: Workspace violation detected. You can only modify files in: ${this.patchApplier.allowedWorkspaces.join(', ')}`
                    });
                    continue;
                }
                
                const patchResult = await this.patchApplier.applyPatch(patchContent, '.');
                
                if (!patchResult.success) {
                    console.log('Patch application failed: ' + patchResult.message);
                    messages.push({
                        role: 'system',
                        content: `Patch application failed: ${patchResult.message}`
                    });
                    continue;
                }

                const validationResult = await this.validateGeneratedCode(patchResult.operations);
                if (!validationResult.success) {
                    console.log('Code validation failed: ' + validationResult.errors.join('\n'));
                    messages.push({
                        role: 'system',
                        content: `Code validation failed:\n${validationResult.errors.join('\n')}`
                    });
                    continue;
                }

                // Filter executable files to only include action-code files
                const actionCodePath = path.normalize(`bots/${this.agent.name}/action-code`);
                const executableActionFiles = validationResult.executableFiles.filter(file => {
                    const normalizedFile = path.normalize(file);
                    return normalizedFile.startsWith(actionCodePath + path.sep) || 
                           normalizedFile === actionCodePath;
                });

                // Generate operation summary for reporting
                const operationSummary = patchResult.operations.map(op => 
                    `${op.operation}: ${op.path}`
                ).join(', ');

                // Check if we have action-code files to execute
                if (executableActionFiles.length === 0) {
                    console.log('No executable action-code files found. Code validation completed but no execution needed.');
                    return `Code files created/updated successfully: ${operationSummary}. No action-code files to execute.`;
                }else{
                    // Execute action-code files
                    const executionResult = await this.executeCode(executableActionFiles);
                    if (executionResult.success) {
                        console.log('Code executed successfully from ' + executableActionFiles.join(', '));
                        return `${operationSummary}. ${executionResult.summary}`;
                    } else {
                        console.log('Code execution failed: ' + executionResult.errorMessage);
                        messages.push({
                            role: 'assistant',
                            content: response
                        });
                        messages.push({
                            role: 'system',
                            content: `Code execution failed: ${executionResult.errorMessage}`
                        });
                    }                    
                }
            } catch (error) {
                messages.push({
                    role: 'system',
                    content: `Code generation error: ${error.message}`
                });
                console.warn(`SECURITY: Attempt ${i + 1} failed: ${error.message}`);
            }
        }

        return `Code generation failed after ${MAX_ATTEMPTS} attempts.`;
    }

    async validateGeneratedCode(operations) {
        const errors = [];
        const executableFiles = [];

        for (const op of operations) {
            if (op.operation === 'Add' || op.operation === 'Update') {
                try {
                    const fileContent = await readFile(op.path, 'utf8');
                    const lintResult = await this._lintCode(fileContent);
                    
                    if (lintResult) {
                        errors.push(`${op.path}: ${lintResult}`);
                    } else {
                        executableFiles.push(op.path);
                    }
                } catch (error) {
                    errors.push(`${op.path}: Failed to read file - ${error.message}`);
                }
            }
        }

        return {
            success: errors.length === 0,
            errors: errors,
            executableFiles: executableFiles
        };
    }

    async executeCode(executableFiles) {
        const mainFile = executableFiles.find(f => f.includes('action-code'));
        if (!mainFile) {
            return {
                success: false,
                errorMessage: 'No executable action-code file found'
            };
        }

        try {
            const fileContent = await readFile(mainFile, 'utf8');
            
            const compartment = makeCompartment({
                skills,
                log: skills.log,
                world,
                Vec3,
            });

            // Check if it's IIFE format (action-code) or module format (learned-skills)
            const content = fileContent.trim();
            const isIIFE = content.match(/^\(async\s*\(\s*bot\s*\)\s*=>\s*\{[\s\S]*?\}\)$/m);
            
            if (isIIFE) {
                // Execute IIFE directly
                const iifeFunction = compartment.evaluate(content);
                await iifeFunction(this.agent.bot);
            } else {
                // Execute as module (for learned-skills)
                const executionModule = compartment.evaluate(fileContent);
                if (executionModule.main) {
                    await executionModule.main(this.agent.bot);
                } else {
                    // If it's a skill function, we can't execute it directly
                    throw new Error('Skill functions cannot be executed directly. They should be called from action-code.');
                }
            }
            
            const code_output = this.agent.actions.getBotOutputSummary();
            return {
                success: true,
                summary: `Code executed successfully from ${mainFile}\nOutput: ${code_output}`
            };
        } catch (error) {
            return {
                success: false,
                errorMessage: `Execution error: ${error.message}`
            };
        }
    }
    
    /**
     * Extract user code from execTemplate format
     * Handles both IIFE format: (async (bot) => { ... }) and module format
     */
    _extractUserCode(fileContent) {
        // Remove any leading/trailing whitespace
        const content = fileContent.trim();
        
        // Check if it's IIFE format (action-code)
        const iifeMatch = content.match(/^\(async\s*\(\s*bot\s*\)\s*=>\s*\{([\s\S]*?)\}\)$/m);
        if (iifeMatch) {
            return iifeMatch[1].trim();
        }
        
        // Check if it's module format (learned-skills)
        const moduleMatch = content.match(/^async\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*module\.exports/m);
        if (moduleMatch) {
            return moduleMatch[1].trim();
        }
        
        // If no specific format detected, return as-is
        return content;
    }
    
    /**
     * Wrap extracted user code in lintTemplate format for validation
     */
    _wrapCodeForLinting(userCode) {
        if (!this.code_lint_template) {
            throw new Error('Lint template not loaded yet');
        }
        
        // Replace the /* CODE HERE */ placeholder with the user code
        const indentedUserCode = userCode.split('\n').map(line => '    ' + line).join('\n');
        const lintTemplate = this.code_lint_template.replace('/* CODE HERE */', indentedUserCode);
        
        return lintTemplate;
    }

    async _lintCode(code) {
        let result = '#### CODE ERROR INFO ###\n';
        
        // Extract user code from execTemplate format
        const userCode = this._extractUserCode(code);
        
        // Ensure lint template is loaded
        if (!this.code_lint_template) {
            await this._loadLintTemplate();
        }
        
        // Wrap in lintTemplate format for validation
        const lintableCode = this._wrapCodeForLinting(userCode);
        
        //------- TODO: remove this,just for debug -------
        // Save the lintable code to bot's action-code directory for debugging
        const botName = this.agent.name;
        const debugFilePath = path.join(__dirname, '../../bots', botName, 'action-code', 'debug_lint_template.js');
        try {
            await writeFile(debugFilePath, lintableCode);
            console.log('Lint template code written to file: ' + debugFilePath);
        } catch (err) {
            console.error('Failed to write debug lint template:', err);
        }
        //------- TODO: remove this,just for debug -------

        // Check skill functions
        const skillRegex = /(?:skills|world)\.(.*?)\(/g;
        const skillsUsed = [];
        let match;
        while ((match = skillRegex.exec(userCode)) !== null) {
            skillsUsed.push(match[1]);
        }
        
        const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
        // console.log('$$_lintCode: All docs: ' + JSON.stringify(allDocs));
        const missingSkills = skillsUsed.filter(skill => !!allDocs[skill]);
        // console.log('$$_lintCode: Missing skills: ' + JSON.stringify(missingSkills));
        if (missingSkills.length > 0) {
            result += 'These functions do not exist.\n';
            result += '### FUNCTIONS NOT FOUND ###\n';
            result += missingSkills.join('\n');
            console.log('$$_lintCode: ' + result);
            return result;
        }

        // ESLint check on wrapped code
        const eslint = new ESLint();
        const results = await eslint.lintText(lintableCode);
        const codeLines = lintableCode.split('\n');
        const exceptions = results.map(r => r.messages).flat();

        if (exceptions.length > 0) {
            exceptions.forEach((exc, index) => {
                if (exc.line && exc.column) {
                    const errorLine = codeLines[exc.line - 1]?.trim() || 'Unable to retrieve error line content';
                    result += `#ERROR ${index + 1}\n`;
                    result += `Message: ${exc.message}\n`;
                    result += `Location: Line ${exc.line}, Column ${exc.column}\n`;
                    result += `Related Code Line: ${errorLine}\n`;
                }
            });
            result += 'The code contains exceptions and cannot continue execution.';
            return result;
        }

        return null; // no error
    }
}