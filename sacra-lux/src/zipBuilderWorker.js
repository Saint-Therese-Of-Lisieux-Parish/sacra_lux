const { parentPort, workerData } = require("worker_threads");
const { buildMassZipFromPackage } = require("./server");

buildMassZipFromPackage(workerData.packageDir, {
  avif: Boolean(workerData.avif),
  onProgress: (payload) => parentPort.postMessage({ type: "progress", payload })
})
  .then((buffer) => parentPort.postMessage(buffer, [buffer.buffer]))
  .catch((error) => {
    throw error;
  });
