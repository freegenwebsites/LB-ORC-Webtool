// File: C:\Users\samky\Downloads\Obsidian Git vault\LB-ORC-Webtool\backend\server.js
// MODIFIED TO HANDLE MULTIPLE LLM BACKENDS

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

console.log("--- Attempting to start multi-LLM backend server.js ---");

const app = express();
const PORT = process.env.PORT || 3001;

// --- API Keys and Model Configs ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
// Add other API keys if needed, e.g., OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const LLM_CONFIGS = {
    local_ollama_Qwen3: {
        apiUrl: 'http://localhost:11434/v1/chat/completions',
        modelName: 'qwen3:8b', // Ensure this model is pulled in Ollama
        type: 'openai_compatible', // Indicates OpenAI-like request/response
        requiresApiKey: false
    },
    google_gemini_pro: {
        apiUrlBase: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
        modelName: 'gemini-pro',
        type: 'google_gemini',
        requiresApiKey: true,
        getApiKey: () => GOOGLE_API_KEY
    }
    // Example for OpenAI (if you add it later)
    // openai_gpt35_turbo: {
    //     apiUrl: 'https://api.openai.com/v1/chat/completions',
    //     modelName: 'gpt-3.5-turbo',
    //     type: 'openai_compatible',
    //     requiresApiKey: true,
    //     getApiKey: () => OPENAI_API_KEY
    // }
};

console.log(`--- PORT configured: ${PORT} ---`);
if (GOOGLE_API_KEY) console.log("Google API Key Loaded."); else console.warn("Google API Key NOT loaded from .env");
// if (OPENAI_API_KEY) console.log("OpenAI API Key Loaded.");

app.use(cors());
app.use(express.json());
console.log("--- Middleware configured ---");

app.post('/api/llm-structure', async (req, res) => {
    const { rawText, llmPrompt, selectedModel } = req.body; // Extract selectedModel

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
        // For Ollama or OpenAI
        requestPayload = {
            model: config.modelName,
            messages: [
                { role: "system", content: "You are an expert data extraction assistant. Your task is to process the given text, which is an exam paper, according to the user's specific instructions and return a Markdown table. Ensure the output is ONLY the raw Markdown syntax for the table itself. Do absolutely NOT wrap the table in code fences (```), format it as a code block, or use any formatting other than the plain text Markdown table structure." },
                { role: "user", content: `${llmPrompt}\n\nHere is the exam paper text to structure:\n\n---\n${rawText}\n---` }
            ],
            stream: false,
            temperature: 0.1
        };
        if (config.requiresApiKey && selectedModel.startsWith('openai_')) { // Example for actual OpenAI
             headers['Authorization'] = `Bearer ${config.getApiKey()}`;
        }
    } else if (config.type === 'google_gemini') {
        apiUrl = `${config.apiUrlBase}?key=${config.getApiKey()}`; // API key in URL for this Google API
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

    // --- Make the API Call ---
    try {
        console.log(`Sending request to ${selectedModel} (Model: ${config.modelName}). URL: ${apiUrl.split('?')[0]}`); // Log base URL
        
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

        // --- Parse Response based on LLM type ---
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
            res.json({ markdownTable: llmOutput.trim() });
        } else {
            console.error(`Unexpected ${selectedModel} API response structure. No content found.`);
            console.error(`Full ${selectedModel} Response:`, JSON.stringify(responseData, null, 2));
            res.status(500).json({ error: `Unexpected response structure from ${selectedModel}.`, details: responseData });
        }

    } catch (error) {
        console.error(`Error calling ${selectedModel} service:`, error.message);
        if (error.code === 'ECONNREFUSED' && config.apiUrl.includes('localhost')) {
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