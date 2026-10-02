import { EMBERCREST } from '../data/homes/embercrest'
import { HomeTour, type HomeTourCopy } from './HomeTour'

// Re-exported for ReleasedViewer and the existing tests.
export { FloorPlan } from './HomeTour'

const COPY: HomeTourCopy = {
  brand: 'Embercrest',
  badge: 'Local preview · source review pending',
  kicker: 'Explore the layout',
  heading: <>Embercrest<br />3 BHK Duplex</>,
  intro: 'A walk through the lower and upper floors, based on the supplied duplex plan.',
  area: <>148.57 m² carpet area <span>+ 24.85 m² balconies, as printed on the source plan</span></>,
  note: 'Furnishing and finishes illustrate possible use of the space. Dimensions and construction details require developer approval before publication.',
  planCaption: 'Layout diagram from the supplied plan · approximate wall positions',
  loadError: 'The Embercrest preview could not load.',
}

export default function EmbercrestViewer() {
  return <HomeTour home={EMBERCREST} copy={COPY} />
}
