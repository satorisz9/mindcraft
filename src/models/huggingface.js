import { toSinglePrompt } from '../utils/text.js';
import { getKey } from '../utils/keys.js';
import { InferenceClient } from "@huggingface/inference";

export class HuggingFace {
  static prefix = 'huggingface';
  constructor(model_name, url, params) {
    // Remove 'huggingface/' prefix if present
    this.model_name = model_name.replace('huggingface/', '');
    this.url = url;
    this.params = params;

    if (this.url) {
      console.warn("Hugging Face doesn't support custom urls!");
    }

    this.huggingface = new InferenceClient(getKey('HUGGINGFACE_API_KEY'));
  }

  async sendRequest(turns, systemMessage, stop_seq = '<|EOT|>', tools=null) {
    const model_name = this.model_name || 'openai/gpt-oss-120b';
    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(tools 
        ? `Awaiting Hugging Face API response with tool calling (${tools.length} tools)... (model: ${model_name}, attempt: ${attempt})`
        : `Awaiting Hugging Face API response... (model: ${model_name}, attempt: ${attempt})`);

      try {
        const messages = [{ role: "system", content: systemMessage }, ...turns];
        const requestParams = {
          model: model_name,
          messages: messages,
          ...(this.params || {})
        };

        if (tools?.length > 0) {
          console.log(`Using tool calling with ${tools.length} tools`);
          requestParams.tools = tools;
          requestParams.tool_choice = 'auto';
        }

        const response = await this.huggingface.chatCompletion(requestParams);
        const message = response.choices[0].message;
        
        // Handle native tool calls
        if (message.tool_calls?.length > 0) {
          console.log(`Received ${message.tool_calls.length} tool call(s) from API`);
          return JSON.stringify({
            _native_tool_calls: true,
            tool_calls: message.tool_calls
          });
        }

        let res = message.content || '';

        // Handle <think> blocks
        const hasOpenTag = res.includes("<think>");
        const hasCloseTag = res.includes("</think>");

        if (hasOpenTag && !hasCloseTag) {
          console.warn("Partial <think> block detected. Re-generating...");
          continue;
        }

        if (hasOpenTag && hasCloseTag) {
          res = res.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        }

        console.log('Received.');
        return res;

      } catch (err) {
        console.error('HuggingFace API error:', err.message || err);
        if (attempt >= maxAttempts) {
          return 'My brain disconnected, try again.';
        }
      }
    }

    return 'I thought too hard, sorry, try again.';
  }

  async embed(text) {
    throw new Error('Embeddings are not supported by HuggingFace.');
  }
}
