import { HomeTour, type HomeTourCopy } from '../viewer/HomeTour'
import type { MultiLevelHome } from '../data/homes/types'
import { SAMPLE_DUPLEX, SAMPLE_HOUSE } from './homes'
import type { DemoTourId } from './routes'

const NOTE = 'This is a demonstration home modelled by Roomio. It is not a property for sale; furniture, finishes and dimensions are illustrative.'

const TOURS: Record<DemoTourId, { home: MultiLevelHome; copy: HomeTourCopy }> = {
  duplex: {
    home: SAMPLE_DUPLEX,
    copy: {
      brand: 'Sample Duplex',
      badge: 'Interactive demo · illustrative home',
      kicker: 'Explore the layout',
      heading: <>Sample<br />3 BHK Duplex</>,
      intro: 'Walk through both floors of a duplex with a double-height living room. Pick a floor, open a room, or orbit the whole home.',
      note: NOTE,
      planCaption: 'Layout diagram · approximate wall positions',
      loadError: 'The demo home could not load.',
    },
  },
  house: {
    home: SAMPLE_HOUSE,
    copy: {
      brand: 'Sample 4 BHK House',
      badge: 'Interactive demo · illustrative home',
      kicker: 'Explore the layout',
      heading: <>Sample<br />4 BHK House</>,
      intro: 'Walk through a single-storey independent house: four bedrooms, a hall, two kitchens and a puja room. Open a room, or orbit the whole home.',
      note: NOTE,
      planCaption: 'Layout diagram · approximate wall positions',
      loadError: 'The demo home could not load.',
    },
  },
}

export default function DemoTour({ tour = 'duplex' }: { tour?: DemoTourId }) {
  const { home, copy } = TOURS[tour]
  // key: switching tours must remount, so the viewer reloads the other home
  return <HomeTour key={home.id} home={home} copy={copy} />
}
