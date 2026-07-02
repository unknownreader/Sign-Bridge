// --- DOM Elements ---
const tmModelUrlInput = document.getElementById('tm-model-url');
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

// --- Global State ---
let model = null;
let isCameraReady = false;
let maxPredictions = 0;
let tmModelUrl = '';

// --- Auto-load config from server on startup ---
(async () => {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        if (config.tmModelUrl) {
            tmModelUrlInput.value = config.tmModelUrl;
        }
    } catch (e) {
        console.error('Failed to load server config:', e);
    }
})();

// --- Configuration & Initialization ---
saveSettingsBtn.addEventListener('click', async () => {
    let url = tmModelUrlInput.value.trim();

    if (!url) {
        showSettingsStatus('Please provide the Model URL.', 'error');
        return;
    }

    // Ensure URL ends with /
    if (!url.endsWith('/')) {
        url += '/';
    }
    tmModelUrl = url;

    try {
        saveSettingsBtn.disabled = true;
        showSettingsStatus('Loading model...', '');

        // Load the image model and metadata from Teachable Machine
        const modelURL = tmModelUrl + 'model.json';
        const metadataURL = tmModelUrl + 'metadata.json';

        model = await tmImage.load(modelURL, metadataURL);
        maxPredictions = model.getTotalClasses();

        showSettingsStatus('Model loaded successfully!', 'success');
        updateCaptureButtonState();
    } catch (error) {
        console.error(error);
        showSettingsStatus('Failed to load model. Check the URL.', 'error');
    } finally {
        saveSettingsBtn.disabled = false;
    }
});

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
        captureStatus.textContent = 'Status: Ready to capture';
    }
}

// --- Burst Capture & Prediction Logic ---
burstCaptureBtn.addEventListener('click', async () => {
    // Disable button and show spinner
    burstCaptureBtn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'inline-block';
    
    signsOutput.textContent = '';
    translationOutput.textContent = '...';
    
    const burstDurationMs = 3000; // 3 seconds burst
    const captureIntervalMs = 500; // Capture every 500ms
    const capturedSigns = [];

    captureStatus.textContent = 'Status: Capturing signs...';

    // Capture frames periodically
    const intervalId = setInterval(async () => {
        const prediction = await model.predict(webcamElement);
        
        // Find the prediction with the highest probability
        let bestPrediction = prediction[0];
        for (let i = 1; i < prediction.length; i++) {
            if (prediction[i].probability > bestPrediction.probability) {
                bestPrediction = prediction[i];
            }
        }

        // Only add if probability is reasonably high to avoid noise
        // Assuming "Background" or similar classes might be ignored in a real setup,
        // we'll just push the highest confidence label.
        if (bestPrediction.probability > 0.6) {
            // Avoid adding immediate consecutive duplicates to keep sequence clean
            if (capturedSigns.length === 0 || capturedSigns[capturedSigns.length - 1] !== bestPrediction.className) {
                capturedSigns.push(bestPrediction.className);
                signsOutput.textContent = capturedSigns.join(' ➔ ');
            }
        }
    }, captureIntervalMs);

    // Stop capturing after burstDurationMs
    setTimeout(async () => {
        clearInterval(intervalId);
        
        if (capturedSigns.length === 0) {
            captureStatus.textContent = 'Status: No clear signs detected.';
            resetCaptureButton();
            return;
        }

        captureStatus.textContent = 'Status: Translating...';
        await translateSignsToSentence(capturedSigns);

    }, burstDurationMs);
});

function resetCaptureButton() {
    burstCaptureBtn.disabled = false;
    btnText.style.display = 'inline-block';
    spinner.style.display = 'none';
}

// --- Gemini Translation via Server Proxy ---
async function translateSignsToSentence(signsArray) {
    try {
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signs: signsArray })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || `Server error ${response.status}`);
        }

        const data = await response.json();
        translationOutput.textContent = data.translation;
        captureStatus.textContent = 'Status: Translation complete.';
    } catch (error) {
        console.error("Translation Error:", error);
        translationOutput.textContent = `Error: ${error.message}`;
        captureStatus.textContent = 'Status: Error';
    } finally {
        resetCaptureButton();
    }
}
