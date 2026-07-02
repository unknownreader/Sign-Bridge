// --- DOM Elements ---
const tmModelUrlInput = document.getElementById('tm-model-url');
const geminiApiKeyInput = document.getElementById('gemini-api-key');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsStatus = document.getElementById('settings-status');

const webcamElement = document.getElementById('webcam');
const cameraOverlay = document.getElementById('camera-overlay');
const startCameraBtn = document.getElementById('start-camera-btn');

const burstCaptureBtn = document.getElementById('burst-capture-btn');
const captureStatus = document.getElementById('capture-status');
const btnText = burstCaptureBtn.querySelector('.btn-text');
const spinner = burstCaptureBtn.querySelector('.spinner');

const signsOutput = document.getElementById('signs-output');
const translationOutput = document.getElementById('translation-output');

const liveSignDisplay = document.getElementById('live-sign-display');
const liveConfidenceDisplay = document.getElementById('live-confidence-display');

// --- Global State ---
let model = null;
let isCameraReady = false;
let maxPredictions = 0;
let tmModelUrl = '';
let geminiApiKey = '';

let isTranslating = false;
let predictionIntervalId = null;
let capturedSigns = [];   // current sentence signs (reset after each translation)
let displaySigns = [];    // all signs shown on screen (max 10, cleared on new session)
const MAX_DISPLAY_SIGNS = 10;

// Stabilization state
let stableSignCounter = 0;
let lastStableSign = null;
let currentPendingSign = null;

// Idle / Auto-translate timeout state
let idleTimeoutId = null;
const IDLE_DELAY_MS = 4000;       // 4 seconds idle to trigger translation
const CONFIDENCE_THRESHOLD = 0.88; // Require high confidence before accepting a sign
const STABILITY_FRAMES = 5;        // Must hold same sign for 5 frames (~1.75s) to register

// --- Load Saved Settings on Startup ---
window.addEventListener('DOMContentLoaded', async () => {
    const savedUrl = localStorage.getItem('tmModelUrl');
    const savedKey = localStorage.getItem('geminiApiKey');
    
    if (savedUrl) tmModelUrlInput.value = savedUrl;
    if (savedKey) geminiApiKeyInput.value = savedKey;

    if (savedUrl && savedKey) {
        showSettingsStatus('Saved configuration found. Loading model...', 'success');
        await loadTeachableMachineModel(savedUrl, savedKey);
    } else {
        showSettingsStatus('Please configure your Model URL and Gemini API Key.', 'error');
    }
});

// --- Settings Action ---
saveSettingsBtn.addEventListener('click', async () => {
    const url = tmModelUrlInput.value.trim();
    const key = geminiApiKeyInput.value.trim();

    if (!url || !key) {
        showSettingsStatus('Both Teachable Machine URL and Gemini API Key are required.', 'error');
        return;
    }

    localStorage.setItem('tmModelUrl', url);
    localStorage.setItem('geminiApiKey', key);

    await loadTeachableMachineModel(url, key);
});

async function loadTeachableMachineModel(url, key) {
    try {
        saveSettingsBtn.disabled = true;
        showSettingsStatus('Loading Teachable Machine model...', '');
        
        // Ensure URL ends with /
        let formattedUrl = url;
        if (!formattedUrl.endsWith('/')) {
            formattedUrl += '/';
        }
        tmModelUrl = formattedUrl;
        geminiApiKey = key;

        const modelURL = tmModelUrl + 'model.json';
        const metadataURL = tmModelUrl + 'metadata.json';

        // Load the image model and metadata from Teachable Machine
        model = await tmImage.load(modelURL, metadataURL);
        maxPredictions = model.getTotalClasses();

        showSettingsStatus('Configuration saved and model loaded successfully!', 'success');
        updateCaptureButtonState();
    } catch (error) {
        console.error("Model loading error:", error);
        showSettingsStatus('Failed to load Teachable Machine model. Check the URL.', 'error');
    } finally {
        saveSettingsBtn.disabled = false;
    }
}

function showSettingsStatus(msg, type) {
    settingsStatus.textContent = msg;
    settingsStatus.className = 'status-msg ' + type;
}

// --- Camera Setup ---
startCameraBtn.addEventListener('click', async () => {
    try {
        // Request camera access
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        webcamElement.srcObject = stream;
        
        // Wait for video to be ready
        webcamElement.addEventListener('loadeddata', () => {
            isCameraReady = true;
            cameraOverlay.style.display = 'none'; // Hide overlay
            updateCaptureButtonState();
        });
    } catch (error) {
        console.error("Error accessing the camera", error);
        alert("Unable to access camera. Please grant permission.");
    }
});

function updateCaptureButtonState() {
    if (isCameraReady && model) {
        burstCaptureBtn.disabled = false;
        captureStatus.textContent = 'Status: Ready to translate. Click the button below.';
        if (signsOutput.textContent.startsWith('Waiting for')) {
            signsOutput.innerHTML = '<span style="color:var(--text-muted);font-weight:400">Waiting to start...</span>';
            translationOutput.textContent = 'Waiting to start...';
        }
    } else {
        burstCaptureBtn.disabled = true;
        if (!model) {
            captureStatus.textContent = 'Status: Please configure settings and load the model.';
        } else if (!isCameraReady) {
            captureStatus.textContent = 'Status: Please enable your camera.';
        }
    }
}

// --- Continuous Capture & Prediction Logic ---
burstCaptureBtn.addEventListener('click', () => {
    if (isTranslating) {
        stopAutoTranslation();
    } else {
        startAutoTranslation();
    }
});

function startAutoTranslation() {
    if (!model || !isCameraReady) return;

    isTranslating = true;
    burstCaptureBtn.classList.add('active');
    btnText.textContent = 'Stop Auto-Translate';
    spinner.style.display = 'inline-block';
    
    capturedSigns = [];
    displaySigns = [];
    signsOutput.innerHTML = '<span style="color:var(--text-muted);font-weight:400">Waiting for signs...</span>';
    translationOutput.textContent = 'Waiting for translation...';
    liveSignDisplay.textContent = '-';
    liveConfidenceDisplay.textContent = 'Confidence: 0%';
    
    stableSignCounter = 0;
    lastStableSign = null;
    currentPendingSign = null;
    
    captureStatus.textContent = 'Status: Auto-translation active. Show signs to camera.';
    
    const captureIntervalMs = 350; // Check predictions every 350ms
    
    predictionIntervalId = setInterval(async () => {
        if (!model || !isCameraReady) return;
        
        try {
            const prediction = await model.predict(webcamElement);
            
            // Find prediction with highest probability
            let bestPrediction = prediction[0];
            for (let i = 1; i < prediction.length; i++) {
                if (prediction[i].probability > bestPrediction.probability) {
                    bestPrediction = prediction[i];
                }
            }
            
            const className = bestPrediction.className;
            const probability = bestPrediction.probability;
            
            // Update live display
            liveSignDisplay.textContent = className;
            liveConfidenceDisplay.textContent = `Confidence: ${(probability * 100).toFixed(0)}%`;
            
            // Stabilization Logic
            if (probability >= CONFIDENCE_THRESHOLD) {
                if (className === currentPendingSign) {
                    stableSignCounter++;
                } else {
                    currentPendingSign = className;
                    stableSignCounter = 1;
                }
                
                // If sign is held stable for enough consecutive frames
                if (stableSignCounter >= STABILITY_FRAMES) {
                    if (className !== lastStableSign) {
                        lastStableSign = className;
                        
                        // Push to sentence buffer
                        capturedSigns.push(className);

                        // Push to display buffer (max 10 — drop oldest if full)
                        if (displaySigns.length >= MAX_DISPLAY_SIGNS) {
                            displaySigns.shift();
                        }
                        displaySigns.push(className);

                        // Render badges from display buffer
                        signsOutput.innerHTML = displaySigns
                            .map(s => `<span class="sign-badge">${s}</span>`)
                            .join('');
                        signsOutput.scrollTop = signsOutput.scrollHeight;
                        
                        // Reset idle timer as user is active
                        resetIdleTimer();
                    }
                    // Reset stability counter to avoid immediate duplicate detection
                    stableSignCounter = 0;
                }
            } else {
                // If confidence drops below threshold, reset pending sign
                currentPendingSign = null;
                stableSignCounter = 0;
            }
            
        } catch (err) {
            console.error("Prediction error:", err);
        }
    }, captureIntervalMs);
}

function stopAutoTranslation() {
    isTranslating = false;
    burstCaptureBtn.classList.remove('active');
    btnText.textContent = 'Start Auto-Translate';
    spinner.style.display = 'none';
    
    if (predictionIntervalId) {
        clearInterval(predictionIntervalId);
        predictionIntervalId = null;
    }
    
    clearTimeout(idleTimeoutId);
    idleTimeoutId = null;
    
    liveSignDisplay.textContent = '-';
    liveConfidenceDisplay.textContent = 'Confidence: 0%';
    captureStatus.textContent = 'Status: Auto-translation stopped.';
}

function resetIdleTimer() {
    clearTimeout(idleTimeoutId);
    
    if (capturedSigns.length > 0) {
        captureStatus.textContent = `Status: Waiting for pause... (Auto-translating in ${(IDLE_DELAY_MS / 1000).toFixed(1)}s)`;
        idleTimeoutId = setTimeout(async () => {
            captureStatus.textContent = 'Status: Translating automatically...';
            await translateSignsToSentence(capturedSigns);
            // Reset only the sentence buffer for the next translation
            capturedSigns = [];
        }, IDLE_DELAY_MS);
    }
}

// --- Direct Gemini API Translation Logic ---
async function translateSignsToSentence(signsArray) {
    if (!geminiApiKey) {
        translationOutput.textContent = "Error: Gemini API Key is missing. Configure it in the settings above.";
        captureStatus.textContent = 'Status: Error (Missing API Key)';
        return;
    }

    try {
        // Construct the prompt for Gemini
        const promptText = `I am building an app for mute/deaf people. The following is a sequence of hand sign labels detected by a computer vision model in chronological order: [${signsArray.join(', ')}]. 
Please translate this sequence of words/signs into a natural, easy-to-understand sentence that a normal hearing person would say. 
Output ONLY the final translated sentence, with no additional formatting, markdown, or explanation.`;

        // Direct request to Gemini model REST API
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: promptText
                    }]
                }]
            })
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            const errMsg = errBody.error?.message || `HTTP error ${response.status}`;
            throw new Error(errMsg);
        }

        const data = await response.json();
        const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (translatedText) {
            translationOutput.textContent = translatedText;
            captureStatus.textContent = 'Status: Translation complete. Ready for next sentence.';
        } else {
            throw new Error("Unexpected empty response structure from Gemini API");
        }
    } catch (error) {
        console.error("Translation error:", error);
        translationOutput.textContent = `Error during translation: ${error.message}`;
        captureStatus.textContent = 'Status: Translation error';
    }
}
