import { readFile } from 'fs/promises';
import { ESLint } from "eslint";
import path from 'path';
import { LearnedSkillsManager } from '../src/agent/library/learnedSkillsManager.js';

/**
 * Lint Tool - Validates JavaScript code files for syntax and skill usage
 */
export class LintTool {
    constructor(agent = null) {
        this.name = 'Lint';
        this.description = "Validates JavaScript code files for syntax errors and skill usage.\n\nUsage:\n- The file_path parameter must be an absolute path to a .js file\n- Validates code syntax using ESLint\n- Checks for missing skill functions including learned skills\n- Returns validation results with errors and executable files\n- Can validate single files or arrays of files";
        this.agent = agent;
        this.learnedSkillsManager = new LearnedSkillsManager();
        this.input_schema = {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The absolute path to the JavaScript file to validate"
                },
                "file_paths": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "description": "Array of absolute paths to JavaScript files to validate"
                },
                "operations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "tool": {"type": "string"},
                            "path": {"type": "string"}
                        }
                    },
                    "description": "Array of tool operations to validate (from ToolManager results)"
                }
            },
            "additionalProperties": false,
            "$schema": "http://json-schema.org/draft-07/schema#"
        };
        this.code_lint_template = null;
        this._loadLintTemplate();
    }

    /**
     * Load lint template for code validation
     */
    async _loadLintTemplate() {
        try {
            this.code_lint_template = await readFile('./bots/lintTemplate.js', 'utf8');
        } catch (err) {
            console.error('Failed to load lintTemplate.js:', err);
            throw new Error('[Lint Tool] lintTemplate.js file is required but could not be loaded');
        }
    }

    getDescription() {
        return this.description;
    }

    getInputSchema() {
        return this.input_schema;
    }

    /**
     * Validate JavaScript files
     * @param {Object} params - The validation parameters
     * @param {string} [params.file_path] - Single file path to validate
     * @param {Array} [params.file_paths] - Array of file paths to validate
     * @param {Array} [params.operations] - Tool operations to validate
     * @returns {Object} Validation result
     */
    async execute(params) {
        try {
            const { file_path, file_paths, operations } = params;
            
            let filesToValidate = [];
            // Determine which files to validate
            if (operations && Array.isArray(operations)) {
                // Validate files from tool operations
                filesToValidate = operations
                    .filter(op => op.tool === 'Write' || op.tool === 'Edit' || op.tool === 'MultiEdit')
                    .map(op => op.path);
                console.log(filesToValidate);
            } else if (file_paths && Array.isArray(file_paths)) {
                filesToValidate = file_paths;
            } else if (file_path) {
                filesToValidate = [file_path];
            } else {
                throw new Error('[Lint Tool] Missing required parameter: file_path, file_paths, or operations');
            }
            const errors = [];
            const executableFiles = [];
            for (const filePath of filesToValidate) {
                try {
                    // Validate file path is absolute
                    if (!path.isAbsolute(filePath)) {
                        errors.push(`${filePath}: File path must be absolute`);
                        continue;
                    }

                    // Read and validate file
                    const fileContent = await readFile(filePath, 'utf8');
                    const lintResult = await this._lintCode(fileContent, this.agent);
                    
                    if (lintResult) {
                        errors.push(`${filePath}: ${lintResult}`);
                    } else {
                        executableFiles.push(filePath);
                    }
                } catch (error) {
                    errors.push(`${filePath}: Failed to read file - ${error.message}`);
                }
            }
            let message;
            if (errors.length === 0) {
                message = `## Lint Validation Success ##\nSuccessfully validated ${filesToValidate.length} file(s)\n\nExecutable files:\n${executableFiles.map(f => `- ${f}`).join('\n')}`;
            } else {
                message = `## Lint Validation Failed ##\nValidation failed for ${errors.length} file(s)\n\nErrors:\n${errors.map(e => `- ${e}`).join('\n')}`;
                if (executableFiles.length > 0) {
                    message += `\n\nValid files:\n${executableFiles.map(f => `- ${f}`).join('\n')}`;
                }
            }

            return {
                success: errors.length === 0,
                message: message,
                errors: errors,
                executableFiles: executableFiles,
                validatedCount: filesToValidate.length,
                action: 'lint'
            };

        } catch (error) {
            return {
                success: false,
                message: `## Lint Tool Error ##\n**Error:** ${error.message}`
            };
        }
    }


    /**
     * Lint JavaScript code for syntax and skill validation
     * @param {string} code - The code to validate
     * @param {Object} agent - The agent instance for skill validation
     * @returns {string|null} Error message or null if valid
     */
    async _lintCode(code) {
        let result = '\n#### CODE LINT ERROR INFO ###\n';
        
        try {
            // Lint the code directly without extraction or wrapping
            // Support native ES6 modules
            const originalCode = code.trim();
            
            // Extract skills, world, and learnedSkills function calls for validation
            const skillRegex = /(?:skills|world)\.(.*?)\(/g;
            const learnedSkillRegex = /learnedSkills\.(.*?)\(/g;
            const skills = [];
            const learnedSkillCalls = [];
            let match;
            
            // Extract skills.* and world.* calls
            while ((match = skillRegex.exec(originalCode)) !== null) {
                skills.push(match[1]);
            }
            
            // Extract learnedSkills.* calls
            while ((match = learnedSkillRegex.exec(originalCode)) !== null) {
                learnedSkillCalls.push(match[1]);
            }
            
            // Check if core skills exist
            const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
            
            // allDocs is an array of documentation strings, each starting with 'skills.functionName' or 'world.functionName'
            const availableSkills = allDocs.map(doc => {
                const skillMatch = doc.match(/^skills\.(\w+)/);
                const worldMatch = doc.match(/^world\.(\w+)/);
                return skillMatch ? skillMatch[1] : (worldMatch ? worldMatch[1] : null);
            }).filter(Boolean);
            
            let missingSkills = skills.filter(skill => !availableSkills.includes(skill));
            
            // Check if learned skills exist
            const missingLearnedSkills = [];
            if (learnedSkillCalls.length > 0 && this.agent && this.agent.name) {
                for (const skillName of learnedSkillCalls) {
                    const exists = await this.learnedSkillsManager.hasSkill(this.agent.name, skillName);
                    if (!exists) {
                        missingLearnedSkills.push(`learnedSkills.${skillName}`);
                    }
                }
            }
            
            // Combine all missing skills
            const allMissingSkills = [...missingSkills, ...missingLearnedSkills];
            if (allMissingSkills.length > 0) {
                result += '## Missing Functions ##\n';
                result += 'The following functions do not exist:\n';
                result += allMissingSkills.map(skill => `- ${skill}`).join('\n');
                
                // Only show relevant skills for core skills (not learned skills)
                if (missingSkills.length > 0) {
                    result += '\n##Relevant skills:\n' + await this.agent.prompter.skill_libary.getRelevantSkillDocs(missingSkills.map(skill => `- ${skill}`).join('\n'), 2) + '\n';
                }
                
                // Show available learned skills if there are missing learned skills
                if (missingLearnedSkills.length > 0) {
                    const availableLearnedSkills = await this.learnedSkillsManager.getLearnedSkillsForBot(this.agent.name);
                    const skillNames = Object.keys(availableLearnedSkills);
                    if (skillNames.length > 0) {
                        result += '\n##Available learned skills:\n';
                        result += skillNames.map(name => `- learnedSkills.${name}`).join('\n') + '\n';
                    } else {
                        result += '\n##No learned skills available. Create skills in learnedSkills folder first.\n';
                    }
                }
                
                return result;
            }

            // Configure ESLint for ES6 modules using flat config format
            const eslint = new ESLint({
                overrideConfigFile: true,
                overrideConfig: [
                    {
                        languageOptions: {
                            ecmaVersion: 2022,
                            sourceType: 'module',
                            globals: {
                                // Node.js globals
                                global: 'readonly',
                                process: 'readonly',
                                Buffer: 'readonly',
                                console: 'readonly',
                                // Bot-specific globals
                                bot: 'readonly',
                                skills: 'readonly',
                                world: 'readonly',
                                Vec3: 'readonly',
                                log: 'readonly',
                                learnedSkills: 'readonly'
                            }
                        },
                        rules: {
                            // Allow import/export at top level
                            'no-unused-vars': 'off',
                            'no-undef': 'off'
                        }
                    }
                ]
            });
            
            const results = await eslint.lintText(originalCode);
            const originalCodeLines = originalCode.split('\n');
            const exceptions = results.map(r => r.messages).flat();

            if (exceptions.length > 0) {
                exceptions.forEach((exc, index) => {
                    if (exc.line && exc.column) {
                        const errorLine = originalCodeLines[exc.line - 1]?.trim() || 'Unable to retrieve error line content';
                        result += `**Line ${exc.line}, Column ${exc.column}:** ${exc.message}\n`;
                        result += `Code: \`${errorLine}\`\n`;
                        if (exc.severity === 2) {
                            result += `Severity: Error\n\n`;
                        }
                    } else {
                        result += `**${exc.message}**\n`;
                        if (exc.severity === 2) {
                            result += `Severity: Error\n\n`;
                        }
                    }
                });
                result += 'The code contains exceptions and cannot continue execution.';
            } else {
                return null; // no error
            }

            return result;
        } catch (error) {
            console.error('Lint code error:', error);
            return `#### CODE ERROR INFO ###\nLint processing failed: ${error.message}`;
        }
    }
}

export default LintTool;
