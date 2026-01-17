import OpenAIApi from 'openai';
import { getKey } from '../utils/keys.js';
import { GPT } from './gpt.js';

export class Mercury extends GPT {
    static prefix = 'mercury';
    constructor(model_name, url, params) {
        super(model_name, url, params);
    }

    initClient() {
        let config = {};
        config.baseURL = this.url || 'https://api.inceptionlabs.ai/v1';
        config.apiKey = getKey('MERCURY_API_KEY');
        this.openai = new OpenAIApi(config);
    }
}



