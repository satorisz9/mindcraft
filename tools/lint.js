import { readFile } from 'fs/promises';
import { ESLint } from "eslint";
import path from 'path';

/**
 * Lint Tool - Validates JavaScript code files for syntax and skill usage
 */
export class LintTool {
    constructor(agent = null) {
        this.name = 'Lint';
        this.description = "Validates JavaScript code files for syntax errors and skill usage.\n\nUsage:\n- The file_path parameter must be an absolute path to a .js file\n- Validates code syntax using ESLint\n- Checks for missing skill functions\n- Returns validation results with errors and executable files\n- Can validate single files or arrays of files";
        this.agent = agent;
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
            //console.log('=============Lint files1=============');
            // Determine which files to validate
            if (operations && Array.isArray(operations)) {
                //console.log('=============Lint files2=============');
                // Validate files from tool operations
                filesToValidate = operations
                    .filter(op => op.tool === 'Write' || op.tool === 'Edit' || op.tool === 'MultiEdit')
                    .map(op => op.path);
                //console.log('=============Files to validate:=============');
                console.log(filesToValidate);
            } else if (file_paths && Array.isArray(file_paths)) {
                //console.log('=============Lint files3=============');
                filesToValidate = file_paths;
            } else if (file_path) {
                //console.log('=============Lint files4=============');
                filesToValidate = [file_path];
            } else {
                throw new Error('[Lint Tool] Missing required parameter: file_path, file_paths, or operations');
            }
            //console.log('=============Lint files5=============');
            const errors = [];
            const executableFiles = [];
            //console.log('=============Lint files6=============');
            for (const filePath of filesToValidate) {
                //console.log('=============Lint files7=============');
                try {
                    //console.log('=============Lint files8=============');
                    // Validate file path is absolute
                    if (!path.isAbsolute(filePath)) {
                        errors.push(`${filePath}: File path must be absolute`);
                        continue;
                    }

                    // Read and validate file
                    const fileContent = await readFile(filePath, 'utf8');
                    //console.log('=============Lint files9=============');
                    const lintResult = await this._lintCode(fileContent, this.agent);
                    //console.log('=============Lint files10=============');
                    
                    if (lintResult) {
                        errors.push(`${filePath}: ${lintResult}`);
                    } else {
                        executableFiles.push(filePath);
                    }
                } catch (error) {
                    //console.log('=============Lint files11=============');
                    errors.push(`${filePath}: Failed to read file - ${error.message}`);
                }
            }
            //console.log('=============Lint files12=============');
            return {
                success: errors.length === 0,
                message: errors.length === 0 
                    ? `Successfully validated ${filesToValidate.length} file(s)`
                    : `Validation failed for ${errors.length} file(s)`,
                errors: errors,
                executableFiles: executableFiles,
                validatedCount: filesToValidate.length,
                action: 'lint'
            };

        } catch (error) {
            //console.log('=============Lint files13=============');
            return {
                success: false,
                message: `## Lint Tool Error ##\n**Error:** ${error.message}`
            };
        }
    }

    // Removed legacy code extraction and wrapping methods
    // Now supporting native ES6 modules directly

    /**
     * Lint JavaScript code for syntax and skill validation
     * @param {string} code - The code to validate
     * @param {Object} agent - The agent instance for skill validation
     * @returns {string|null} Error message or null if valid
     */
    async _lintCode(code) {
        let result = '#### CODE LINT ERROR INFO ###\n';
        
        try {
            // Lint the code directly without extraction or wrapping
            // Support native ES6 modules
            const originalCode = code.trim();
            
            // Extract skills and world function calls for validation
            const skillRegex = /(?:skills|world)\.(.*?)\(/g;
            const skills = [];
            let match;
            while ((match = skillRegex.exec(originalCode)) !== null) {
                skills.push(match[1]);
            }
            
            // Check if skills exist
            const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
            
            // allDocs is an array of documentation strings, each starting with 'skills.functionName' or 'world.functionName'
            const availableSkills = allDocs.map(doc => {
                const skillMatch = doc.match(/^skills\.(\w+)/);
                const worldMatch = doc.match(/^world\.(\w+)/);
                return skillMatch ? skillMatch[1] : (worldMatch ? worldMatch[1] : null);
            }).filter(Boolean);
            
            const missingSkills = skills.filter(skill => !availableSkills.includes(skill));
            if (missingSkills.length > 0) {
                result += '## Missing Functions ##\n';
                result += 'The following functions do not exist:\n';
                result += missingSkills.map(skill => `- ${skill}`).join('\n');
                console.log(result);
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
                                log: 'readonly'
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
