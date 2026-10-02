/**
 * Agent H — TRIPLANAR projection fallback (H1 safety net / brief §6).
 *
 * Roomio's corpus is all primitive geometry, so every mesh already has UVs (no "only dots").
 * But a FEW meshes distort a tiled texture under their DEFAULT UVs: the freestanding tub
 * (a cylinder scaled non-uniformly to fake an ellipse) and the open lamp-shade cone. For those,
 * triplanar projection samples the texture in WORLD space along the three axes and blends by the
 * surface normal, giving uniform scale with NO stretching/seams regardless of geometry — the
 * pragmatic "every asset supports textures" floor for boxy/odd furniture.
 *
 * Applied via onBeforeCompile so MeshStandard lighting (E) + IBL/tone-map (G) still drive the
 * shading; we only swap how `map` and `roughnessMap` are sampled. (The normal map stays on UVs —
 * it's a subtle relief; proper triplanar normal blending is deferred.) Albedo is sRGB-decoded in
 * the shader since we bypass three's map_fragment colorSpace handling.
 */
import * as THREE from 'three'

const VERT_HEAD = 'varying vec3 vTriPos;\nvarying vec3 vTriNrm;\n'
const VERT_BODY =
  '#include <begin_vertex>\n  vTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vTriNrm = normalize(mat3(modelMatrix) * objectNormal);'

const FRAG_HEAD = `varying vec3 vTriPos;
varying vec3 vTriNrm;
uniform float uTriScale;
vec3 triSrgbToLinear(vec3 c){ return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 triSample(sampler2D tex){
  vec3 bw = pow(abs(vTriNrm), vec3(4.0));
  bw /= (bw.x + bw.y + bw.z + 1e-5);
  return texture2D(tex, vTriPos.zy * uTriScale).rgb * bw.x
       + texture2D(tex, vTriPos.xz * uTriScale).rgb * bw.y
       + texture2D(tex, vTriPos.xy * uTriScale).rgb * bw.z;
}
`

/** Make a MeshStandardMaterial sample its map + roughnessMap triplanar in world space.
 *  `repeatCm` = world cm spanned by one tile (matches the AppliedTexture tiling control). */
export function applyTriplanar(mat: THREE.MeshStandardMaterial, repeatCm: number): THREE.MeshStandardMaterial {
  const scale = repeatCm > 0 ? 100 / repeatCm : 2.5 // tiles per world meter
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTriScale = { value: scale }
    shader.vertexShader = (VERT_HEAD + shader.vertexShader).replace('#include <begin_vertex>', VERT_BODY)
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#ifdef USE_MAP\n  diffuseColor.rgb *= triSrgbToLinear(triSample(map));\n#endif',
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      'float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\n  roughnessFactor *= triSample(roughnessMap).g;\n#endif',
    )
  }
  // distinct program cache key so the triplanar variant doesn't collide with UV materials
  mat.customProgramCacheKey = () => 'h-triplanar:' + scale.toFixed(4)
  mat.needsUpdate = true
  return mat
}

/** Should this mesh use triplanar? (anisotropic world scale, or an explicit userData flag.) */
export function needsTriplanar(mesh: THREE.Mesh, threshold = 1.6): boolean {
  if (mesh.userData && mesh.userData.triplanar) return true
  mesh.updateWorldMatrix(true, false)
  const s = new THREE.Vector3()
  mesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s)
  const mx = Math.max(s.x, s.y, s.z)
  const mn = Math.min(s.x, s.y, s.z)
  return mn > 1e-6 && mx / mn >= threshold // strongly non-uniform scale ⇒ UVs would stretch
}
