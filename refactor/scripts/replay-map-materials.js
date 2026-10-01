const normalizedTextureName = name => String(name || "")
  .trim()
  .toLowerCase()
  .replace(/^[+-]\d/, "");

export function replayMapMaterialOpacity(name) {
  const texture = normalizedTextureName(name);
  if (texture === "!c2a5") return 0.12;
  if (/^(water|slime|lava|toxic|liquid)(?:$|[_\d-])/.test(texture)) return 0.45;
  if (
    /(?:^|[_-])(laser|forcefield|force_field|energy)/.test(texture) ||
    /^(?:(?:e7|tsi)?beam)\d/.test(texture) ||
    /^orc26[rb]$/.test(texture)
  ) {
    return 0.20;
  }
  // GoldSrc light-fixture textures are non-solid overlays. Keep the fixtures
  // visible, but prevent their baked faces from writing depth and blocking
  // the free-roam camera.
  if (/~light/.test(texture)) return 0.72;
  // fry_baked_lg also bakes the light-volume fade faces as regular opaque
  // materials. Preserve a faint visual hint without making them occluders.
  if (texture === "fade" || texture === "fade2") return 0.08;
  return 1;
}

export function configureReplayMapMaterial(material, doubleSide) {
  if (!material) return;
  material.side = doubleSide;
  const targetOpacity = replayMapMaterialOpacity(material.name);
  if (targetOpacity === 0) {
    material.visible = false;
    material.transparent = true;
    material.opacity = 0;
    material.depthWrite = false;
    material.needsUpdate = true;
    return;
  }
  if (targetOpacity < 1) {
    material.transparent = true;
    material.opacity = Math.min(Number.isFinite(material.opacity) ? material.opacity : 1, targetOpacity);
    material.depthWrite = false;
    material.needsUpdate = true;
    return;
  }
  material.depthWrite = !material.transparent;
}

export function isReplayMapGroundMaterial(material, materialIndex = 0) {
  const candidate = Array.isArray(material) ? material[materialIndex] : material;
  return Boolean(
    candidate &&
    !(candidate.transparent && replayMapMaterialOpacity(candidate.name) < 1)
  );
}
