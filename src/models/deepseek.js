import OpenAIApi from 'openai';
import { getKey } from '../utils/keys.js';
import { GPT } from './gpt.js';

export class DeepSeek extends GPT {
    static prefix = 'deepseek';
    constructor(model_name, url, params) {
        super(model_name, url, params);
    }

    initClient() {
        let config = {};
        config.baseURL = this.url || 'https://api.deepseek.com';
        config.apiKey = getKey('DEEPSEEK_API_KEY');
        this.openai = new OpenAIApi(config);
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by Deepseek.');
    }
}



