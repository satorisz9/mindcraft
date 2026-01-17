import { AzureOpenAI } from "openai";
import { getKey, hasKey } from '../utils/keys.js';
import { GPT } from './gpt.js'

export class AzureGPT extends GPT {
    static prefix = 'azure';
    constructor(model_name, url, params) {
        super(model_name, url, params);
        this.params = params || {};
        if (this.params.apiVersion) {
            delete this.params.apiVersion;
        }
    }

    initClient() {
        const config = {};
        if (this.url)
            config.endpoint = this.url;
        config.apiKey = hasKey('AZURE_OPENAI_API_KEY') ? getKey('AZURE_OPENAI_API_KEY') : getKey('OPENAI_API_KEY');
        config.deployment = this.model_name;
        if (this.params && this.params.apiVersion) {
            config.apiVersion = this.params.apiVersion;
        } else {
            throw new Error('apiVersion is required in params for azure!');
        }
        this.openai = new AzureOpenAI(config);
    }
    // Override sendRequest to set stop_seq default to null
    // Some Azure models (e.g., gpt-5-nano) do not support the 'stop' parameter
    async sendRequest(turns, systemMessage, stop_seq=null, tools=null) {
        return super.sendRequest(turns, systemMessage, stop_seq, tools);
    }
}