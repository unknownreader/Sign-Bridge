// --- DOM Elements ---
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
const IDLE_DELAY_MS = 4000;       // 4 seconds idle to trigger translation (more time to chain signs)
const CONFIDENCE_THRESHOLD = 0.88; // Require high confidence before accepting a sign
const STABILITY_FRAMES = 5;        // Must hold same sign for 5 frames (~1.75s) to register

// --- Initialize and Load Model on Page Load ---
window.addEventListener('DOMContentLoaded', async () => {
    try {
        updateStatus('Initializing connection to backend...');
        
        // Fetch server configuration to get the Teachable Machine URL
        const configResponse = await fetch('/api/config');
        if (!configResponse.ok) {
            throw new Error(`Failed to fetch config from server (Status: ${configResponse.status})`);
        }
        
        const config = await configResponse.json();
        let tmModelUrl = config.tmModelUrl;
        
        if (!tmModelUrl) {
            updateStatus('Error: Teachable Machine model URL is not configured on the server. Please edit the .env file.');
            return;
        }

        updateStatus('Loading Teachable Machine model...');
        
        // Ensure URL ends with /
        if (!tmModelUrl.endsWith('/')) {
            tmModelUrl += '/';
        }

        const modelURL = tmModelUrl + 'model.json';
        const metadataURL = tmModelUrl + 'metadata.json';

        // Load the image model and metadata from Teachable Machine
        model = await tmImage.load(modelURL, metadataURL);
        maxPredictions = model.getTotalClasses();

        updateStatus('Model loaded. Please enable camera to start.');
        updateCaptureButtonState();
    } catch (error) {
        console.error("Initialization error:", error);
        updateStatus('Failed to load. Make sure the server is running and .env is configured.');
    }
});

function updateStatus(msg) {
    captureStatus.textContent = `Status: ${msg}`;
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
            updateStatus('Camera enabled. Ready to capture.');
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
        updateStatus('Ready to capture');
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
    
    updateStatus('Auto-translation active. Show signs to camera.');
    
    const captureIntervalMs = 350; // Check predictions every 350ms (slower, less twitchy)
    
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
                
                // If sign is held stable for enough consecutive frames (e.g. 3 frames = 600ms)
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
    updateStatus('Auto-translation stopped.');
}

function resetIdleTimer() {
    clearTimeout(idleTimeoutId);
    
    if (capturedSigns.length > 0) {
        updateStatus(`Waiting for pause... (Auto-translating in ${(IDLE_DELAY_MS / 1000).toFixed(1)}s)`);
        idleTimeoutId = setTimeout(async () => {
            updateStatus('Translating automatically...');
            await translateSignsToSentence(capturedSigns);
            // Reset only the sentence buffer for the next translation
            // Do NOT reset lastStableSign — prevents same sign from immediately re-registering
            capturedSigns = [];
        }, IDLE_DELAY_MS);
    }
}

// --- Backend API Translation Logic ---
async function translateSignsToSentence(signsArray) {
    try {
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ signs: signsArray })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || `HTTP error ${response.status}`);
        }

        const data = await response.json();
        translationOutput.textContent = data.translation;
        updateStatus('Translation complete. Ready for next sentence.');
    } catch (error) {
        console.error("Translation proxy error:", error);
        translationOutput.textContent = "Error during translation. Check server configuration.";
        updateStatus('Translation error');
    }
}
