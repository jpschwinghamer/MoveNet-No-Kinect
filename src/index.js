import 'regenerator-runtime/runtime'
import '@tensorflow/tfjs-backend-webgl';
import * as mpPose from '@mediapipe/pose';
import * as tfjsWasm from '@tensorflow/tfjs-backend-wasm';
tfjsWasm.setWasmPaths(
    `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${
        tfjsWasm.version_wasm}/dist/`);
import * as posedetection from '@tensorflow-models/pose-detection';
import {Camera} from './camera';
import {setupDatGui} from './option_panel';
import {STATE} from './params';
import {setBackendAndEnvFlags} from './util';

let detector, camera;
let rafId;
let ws;

async function createDetector() {
  switch (STATE.model) {
    case posedetection.SupportedModels.PoseNet:
      return posedetection.createDetector(STATE.model, {
        quantBytes: 4,
        architecture: 'MobileNetV1',
        outputStride: 16,
        inputResolution: {width: 500, height: 500},
        multiplier: 0.75
      });
    case posedetection.SupportedModels.BlazePose:
      const runtime = STATE.backend.split('-')[0];
      if (runtime === 'mediapipe') {
        return posedetection.createDetector(STATE.model, {
          runtime,
          modelType: STATE.modelConfig.type,
          solutionPath: `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${mpPose.VERSION}`
        });
      } else if (runtime === 'tfjs') {
        return posedetection.createDetector(
            STATE.model, {runtime, modelType: STATE.modelConfig.type});
      }
    case posedetection.SupportedModels.MoveNet:
      let modelType;
      if (STATE.modelConfig.type == 'lightning') {
        modelType = posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING;
      } else if (STATE.modelConfig.type == 'thunder') {
        modelType = posedetection.movenet.modelType.SINGLEPOSE_THUNDER;
      } else if (STATE.modelConfig.type == 'multipose') {
        modelType = posedetection.movenet.modelType.MULTIPOSE_LIGHTNING;
      }
      const modelConfig = {modelType};

      if (STATE.modelConfig.customModel !== '') {
        modelConfig.modelUrl = STATE.modelConfig.customModel;
      }
      if (STATE.modelConfig.type === 'multipose') {
        modelConfig.enableTracking = STATE.modelConfig.enableTracking;
      }
      return posedetection.createDetector(STATE.model, modelConfig);
  }
}

async function checkGuiUpdate() {
  if (STATE.isTargetFPSChanged || STATE.isSizeOptionChanged || STATE.isInputChanged) {
    camera = await Camera.setupCamera(STATE.camera);
    STATE.isTargetFPSChanged = false;
    STATE.isSizeOptionChanged = false;
    STATE.isInputChanged = false;
  }

  if (STATE.ws.isConnectWebSocketChanged) {
    ws.close();
    setupWebSocket(STATE.ws.wsURL);
    STATE.ws.isConnectWebSocketChanged = false;
  }

  if (STATE.isModelChanged || STATE.isFlagChanged || STATE.isBackendChanged) {
    STATE.isModelChanged = true;

    window.cancelAnimationFrame(rafId);

    if (detector != null) {
      detector.dispose();
    }

    if (STATE.isFlagChanged || STATE.isBackendChanged) {
      await setBackendAndEnvFlags(STATE.flags, STATE.backend);
    }

    try {
      detector = await createDetector(STATE.model);
    } catch (error) {
      detector = null;
      alert(error);
    }

    STATE.isFlagChanged = false;
    STATE.isBackendChanged = false;
    STATE.isModelChanged = false;
  }
}

async function renderResult() {
  if (camera.video.readyState < 2) {
    await new Promise((resolve) => {
      camera.video.onloadeddata = () => {
        resolve(video);
      };
    });
  }

  let poses = null;

  // Detector can be null if initialization failed (for example when loading
  // from a URL that does not exist).
  if (detector != null) {

    // Detectors can throw errors, for example when using custom URLs that
    // contain a model that doesn't provide the expected output.
    try {
      poses = await detector.estimatePoses(
          camera.video,
          {maxPoses: STATE.modelConfig.maxPoses, flipHorizontal: false});
    } catch (error) {
      detector.dispose();
      detector = null;
      alert(error);
    }

  }
  if(STATE.camera.displayCanvas) {
    camera.drawCtx();
  }


  // The null check makes sure the UI is not in the middle of changing to a
  // different model. If during model change, the result is from an old model,
  // which shouldn't be rendered.
  if (poses && poses.length > 0 && !STATE.isModelChanged) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(poses));
    }
    if(STATE.camera.displayCanvas) {
      camera.drawResults(poses);
    }
  }
}

async function renderPrediction() {
  await checkGuiUpdate();

  if (!STATE.isModelChanged) {
    await renderResult();
  }

  rafId = requestAnimationFrame(renderPrediction);
};

async function app() {
  // Gui content will change depending on which model is in the query string.
  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.has('model')) {
    urlParams.model = 'movenet'
    // alert('Cannot find model in the query string.');
    // return;
  }

  let wsURL = 'wss://crosby-motion-web-socket.herokuapp.com:443'
  if (urlParams.has('wsURL')) {
    wsURL = urlParams.get('wsURL')
  }
  setupWebSocket(wsURL);
  await setupDatGui(urlParams);



  camera = await Camera.setupCamera(STATE.camera);

  await setBackendAndEnvFlags(STATE.flags, STATE.backend);

  detector = await createDetector();
  document.querySelector('aside').remove();
  renderPrediction();


};

function setupWebSocket(socketURL) {
  ws = new WebSocket(socketURL);

  // let keepAliveId;
  ws.onopen = event => {
    // console.log('Socket connection open');
    console.log('Successfully connected to socket server 🎉');
    ws.send('pong');
    // keepAliveId = setInterval(() => {
    //   wss.clients.forEach((client) => {
    //     if (client.readyState === WebSocket.OPEN) {
    //       client.send('ping');
    //     }
    //   });
    // }, 50000);
  }

  ws.onmessage = message => {
    if (message && message.data) {
      if (message.data === "ping") {
        console.log("got ping");
        ws.send("pong");
        return;
      }
    }
  }

  ws.onerror = error => {
    console.log('Error in the connection', error);
    alert('error connecting socket server', error);
  }

  ws.onclose = event => {
    console.log('Socket connection closed');
    alert('closing socket server');
    // clearInterval(keepAliveId);
  }
}

app();
