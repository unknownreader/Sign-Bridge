require('dotenv').config();
const express = require('express');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON request bodies
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to retrieve Teachable Machine model URL configuration
app.get('/api/config', (req, res) => {
    res.json({
        tmModelUrl: process.env.TM_MODEL_URL || ''
    });
});

// API endpoint to translate sign sequences using the Gemini API
app.post('/api/translate', async (req, res) => {
    try {
        const { signs } = req.body;
        if (!signs || !Array.isArray(signs)) {
            return res.status(400).json({ error: 'Invalid signs array provided' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("Gemini API Key is not set in environment variables.");
            return res.status(500).json({ error: 'Server configuration error: API key is missing' });
        }

        // Construct the prompt for Gemini
        const promptText = `I am building an app for mute/deaf people. The following is a sequence of hand sign labels detected by a computer vision model in chronological order: [${signs.join(', ')}]. 
Please translate this sequence of words/signs into a natural, easy-to-understand sentence that a normal hearing person would say. 
Output ONLY the final translated sentence, with no additional formatting, markdown, or explanation.`;

        // Initialize Google Gen AI SDK
        const ai = new GoogleGenAI({ apiKey });

        // Call the Gemini model using the SDK
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: promptText
        });

        if (response && response.text) {
            const translatedText = response.text.trim();
            return res.json({ translation: translatedText });
        } else {
            throw new Error("Unexpected response structure from Gemini API");
        }

    } catch (error) {
        console.error("Translation proxy error:", error.message);
        res.status(500).json({ error: 'Failed to translate signs due to a server-side error' });
    }
});

// Fallback to index.html for single page application styling
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`SignBridge server is running on http://localhost:${PORT}`);
    console.log(`Make sure your .env file is configured correctly.`);
    console.log(`==================================================`);
});
