// A tiny custom post Effect: multiply the linear HDR color by `exposure` BEFORE the ACESFilmic
// ToneMapping pass. This is G's exposure knob.
//
// Why a custom effect: with the Canvas in `flat` mode (renderer.toneMapping = NoToneMapping),
// renderer.toneMappingExposure is a NO-OP, and the ACES_FILMIC ToneMapping effect has no exposure
// uniform (the curve is fixed). Pre-scaling the linear color is the clean, decoupled way to expose
// up/down — it compensates the midtone darkening ACES introduces vs the old flat look, WITHOUT
// touching E's light intensities (E's domain). Placed as the second-to-last effect (before
// ToneMapping) so exposure is applied in linear space, then the filmic curve, then sRGB output.

import { Effect } from 'postprocessing'
import { Uniform } from 'three'
import { wrapEffect } from '@react-three/postprocessing'

const fragmentShader = /* glsl */ `
uniform float exposure;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
}
`

export class ExposureEffectImpl extends Effect {
  constructor({ exposure = 1.0 }: { exposure?: number } = {}) {
    super('ExposureEffect', fragmentShader, {
      uniforms: new Map<string, Uniform<number>>([['exposure', new Uniform(exposure)]]),
    })
  }

  /** R3F sets this declaratively when the `exposure` prop changes. */
  set exposure(v: number) {
    const u = this.uniforms.get('exposure') as Uniform<number> | undefined
    if (u) u.value = v
  }
  get exposure(): number {
    const u = this.uniforms.get('exposure') as Uniform<number> | undefined
    return u ? u.value : 1
  }
}

/** R3F component: <Exposure exposure={1.2} />. wrapEffect passes props to the constructor. */
export const Exposure = wrapEffect(ExposureEffectImpl)
