const MAP_ORIGIN = "https://noname-replay-maps.nnpugs.workers.dev";

export function loadReplayMap(loader, localUrl, onLoad, onProgress, onError) {
  const remoteUrl = new URL(localUrl, MAP_ORIGIN).href;
  loader.load(remoteUrl, onLoad, onProgress, () => {
    loader.load(localUrl, onLoad, onProgress, onError);
  });
}
