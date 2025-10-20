import Replicate from 'replicate';
import { toSinglePrompt } from '../utils/text.js';
import { getKey } from '../utils/keys.js';

// llama, mistral
export class ReplicateAPI {
	static prefix = 'replicate';
	constructor(model_name, url, params) {
		this.model_name = model_name;
		this.url = url;
		this.params = params;

		if (this.url) {
			console.warn('Replicate API does not support custom URLs. Ignoring provided URL.');
		}

		this.replicate = new Replicate({
			auth: getKey('REPLICATE_API_KEY'),
		});
	}

	async sendRequest(turns, systemMessage, stop_seq = '<|EOT|>', tools=null) {
		let model_name = this.model_name || 'meta/meta-llama-3-70b-instruct';

		// If tools are provided, use non-streaming API for tool calling
		if (tools && Array.isArray(tools) && tools.length > 0) {
			console.log(`Using tool calling with ${tools.length} tools`);
			console.log('Awaiting Replicate API response with tool calling...');
			
			try {
				const messages = [
					{ role: "system", content: systemMessage },
					...turns
				];
				
				const output = await this.replicate.run(model_name, {
					input: {
						messages: messages,
						tools: tools,
						tool_choice: 'auto',
						...(this.params || {})
					}
				});

				// Check if output contains tool calls
				if (output?.tool_calls && output.tool_calls.length > 0) {
					console.log(`Received ${output.tool_calls.length} tool call(s) from API`);
					return JSON.stringify({
						_native_tool_calls: true,
						tool_calls: output.tool_calls
					});
				}

				console.log('Received.');
				return output?.content || output || '';
			} catch (err) {
				console.log(err);
				return 'My brain disconnected, try again.';
			}
		}

		// Original streaming logic for non-tool calls
		const prompt = toSinglePrompt(turns, null, stop_seq);
		const input = { 
			prompt, 
			system_prompt: systemMessage,
			...(this.params || {})
		};
		
		try {
			console.log('Awaiting Replicate API response...');
			let result = '';
			for await (const event of this.replicate.stream(model_name, { input })) {
				result += event;
				if (result === '') break;
				if (result.includes(stop_seq)) {
					result = result.slice(0, result.indexOf(stop_seq));
					break;
				}
			}
			console.log('Received.');
			return result;
		} catch (err) {
			console.log(err);
			return 'My brain disconnected, try again.';
		}
	}

	async embed(text) {
		const output = await this.replicate.run(
			this.model_name || "mark3labs/embeddings-gte-base:d619cff29338b9a37c3d06605042e1ff0594a8c3eff0175fd6967f5643fc4d47",
			{ input: {text} }
		);
		return output.vectors;
	}
}