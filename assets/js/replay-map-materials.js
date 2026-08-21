const normalizedTextureName = name => String(name || "")
  .trim()
  .toLowerCase()
  .replace(/^[+-]\d/, "");

export function replayMapMaterialOpacity(name) {
  const texture = normalizedTextureName(name);
  if (
    texture.startsWith("!") ||
    /^(water|slime|lava|toxic|liquid)(?:$|[_\d-])/.test(texture)
  ) {
    return 0.45;
  }
  if (
    /(?:^|[_-])(laser|forcefield|force_field|energy)/.test(texture) ||
    /^(?:(?:e7|tsi)?beam)\d/.test(texture) ||
    /^orc26[rb]$/.test(texture)
  ) {
    return 0.20;
  }
  // GoldSrc light-fixture textures are non-solid surfaces. The fry_baked_lg
  // GLB contains three large baked ~light primitives that otherwise become
  // opaque dark occluders in free roam; the actual surrounding map geometry
  // remains visible when these fixture faces are omitted.
  if (/~light/.test(texture)) return 0;
  return 1;
}

export function configureReplayMapMaterial(material, doubleSide) {
  if (!material) return;
  material.side = doubleSide;
  const targetOpacity = replayMapMaterialOpacity(material.name);
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
