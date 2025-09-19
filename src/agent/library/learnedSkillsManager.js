import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * LearnedSkillsManager - 管理动态加载的learned-skills
 * 提供统一的技能访问接口，支持缓存和增量更新
 */
export class LearnedSkillsManager {
    constructor() {
        this.skillsCache = new Map(); // botName -> skills object
        this.docsCache = new Map();   // botName -> docs array
        this.lastModified = new Map(); // filePath -> timestamp
    }

    /**
     * 获取指定bot的所有learned-skills文件模块
     * @param {string} botName - bot名称
     * @returns {Promise<Array>} 技能文件模块数组 [{filePath, content, functionName}]
     */
    async getLearnedSkillsForBot(botName) {
        if (!botName) return [];

        const cacheKey = botName;
        const skillsPath = this._getSkillsPath(botName);
        
        // 检查缓存是否需要更新
        const needsUpdate = await this._needsCacheUpdate(skillsPath, cacheKey);
        
        if (!needsUpdate && this.skillsCache.has(cacheKey)) {
            return this.skillsCache.get(cacheKey);
        }

        // 加载技能文件模块
        const skillModules = await this._loadSkillModulesFromPath(skillsPath);
        this.skillsCache.set(cacheKey, skillModules);
        
        return skillModules;
    }

    /**
     * 检查技能是否存在
     * @param {string} botName - bot名称
     * @param {string} skillName - 技能名称
     * @returns {Promise<boolean>} 技能是否存在
     */
    async hasSkill(botName, skillName) {
        const skillModules = await this.getLearnedSkillsForBot(botName);
        return skillModules.some(module => module.functionName === skillName);
    }

    /**
     * 获取技能文档用于prompt生成
     * @param {string} botName - bot名称
     * @returns {Promise<Array>} 文档数组
     */
    async getSkillDocs(botName) {
        if (!botName) return [];

        const cacheKey = botName;
        const skillsPath = this._getSkillsPath(botName);
        
        // 检查缓存是否需要更新
        const needsUpdate = await this._needsCacheUpdate(skillsPath, cacheKey);
        
        if (!needsUpdate && this.docsCache.has(cacheKey)) {
            return this.docsCache.get(cacheKey);
        }

        // 提取文档
        const docs = await this._extractDocsFromPath(skillsPath);
        this.docsCache.set(cacheKey, docs);
        
        return docs;
    }

    /**
     * 验证技能文件内容
     * @param {string} content - 文件内容
     * @returns {Object} {valid: boolean, error?: string}
     */
    validateSkillContent(content) {
        try {
            // 1. Export function check
            if (!content.includes('export async function')) {
                return { valid: false, error: 'Skill file must export async function' };
            }
            
            // 2. Security check - forbid dangerous operations
            const forbidden = [
                'require(',
                'eval(',
                '__dirname',
                '__filename',
                'process.exit',
                'fs.writeFile',
                'fs.unlink'
            ];
            
            for (const pattern of forbidden) {
                if (content.includes(pattern)) {
                    return { valid: false, error: `Skill code forbidden to use: ${pattern}` };
                }
            }
            
            // 3. Basic syntax check - simple brace matching
            const openBraces = (content.match(/\{/g) || []).length;
            const closeBraces = (content.match(/\}/g) || []).length;
            if (openBraces !== closeBraces) {
                return { valid: false, error: 'Syntax error: unmatched braces' };
            }
            
            return { valid: true };
        } catch (error) {
            return { valid: false, error: `Validation error: ${error.message}` };
        }
    }

    /**
     * Clear cache for specified bot
     * @param {string} botName - bot name
     */
    clearCache(botName) {
        if (botName) {
            this.skillsCache.delete(botName);
            this.docsCache.delete(botName);
        } else {
            this.skillsCache.clear();
            this.docsCache.clear();
            this.lastModified.clear();
        }
    }

    // ========== Private Methods ==========

    /**
     * Get skills folder path
     * @param {string} botName - bot name
     * @returns {string} skills folder path
     */
    _getSkillsPath(botName) {
        const projectRoot = path.resolve(__dirname, '../../..');
        return path.join(projectRoot, 'bots', botName, 'learned-skills');
    }

    /**
     * Check if cache needs update
     * @param {string} skillsPath - skills folder path
     * @param {string} cacheKey - cache key
     * @returns {Promise<boolean>} whether update is needed
     */
    async _needsCacheUpdate(skillsPath, cacheKey) {
        try {
            const files = await this._getSkillFiles(skillsPath);
            
            for (const file of files) {
                const filePath = path.join(skillsPath, file);
                const stats = await fs.stat(filePath);
                const lastMod = this.lastModified.get(filePath);
                
                if (!lastMod || stats.mtime.getTime() > lastMod) {
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            // If folder doesn't exist or other errors, need to update
            return true;
        }
    }

    /**
     * Load all skill modules from path
     * @param {string} skillsPath - skills folder path
     * @returns {Promise<Array>} skill modules array
     */
    async _loadSkillModulesFromPath(skillsPath) {
        const skillModules = [];
        
        try {
            const files = await this._getSkillFiles(skillsPath);
            
            for (const file of files) {
                const filePath = path.join(skillsPath, file);
                
                try {
                    const content = await fs.readFile(filePath, 'utf8');
                    
                    // Validate file content
                    const validation = this.validateSkillContent(content);
                    if (!validation.valid) {
                        console.warn(`Skipping invalid skill file ${file}: ${validation.error}`);
                        continue;
                    }
                    
                    // Extract function name
                    const functionMatch = content.match(/export\s+async\s+function\s+(\w+)/);
                    if (!functionMatch) {
                        console.warn(`No exported function found in ${file}`);
                        continue;
                    }
                    
                    const functionName = functionMatch[1];
                    
                    skillModules.push({
                        filePath,
                        content,
                        functionName
                    });
                    
                    // Update file modification time
                    const stats = await fs.stat(filePath);
                    this.lastModified.set(filePath, stats.mtime.getTime());
                    
                } catch (error) {
                    console.warn(`Failed to load skill file ${file}: ${error.message}`);
                }
            }
        } catch (error) {
            console.log(`learned-skills folder doesn't exist or inaccessible: ${skillsPath}`);
        }
        
        return skillModules;
    }

    /**
     * Get skill file list
     * @param {string} skillsPath - skills folder path
     * @returns {Promise<Array>} filename array
     */
    async _getSkillFiles(skillsPath) {
        try {
            const files = await fs.readdir(skillsPath);
            return files.filter(file => file.endsWith('.js'));
        } catch (error) {
            return [];
        }
    }


    /**
     * Extract documentation from path
     * @param {string} skillsPath - skills folder path
     * @returns {Promise<Array>} documentation array
     */
    async _extractDocsFromPath(skillsPath) {
        const docs = [];
        
        try {
            const files = await this._getSkillFiles(skillsPath);
            
            for (const file of files) {
                const filePath = path.join(skillsPath, file);
                
                try {
                    const content = await fs.readFile(filePath, 'utf8');
                    
                    // Extract JSDoc comments as documentation
                    const docContent = this._extractDocFromContent(content, file);
                    if (docContent) {
                        docs.push(docContent);
                    }
                } catch (error) {
                    console.warn(`Failed to extract documentation ${file}: ${error.message}`);
                }
            }
        } catch (error) {
            // Folder doesn't exist, return empty array
        }
        
        return docs;
    }

    /**
     * Extract documentation from file content
     * @param {string} content - file content
     * @param {string} fileName - file name
     * @returns {string|null} extracted documentation
     */
    _extractDocFromContent(content, fileName) {
        try {
            // Extract JSDoc comment
            const jsdocMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
            
            // Extract function signature
            const functionMatch = content.match(/export async function (\w+)\([^)]*\)/);
            
            if (!functionMatch) return null;
            
            const functionName = functionMatch[1];
            const functionSignature = functionMatch[0];
            
            let doc = `learnedSkills.${functionName}\n${functionSignature}`;
            
            if (jsdocMatch) {
                // Clean JSDoc comments
                const cleanDoc = jsdocMatch[1]
                    .replace(/^\s*\*/gm, '') // Remove leading *
                    .replace(/^\s+/gm, '')   // Remove leading spaces
                    .trim();
                
                doc += `\n${cleanDoc}`;
            }
            
            return doc;
        } catch (error) {
            console.warn(`Failed to extract documentation ${fileName}: ${error.message}`);
            return null;
        }
    }
}

export default LearnedSkillsManager;
