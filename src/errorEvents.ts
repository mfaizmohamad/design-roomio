/** Window event fired for every error an ErrorBoundary catches (see ErrorBoundary.tsx).
 *  `detail` is a {@link RenderErrorDetail}. */
export const RENDER_ERROR_EVENT = 'roomio:render-error'

export interface RenderErrorDetail {
  error: unknown
  componentStack: string
}
