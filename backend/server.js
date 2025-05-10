// File: C:\Users\samky\Downloads\Obsidian Git vault\LB-ORC-Webtool\backend\server.js
// This version already supports streaming for Ollama and Gemini,
// and will correctly pass through either Markdown or JSON from the LLM.

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch'); 
const cors = require('cors');

console.log("--- Attempting to start multi-LLM backend server.js ---");

const app = express();
const PORT = process.env.PORT || 3001;

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const LLM_CONFIGS = {
    local_ollama_Qwen3: {
        apiUrl: 'http://localhost:11434/v1/chat/completions',
        modelName: 'qwen3:8b',
        type: 'openai_compatible', 
        streamable: true, 
        requiresApiKey: false
    },
    google_gemini_pro: {
        apiUrlBase: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent', 
        modelName: 'gemini-pro', 
        type: 'google_gemini', 
        streamable: true, 
        requiresApiKey: true,
        getApiKey: () => GOOGLE_API_KEY
    }
    // Example for a non-streaming model if you had one:
    // some_other_llm_nonstream: {
    //     apiUrl: 'http://some.api/endpoint',
    //     modelName: 'model-x',
    //     type: 'some_other_type_nonstream',
    //     streamable: false, 
    //     requiresApiKey: true,
    //     getApiKey: () => SOME_API_KEY 
    // }
};

console.log(`--- PORT configured: ${PORT} ---`);
if (GOOGLE_API_KEY) console.log("Google API Key Loaded."); else console.warn("Google API Key NOT loaded from .env");

app.use(cors());
app.use(express.json({ limit: '50mb' }));
console.log("--- Middleware configured ---");

app.post('/api/llm-structure', async (req, res) => {
    const { rawText, llmPrompt, selectedModel } = req.body; // llmPrompt now comes from frontend based on selected mode

    // --- Logging of received data ---
    console.log("--- Received from Frontend ---");
    console.log("Selected Model:", selectedModel);
    // This llmPrompt will be either DIRECT_STRUCTURE_PROMPT or TAGGING_PROMPT
    console.log("LLM Prompt (type, first 500 chars from frontend):", typeof llmPrompt, typeof llmPrompt === 'string' ? llmPrompt.substring(0, 500) + "..." : llmPrompt);
    console.log("Raw Text (type, length from frontend):", typeof rawText, typeof rawText === 'string' ? rawText.length : rawText, "Raw Text (first 300 chars):", typeof rawText === 'string' ? rawText.substring(0,300) + "..." : "N/A");
    console.log("--- End of Received from Frontend ---");

    console.log(`[${new Date().toISOString()}] POST /api/llm-structure. Selected Model: ${selectedModel}`);

    // ... (validation for rawText, llmPrompt, selectedModel remains the same) ...
    if (!rawText || typeof rawText !== 'string' || !llmPrompt || typeof llmPrompt !== 'string' || !selectedModel) {
        console.error("Validation Error: rawText, llmPrompt (must be strings), and selectedModel are required.");
        return res.status(400).json({ error: 'rawText, llmPrompt (must be strings), and selectedModel are required.' });
    }

    const config = LLM_CONFIGS[selectedModel];
    // ... (config validation remains the same) ...
    if (!config) {
        return res.status(400).json({ error: `Unsupported model selected: ${selectedModel}` });
    }
    if (config.requiresApiKey && !config.getApiKey()) {
        console.error(`API Key for ${selectedModel} is not configured on the server.`);
        return res.status(500).json({ error: `API Key for ${selectedModel} not configured.` });
    }


    let apiUrl = config.apiUrl || config.apiUrlBase; 
    let requestPayload;
    let headers = { 'Content-Type': 'application/json' };

    // --- Payload Construction (already handles dynamic llmPrompt) ---
    if (config.type === 'openai_compatible') {
        requestPayload = {
            model: config.modelName,
            messages: [ 
                { role: "system", content: "You are an expert data extraction assistant. You will follow the user's instructions precisely to generate a Markdown table." }, // System prompt could be generic
                // The specific instructions for Markdown table OR JSON tags are now in llmPrompt
                { role: "user", content: `${llmPrompt}\n\nHere is the exam paper text to structure:\n\n---\n${rawText}\n---\n\nIMPORTANT: Your response MUST be ONLY the raw Markdown table. Do not include any other text, explanation, or conversational elements like '<think>' tags before or after the table.` } 
                // The "IMPORTANT" part might be slightly misleading if we expect JSON, but the core llmPrompt should override it.
                // Consider making the "IMPORTANT" part more generic for JSON output, or ensuring the TAGGING_PROMPT is strong enough.
                // For TAGGING_PROMPT, it explicitly asks for JSON ONLY.
            ],
            stream: config.streamable, 
            temperature: 0.1
        };
        // ...
    } else if (config.type === 'google_gemini') {
        apiUrl = `${config.apiUrlBase}?key=${config.getApiKey()}`; 
        requestPayload = {
            contents: [{ parts: [{
                // The llmPrompt contains the specific instructions (Markdown table or JSON tags)
                text: `${llmPrompt}\n\nHere is the text to process:\n---\n${rawText}\n---`
                // The TAGGING_PROMPT for Gemini would also end with "Output ONLY the JSON array."
            }]}],
            generationConfig: { temperature: 0.1 }
        };
    } else {
        return res.status(500).json({ error: `Configuration error for model type: ${config.type}` });
    }
    
    // ... (logging of outgoing payload remains the same) ...
    console.log(`--- Sending Payload to ${selectedModel} (${config.modelName || selectedModel}) ---`);
    // ... (payload summarization for logging) ...
    console.log("Full Request Payload (structure view, long text truncated for log):", JSON.stringify(requestPayload, null, 2)); // Log the actual payload
    console.log(`--- End of Payload to ${selectedModel} ---`);

    // --- API Call and Response Handling ---
    try {
        console.log(`Sending request to ${selectedModel}. URL: ${apiUrl ? apiUrl.split('?')[0] : 'N/A' }`);
        const llmApiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestPayload)
        });

        // ... (non-ok response handling remains the same) ...
        if (!llmApiResponse.ok) {
            const errorBody = await llmApiResponse.text(); 
            let errorDetails;
            try { errorDetails = JSON.parse(errorBody); } 
            catch (e) { errorDetails = { message: errorBody || `${selectedModel} API returned status ${llmApiResponse.status}` }; }
            console.error(`${selectedModel} API Error Status:`, llmApiResponse.status);
            console.error(`${selectedModel} API Error Response:`, JSON.stringify(errorDetails, null, 2));
            return res.status(llmApiResponse.status).json({
                error: `Error from ${selectedModel} API.`,
                details: errorDetails.error || errorDetails
            });
        }


        // --- Handle streaming if config.streamable is true ---
        // This logic already passes through content chunks, regardless of whether
        // those chunks form Markdown or a JSON string.
        if (config.streamable) {
            res.setHeader('Content-Type', 'text/event-stream');
            // ... (other SSE headers) ...
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders(); 

            let accumulatedDataForLog = '';
            let buffer = '';

            const sendSseChunk = (data) => {
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            };

            llmApiResponse.body.on('data', (chunk) => {
                buffer += chunk.toString();
                let jsonObjectsOrLines = buffer.split('\n'); // For Ollama/Gemini newline-delimited JSONs
                buffer = jsonObjectsOrLines.pop() || ''; 

                for (const line of jsonObjectsOrLines) {
                    if (line.trim() === '') continue;
                    
                    let jsonDataString = line.trim();
                    if (config.type === 'openai_compatible' && jsonDataString.startsWith('data: ')) { // Ollama might send data: prefix
                        jsonDataString = jsonDataString.substring(6).trim();
                    }
                    // Gemini stream sends raw JSON objects per line.

                    if (jsonDataString === '[DONE]' && config.type === 'openai_compatible') continue; 
                    
                    try {
                        const parsedChunk = JSON.parse(jsonDataString);
                        let content = null;

                        if (config.type === 'openai_compatible') {
                            content = parsedChunk.choices?.[0]?.delta?.content;
                            // ...
                        } else if (config.type === 'google_gemini') {
                            content = parsedChunk.candidates?.[0]?.content?.parts?.[0]?.text;
                            // ... (blockReason check)
                             if (parsedChunk.promptFeedback?.blockReason) {
                                console.error(`[${selectedModel}] Content blocked by API: ${parsedChunk.promptFeedback.blockReason}`);
                                sendSseChunk({ type: 'error', message: `Content generation blocked by API: ${parsedChunk.promptFeedback.blockReason}` });
                                return; 
                            }
                        }

                        if (content) {
                            accumulatedDataForLog += content;
                            sendSseChunk({ type: 'chunk', content: content }); // This content is whatever the LLM sends
                        }
                    } catch (parseError) {
                        // This can happen if a line isn't valid JSON (e.g. intermediate text not in JSON format)
                        // If the LLM for TAGGING_PROMPT outputs *only* a single JSON array at the very end of its stream,
                        // then individual chunks might not be parsable as JSON until the whole thing is received.
                        // However, both Ollama and Gemini stream JSON objects representing *deltas* or *parts*.
                        // The TAGGING_PROMPT asks for ONE JSON array. This means if the LLM adheres strictly,
                        // it might send the whole JSON as one giant "content" string in the last chunk, or
                        // it might try to stream parts of the JSON string.
                        // The current server logic assumes the LLM streams *parsable JSON chunks* that contain text.
                        // If the LLM sends a raw, multi-line JSON string *not* broken into parsable JSON chunks per line/event,
                        // this parsing here will fail for intermediate chunks. The frontend accumulates all 'content'
                        // and then tries JSON.parse on the whole thing for 'tagAndAssemble'.
                        if (DEBUG_MODE) console.warn(`[${selectedModel}] Non-JSON or partial JSON in stream chunk: "${jsonDataString.substring(0,100)}..." Error: ${parseError.message}`);
                        // For non-JSON text chunks, we could still send them if the frontend is prepared.
                        // sendSseChunk({ type: 'chunk', content: jsonDataString }); // If we want to pass raw non-JSON text too
                    }
                }
            });

            llmApiResponse.body.on('end', () => {
                // ... (process final buffer, send 'done', res.end()) ...
                if (buffer.trim() !== '') { 
                    // Try to parse the final buffer as if it might complete a JSON object
                    let jsonDataString = buffer.trim();
                     if (config.type === 'openai_compatible' && jsonDataString.startsWith('data: ')) {
                        jsonDataString = jsonDataString.substring(6).trim();
                    }
                    if (jsonDataString && jsonDataString !== '[DONE]') {
                        try {
                            const parsedChunk = JSON.parse(jsonDataString); // Attempt to parse final piece
                            let content = null;
                             if (config.type === 'openai_compatible') content = parsedChunk.choices?.[0]?.delta?.content;
                             else if (config.type === 'google_gemini') content = parsedChunk.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (content) {
                                accumulatedDataForLog += content;
                                sendSseChunk({ type: 'chunk', content: content });
                            }
                        } catch (e) {
                            // If parsing fails, it might be that the LLM sent a large single JSON
                            // that was chunked by the stream, and the final buffer isn't a valid JSON on its own.
                            // The frontend already accumulates all `content` parts.
                            if (DEBUG_MODE) console.warn(`[${selectedModel}] Final buffer not a parsable JSON chunk: "${jsonDataString.substring(0,100)}..."`);
                        }
                    }
                }
                console.log(`[${selectedModel}] LLM Stream finished (on 'end' event).`);
                sendSseChunk({ type: 'done' });
                console.log(`[${selectedModel}] Backend SSE stream to client ended. Full accumulated text length (server-side): ${accumulatedDataForLog.length}`);
                res.end();
            });

            // ... (stream error handling) ...
            llmApiResponse.body.on('error', (streamError) => {
                console.error(`[${selectedModel}] Error during LLM stream consumption:`, streamError);
                if (!res.writableEnded) { 
                    try { sendSseChunk({ type: 'error', message: 'LLM stream error on server.' }); } 
                    catch (e) { console.error("Error sending SSE error event:", e); }
                    res.end();
                }
            });


        } else { 
            // --- NON-STREAMABLE PATH ---
            // This path would be taken if config.streamable is false.
            // If the LLM (even in this path) is meant for "tagAndAssemble", it should return a body
            // that is a stringified JSON array.
            const responseText = await llmApiResponse.text(); // Get the raw text response
            console.log(`Successfully received non-streaming response from ${selectedModel}. Output length: ${responseText.length} chars.`);
            console.log(`--- Raw LLM Output (Non-Streaming) from ${selectedModel} (${config.modelName}) ---:\n${responseText.substring(0,1000)}...\n--- End of Raw LLM Output ---`);
            
            // The frontend expects { markdownTable: "..." } or { taggedData: [...] } (or just the JSON array for taggedData)
            // For simplicity, let's just send the raw responseText and let frontend figure it out based on mode.
            // Or, try to be smart: if it looks like JSON, send it as an object, else as markdownTable.
            try {
                const jsonData = JSON.parse(responseText);
                // If it's valid JSON, assume it's for tagAndAssemble
                // Send it in a way frontend can distinguish or just send the object directly
                console.log(`[${selectedModel}] Non-streaming response parsed as JSON.`);
                res.json(jsonData); // Frontend will parse this if currentProcessingMode is 'tagAndAssemble'
            } catch (e) {
                // If not JSON, assume it's Markdown for directStructure
                console.log(`[${selectedModel}] Non-streaming response NOT JSON, assuming Markdown.`);
                res.json({ markdownTable: responseText.trim() });
            }
        }

    } catch (error) {
        // ... (general error handling) ...
         console.error(`Error calling ${selectedModel} service or processing response:`, error.message, error.stack);
        if (!res.headersSent) { 
            if (error.code === 'ECONNREFUSED') {
                return res.status(503).json({ error: `Local LLM (${selectedModel}) service unavailable. Is it running?` });
            }
            res.status(500).json({ error: `Failed to call ${selectedModel} service.`, details: { message: error.message } });
        } else if (res.writable && !res.writableEnded) {
            console.error(`[${selectedModel}] Error occurred after SSE headers sent.`);
            try { res.write(`data: ${JSON.stringify({type: 'error', message: 'Server error during stream processing.'})}\n\n`); } 
            catch(ign) { /* ignore */ }
            res.end(); 
        } else {
            console.error(`[${selectedModel}] Error occurred after SSE headers sent and stream ended/broken.`);
        }
    }
});

app.get('/', (req, res) => {
    res.send('Multi-LLM Proxy Server is running!');
});

app.listen(PORT, () => {
    console.log(`Multi-LLM Proxy server listening on http://localhost:${PORT}`);
    console.log("Available LLM configurations:", Object.keys(LLM_CONFIGS));
});