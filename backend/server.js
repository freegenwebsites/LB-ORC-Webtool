// File: C:\Users\samky\Downloads\Obsidian Git vault\LB-ORC-Webtool\backend\server.js
// MODIFIED TO HANDLE MULTIPLE LLM BACKENDS (with input logging)

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch'); // Assuming you've installed node-fetch@2.x.x
const cors = require('cors');

console.log("--- Attempting to start multi-LLM backend server.js ---");

const app = express();
const PORT = process.env.PORT || 3001;

// --- API Keys and Model Configs ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const LLM_CONFIGS = {
    local_ollama_Qwen3: { // This key (local_ollama_Qwen3) must match the value from the frontend dropdown
        apiUrl: 'http://localhost:11434/v1/chat/completions',
        modelName: 'qwen3:8b', // This is the model Ollama will use
        type: 'openai_compatible', 
        requiresApiKey: false
    },
    google_gemini_pro: {
        apiUrlBase: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
        modelName: 'gemini-pro',
        type: 'google_gemini',
        requiresApiKey: true,
        getApiKey: () => GOOGLE_API_KEY
    }
};

console.log(`--- PORT configured: ${PORT} ---`);
if (GOOGLE_API_KEY) console.log("Google API Key Loaded."); else console.warn("Google API Key NOT loaded from .env");

app.use(cors());
app.use(express.json());
console.log("--- Middleware configured ---");

app.post('/api/llm-structure', async (req, res) => {
    const { rawText, llmPrompt, selectedModel } = req.body; 

    console.log(`[${new Date().toISOString()}] POST /api/llm-structure. Selected Model: ${selectedModel}`);

    if (!rawText || !llmPrompt || !selectedModel) {
        return res.status(400).json({ error: 'rawText, llmPrompt, and selectedModel are required.' });
    }

    const config = LLM_CONFIGS[selectedModel];
    if (!config) {
        return res.status(400).json({ error: `Unsupported model selected: ${selectedModel}` });
    }

    if (config.requiresApiKey) {
        const apiKey = config.getApiKey();
        if (!apiKey) {
            console.error(`API Key for ${selectedModel} is not configured on the server.`);
            return res.status(500).json({ error: `API Key for ${selectedModel} not configured.` });
        }
    }

    let apiUrl = config.apiUrl;
    let requestPayload;
    let headers = { 'Content-Type': 'application/json' };

    // --- Construct Payload and Headers based on LLM type ---
    if (config.type === 'openai_compatible') {
        requestPayload = {
            model: config.modelName,
            messages: [
                { role: "system", content: "You are an expert data extraction assistant. Your task is to process the given text, which is an exam paper, according to the user's specific instructions and return a Markdown table. Ensure the output is ONLY the raw Markdown syntax for the table itself. Do absolutely NOT wrap the table in code fences (```), format it as a code block, or use any formatting other than the plain text Markdown table structure." },
                { role: "user", content: `${llmPrompt}\n\nHere is the exam paper text to structure:\n\n---\n${rawText}\n---` }
            ],
            stream: false,
            temperature: 0.1
        };
        if (config.requiresApiKey && selectedModel.startsWith('openai_')) { 
             headers['Authorization'] = `Bearer ${config.getApiKey()}`;
        }
    } else if (config.type === 'google_gemini') {
        apiUrl = `${config.apiUrlBase}?key=${config.getApiKey()}`; 
        requestPayload = {
            contents: [{ parts: [{
                text: `You are an expert data extraction assistant. Your task is to process the given text, which is an exam paper, according to the user's specific instructions and return a Markdown table.
${llmPrompt}

Here is the exam paper text to structure:
---
${rawText}
---
Ensure the output is ONLY the raw Markdown syntax for the table itself. Do absolutely NOT wrap the table in code fences (\`\`\`), format it as a code block, or use any formatting other than the plain text Markdown table structure.`
            }]}],
            generationConfig: { temperature: 0.1 }
        };
    } else {
        return res.status(500).json({ error: `Configuration error for model type: ${config.type}` });
    }

    // ---vvv INPUT PAYLOAD LOGGING ADDED HERE vvv---
    console.log(`--- Sending Payload to ${selectedModel} (${config.modelName}) ---`);
    if (config.type === 'openai_compatible' && requestPayload.messages && requestPayload.messages[1]) {
        console.log("System Message (start):", requestPayload.messages[0].content.substring(0, 200) + "...");
        console.log("User Message (Prompt + Raw Text):");
        console.log("  LLM Prompt part (start):", llmPrompt.substring(0, 300) + "...");
        console.log(`  Raw Text part (length: ${rawText.length} chars, start):`, rawText.substring(0, 300) + "...");
        console.log("  Full User Message content (start):", requestPayload.messages[1].content.substring(0, 500) + "...");
    } else if (config.type === 'google_gemini' && requestPayload.contents && requestPayload.contents[0]?.parts?.[0]) {
        console.log("Combined Text Input (Prompt + Raw Text for Google):");
        console.log("  LLM Prompt part (start):", llmPrompt.substring(0, 300) + "...");
        console.log(`  Raw Text part (length: ${rawText.length} chars, start):`, rawText.substring(0, 300) + "...");
        console.log("  Full Text part content (start):", requestPayload.contents[0].parts[0].text.substring(0, 500) + "...");
    }
    // Log structure without embedding huge text directly for messages/contents
    let summarizedPayload = { ...requestPayload };
    if (summarizedPayload.messages) summarizedPayload.messages = `[${summarizedPayload.messages.length} messages, content summarized above]`;
    if (summarizedPayload.contents) summarizedPayload.contents = `[${summarizedPayload.contents.length} content blocks, text summarized above]`;
    console.log("Full Request Payload (structure view):", JSON.stringify(summarizedPayload, null, 2));
    console.log(`--- End of Payload to ${selectedModel} ---`);
    // ---^^^ END OF INPUT PAYLOAD LOGGING ^^^---

    // --- Make the API Call ---
    try {
        console.log(`Sending request to ${selectedModel} (Model: ${config.modelName}). URL: ${apiUrl.split('?')[0]}`); 
        
        const llmApiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestPayload)
        });
        const responseData = await llmApiResponse.json();

        if (!llmApiResponse.ok) {
            console.error(`${selectedModel} API Error Status:`, llmApiResponse.status);
            console.error(`${selectedModel} API Error Response:`, JSON.stringify(responseData, null, 2));
            return res.status(llmApiResponse.status).json({
                error: `Error from ${selectedModel} API.`,
                details: responseData.error || responseData || { message: `${selectedModel} API returned status ${llmApiResponse.status}` }
            });
        }

        let llmOutput = null;
        if (config.type === 'openai_compatible') {
            llmOutput = responseData.choices && responseData.choices[0] && responseData.choices[0].message && responseData.choices[0].message.content;
        } else if (config.type === 'google_gemini') {
            if (responseData.candidates && responseData.candidates[0]?.content?.parts?.[0]?.text) {
                llmOutput = responseData.candidates[0].content.parts[0].text;
            } else if (responseData.promptFeedback?.blockReason) {
                console.error(`Content blocked by ${selectedModel} API:`, responseData.promptFeedback.blockReason);
                return res.status(400).json({ error: 'Content generation blocked by API.', details: responseData.promptFeedback });
            }
        }

        if (llmOutput) {
            console.log(`Successfully received response from ${selectedModel}. Output length: ${llmOutput.length} chars.`);
            // ---vvv RAW LLM OUTPUT LOGGING (already present in your file) vvv---
            console.log(`--- Raw LLM Output from ${selectedModel} (${config.modelName}) ---:\n${llmOutput}\n--- End of Raw LLM Output ---`);
            // ---^^^ END OF RAW LLM OUTPUT LOGGING ^^^---
            res.json({ markdownTable: llmOutput.trim() });
        } else {
            console.error(`Unexpected ${selectedModel} API response structure. No content found.`);
            console.error(`Full ${selectedModel} Response:`, JSON.stringify(responseData, null, 2));
            res.status(500).json({ error: `Unexpected response structure from ${selectedModel}.`, details: responseData });
        }

    } catch (error) {
        console.error(`Error calling ${selectedModel} service:`, error.message);
        if (error.code === 'ECONNREFUSED' && apiUrl && apiUrl.includes('localhost')) { // added apiUrl check
            return res.status(503).json({ error: `Local LLM (${selectedModel}) service unavailable. Is it running?` });
        }
        res.status(500).json({ error: `Failed to call ${selectedModel} service.`, details: { message: error.message } });
    }
});

app.get('/', (req, res) => {
    res.send('Multi-LLM Proxy Server is running!');
});

app.listen(PORT, () => {
    console.log(`Multi-LLM Proxy server listening on http://localhost:${PORT}`);
    console.log("Available LLM configurations:", Object.keys(LLM_CONFIGS));
});