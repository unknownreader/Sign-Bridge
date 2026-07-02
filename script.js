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
let geminiApiKey = '';

let isTranslating = false;
let predictionIntervalId = null;
let capturedSigns = [];
let displaySigns = [];
const MAX_DISPLAY_SIGNS = 10;

// Stabilization state
let stableSignCounter = 0;
let lastStableSign = null;
let currentPendingSign = null;

// Idle / Auto-translate timeout state
let idleTimeoutId = null;
const IDLE_DELAY_MS = 4000;
const CONFIDENCE_THRESHOLD = 0.88;
const STABILITY_FRAMES = 5;

// --- Load Saved Settings from localStorage on Startup ---
window.addEventListener('DOMContentLoaded', async () => {
    const savedUrl = localStorage.getItem('signbridge_tmModelUrl');
    const savedKey = localStorage.getItem('signbridge_geminiApiKey');

    if (savedUrl) tmModelUrlInput.value = savedUrl;
    if (savedKey) geminiApiKeyInput.value = savedKey;

    if (savedUrl && savedKey) {
        showSettingsStatus('Saved settings found. Loading model...', '');
        await loadModel(savedUrl, savedKey);
    } else {
        showSettingsStatus('Enter your Model URL and API Key, then click Save.', '');
    }
});

// --- Save Settings & Load Model ---
saveSettingsBtn.addEventListener('click', async () => {
    const url = tmModelUrlInput.value.trim();
    const key = geminiApiKeyInput.value.trim();

    if (!url || !key) {
        showSettingsStatus('Both fields are required.', 'error');
        return;
    }

    // Save to localStorage (stays in browser only, never published)
    localStorage.setItem('signbridge_tmModelUrl', url);
    localStorage.setItem('signbridge_geminiApiKey', key);

    await loadModel(url, key);
});

async function loadModel(url, key) {
    try {
        saveSettingsBtn.disabled = true;
        showSettingsStatus('Loading Teachable Machine model...', '');

        let tmModelUrl = url;
        if (!tmModelUrl.endsWith('/')) {
            tmModelUrl += '/';
        }
        geminiApiKey = key;

        const modelURL = tmModelUrl + 'model.json';
        const metadataURL = tmModelUrl + 'metadata.json';

        model = await tmImage.load(modelURL, metadataURL);
        maxPredictions = model.getTotalClasses();

        showSettingsStatus('Model loaded successfully! ✅', 'success');
        updateCaptureButtonState();
    } catch (error) {
        console.error("Model loading error:", error);
        showSettingsStatus('Failed to load model. Check the URL.', 'error');
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        webcamElement.srcObject = stream;

        webcamElement.addEventListener('loadeddata', () => {
            isCameraReady = true;
            cameraOverlay.style.display = 'none';
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
        captureStatus.textContent = 'Status: Ready to translate.';
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

    const captureIntervalMs = 350;

    predictionIntervalId = setInterval(async () => {
        if (!model || !isCameraReady) return;

        try {
            const prediction = await model.predict(webcamElement);

            let bestPrediction = prediction[0];
            for (let i = 1; i < prediction.length; i++) {
                if (prediction[i].probability > bestPrediction.probability) {
                    bestPrediction = prediction[i];
                }
            }

            const className = bestPrediction.className;
            const probability = bestPrediction.probability;

            liveSignDisplay.textContent = className;
            liveConfidenceDisplay.textContent = `Confidence: ${(probability * 100).toFixed(0)}%`;

            if (probability >= CONFIDENCE_THRESHOLD) {
                if (className === currentPendingSign) {
                    stableSignCounter++;
                } else {
                    currentPendingSign = className;
                    stableSignCounter = 1;
                }

                if (stableSignCounter >= STABILITY_FRAMES) {
                    if (className !== lastStableSign) {
                        lastStableSign = className;
                        capturedSigns.push(className);

                        if (displaySigns.length >= MAX_DISPLAY_SIGNS) {
                            displaySigns.shift();
                        }
                        displaySigns.push(className);

                        signsOutput.innerHTML = displaySigns
                            .map(s => `<span class="sign-badge">${s}</span>`)
                            .join('');
                        signsOutput.scrollTop = signsOutput.scrollHeight;

                        resetIdleTimer();
                    }
                    stableSignCounter = 0;
                }
            } else {
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
            capturedSigns = [];
        }, IDLE_DELAY_MS);
    }
}

// --- Direct Gemini API Translation ---
async function translateSignsToSentence(signsArray) {
    if (!geminiApiKey) {
        translationOutput.textContent = "Error: Gemini API Key is missing. Configure it above.";
        captureStatus.textContent = 'Status: Error (Missing API Key)';
        return;
    }

    try {
        const promptText = `I am building an app for mute/deaf people. The following is a sequence of hand sign labels detected by a computer vision model in chronological order: [${signsArray.join(', ')}]. 
Please translate this sequence of words/signs into a natural, easy-to-understand sentence that a normal hearing person would say. 
Output ONLY the final translated sentence, with no additional formatting, markdown, or explanation.`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
            })
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error?.message || `HTTP error ${response.status}`);
        }

        const data = await response.json();
        const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (translatedText) {
            translationOutput.textContent = translatedText;
            captureStatus.textContent = 'Status: Translation complete. Ready for next sentence.';
        } else {
            throw new Error("Unexpected empty response from Gemini API");
        }
    } catch (error) {
        console.error("Translation error:", error);
        translationOutput.textContent = `Error: ${error.message}`;
        captureStatus.textContent = 'Status: Translation error';
    }
}
