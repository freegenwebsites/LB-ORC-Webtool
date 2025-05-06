// File: C:\Users\samky\Downloads\Obsidian Git vault\LB-ORC-Webtool\backend\server.js

console.log("--- Attempting to start server.js ---"); // ADD THIS LINE FOR DEBUGGING

require('dotenv').config(); // Loads environment variables from .env file into process.env
const express = require('express');
const fetch = require('node-fetch'); // Or use global.fetch if Node 18+ and you omit this from npm install
const cors = require('cors');

console.log("--- Basic modules required ---"); // DEBUGGING

const app = express();
const PORT = process.env.PORT || 3001; // Use port from .env, or 3001 as default
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // Get Google API key from .env

console.log(`--- PORT configured: ${PORT}, API Key loaded: ${GOOGLE_API_KEY ? 'Yes' : 'No!!!'} ---`); // DEBUGGING

// --- IMPORTANT: Choose the correct Gemini model and construct the endpoint ---
const MODEL_NAME = 'gemini-pro'; // Common options: 'gemini-pro', 'gemini-1.0-pro', 'gemini-1.5-pro-latest'
const GOOGLE_API_URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;

console.log(`--- Google API Base URL: ${GOOGLE_API_URL_BASE} ---`); // DEBUGGING

// --- Middleware Setup ---
app.use(cors()); 
app.use(express.json()); 

console.log("--- Middleware configured ---"); // DEBUGGING

// --- API Endpoint for LLM Structuring ---
app.post('/api/llm-structure', async (req, res) => {
    console.log(`[${new Date().toISOString()}] POST /api/llm-structure received.`);

    const { rawText, llmPrompt } = req.body;

    if (!rawText || !llmPrompt) {
        console.error('Validation Error: rawText and llmPrompt are required.');
        return res.status(400).json({ error: 'rawText and llmPrompt are required in the request body.' });
    }
    if (!GOOGLE_API_KEY) {
        console.error('Server Configuration Error: GOOGLE_API_KEY is not configured on the server.');
        return res.status(500).json({ error: 'Google API key not configured on server. Contact administrator.' });
    }

    const fullGoogleApiUrl = `${GOOGLE_API_URL_BASE}?key=${GOOGLE_API_KEY}`;

    const requestPayload = {
        contents: [
            {
                parts: [
                    {
                        text: `You are an expert data extraction assistant. Your task is to process the given text, which is an exam paper, according to the user's specific instructions and return a Markdown table.
${llmPrompt}

Here is the exam paper text to structure:
---
${rawText}
---
Ensure the output is ONLY the raw Markdown syntax for the table itself. Do absolutely NOT wrap the table in code fences (\`\`\`), format it as a code block, or use any formatting other than the plain text Markdown table structure.`
                    }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.1, 
        },
    };

    try {
        console.log(`Sending request to Google Generative AI API (model: ${MODEL_NAME}). URL: ${GOOGLE_API_URL_BASE}`);
        
        const googleResponse = await fetch(fullGoogleApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestPayload)
        });

        const responseData = await googleResponse.json();

        if (!googleResponse.ok) {
            console.error('Google API Error Status:', googleResponse.status);
            console.error('Google API Error Response:', JSON.stringify(responseData, null, 2));
            return res.status(googleResponse.status).json({
                error: 'Error from Google Generative AI API.',
                details: responseData.error || { message: `Google API returned status ${googleResponse.status}` }
            });
        }

        let llmOutput = null;
        if (responseData.candidates && responseData.candidates.length > 0 &&
            responseData.candidates[0].content && responseData.candidates[0].content.parts &&
            responseData.candidates[0].content.parts.length > 0 &&
            responseData.candidates[0].content.parts[0].text) {
            llmOutput = responseData.candidates[0].content.parts[0].text;
        } else if (responseData.promptFeedback && responseData.promptFeedback.blockReason) {
            console.error('Content blocked by Google API due to safety settings or other reason:', responseData.promptFeedback.blockReason);
            console.error('Full Google Response (for debugging block):', JSON.stringify(responseData, null, 2));
            return res.status(400).json({ 
                error: 'Content generation blocked by API.',
                details: {
                    message: `Blocked due to: ${responseData.promptFeedback.blockReason}`,
                    safetyRatings: responseData.promptFeedback.safetyRatings || "N/A"
                }
            });
        }

        if (llmOutput) {
            console.log(`Successfully received response from Google. Output length: ${llmOutput.length} chars.`);
            res.json({ markdownTable: llmOutput.trim() }); 
        } else {
            console.error('Unexpected Google API response structure or empty content. No text content found.');
            console.error('Full Google Response (for debugging missing content):', JSON.stringify(responseData, null, 2));
            res.status(500).json({
                error: 'Unexpected response structure from Google or no content generated.',
                details: responseData
            });
        }

    } catch (error) {
        console.error('Error calling Google Generative AI service:', error.message);
        console.error(error.stack); 
        res.status(500).json({ error: 'Failed to call LLM service due to an internal server error.', details: { message: error.message } });
    }
});

// --- Default route for testing if the server is up ---
app.get('/', (req, res) => {
    console.log(`[${new Date().toISOString()}] GET / received. Server is up.`); // DEBUGGING
    res.send('LLM Proxy Server (Google Gemini) is running!');
});

// --- Start the Server ---
try { // ADDED TRY-CATCH AROUND LISTEN
    app.listen(PORT, () => {
        console.log(`LLM Proxy server (Google Gemini) listening on http://localhost:${PORT}`);
        if (!GOOGLE_API_KEY) {
            console.warn('WARNING: GOOGLE_API_KEY is not set in the environment variables. API calls will fail.');
        } else {
            console.log(`Using Google API Key starting with: ${GOOGLE_API_KEY.substring(0, 4)}... and ending with ...${GOOGLE_API_KEY.substring(GOOGLE_API_KEY.length - 4)}`);
        }
    });
    console.log("--- app.listen called, server should be starting ---"); // DEBUGGING
} catch (e) {
    console.error("!!! FATAL ERROR during app.listen !!!", e); // DEBUGGING
}