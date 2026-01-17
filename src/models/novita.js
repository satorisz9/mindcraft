import OpenAIApi from 'openai';
import { getKey } from '../utils/keys.js';
import { GPT } from './gpt.js';

// llama, mistral
export class Novita extends GPT {
	static prefix = 'novita';
	constructor(model_name, url, params) {
		super(model_name, url, params);
	}

	initClient() {
		let config = {
			baseURL: this.url || 'https://api.novita.ai/v3/openai'
		};
		config.apiKey = getKey('NOVITA_API_KEY');
		this.openai = new OpenAIApi(config);
	}

	async sendRequest(turns, systemMessage, stop_seq='<|EOT|>', tools=null) {
		let res = await super.sendRequest(turns, systemMessage, stop_seq, tools);
		
		// If it's a tool calling response, return directly without processing
		if (res.startsWith('{') && res.includes('_native_tool_calls')) {
			return res;
		}
		
		// Remove <think> blocks from text responses
		if (res.includes('<think>')) {
			let start = res.indexOf('<think>');
			let end = res.indexOf('</think>') + 8;
			if (start != -1) {
				if (end != -1) {
					res = res.substring(0, start) + res.substring(end);
				} else {
					res = res.substring(0, start+7);
				}
			}
			res = res.trim();
		}
		return res;
	}

	async embed(text) {
		throw new Error('Embeddings are not supported by Novita AI.');
	}
}
