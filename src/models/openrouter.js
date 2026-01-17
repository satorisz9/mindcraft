import OpenAIApi from 'openai';
import { getKey } from '../utils/keys.js';
import { GPT } from './gpt.js';

export class OpenRouter extends GPT {
    static prefix = 'openrouter';
    constructor(model_name, url, params) {
        super(model_name, url, params);
    }

    initClient() {
        let config = {};
        config.baseURL = this.url || 'https://openrouter.ai/api/v1';
        const apiKey = getKey('OPENROUTER_API_KEY');
        if (!apiKey) {
            console.error('Error: OPENROUTER_API_KEY not found. Make sure it is set properly.');
        }
        config.apiKey = apiKey;
        this.openai = new OpenAIApi(config);
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by Openrouter.');
    }
}