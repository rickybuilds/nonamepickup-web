const MAP_ORIGIN = "https://pub-30546a4318334918a316a6a6fedea6c8.r2.dev";

export function loadReplayMap(loader, localUrl, onLoad, onProgress, onError) {
  const remoteUrl = new URL(localUrl, MAP_ORIGIN).href;
  loader.load(remoteUrl, onLoad, onProgress, () => {
    loader.load(localUrl, onLoad, onProgress, onError);
  });
}
