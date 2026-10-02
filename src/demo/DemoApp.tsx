import { lazy, Suspense } from 'react'
import { TOUR_PATHS, tourForPath } from './routes'
import { SITE, linkedinHref, mailtoHref } from './site'
import './demo.css'

// The tour pulls in the whole 3D engine. Keep it behind React.lazy so the landing
// page is a few KB and a visitor on a phone sees something before three.js arrives.
const DemoTour = lazy(() => import('./DemoTour'))

function TourLoading() {
  return (
    <div className="start">
      <div className="studio-loading">
        <div className="boot-spinner" />
        <div className="studio-loading-label">Loading the 3D tour…</div>
      </div>
    </div>
  )
}

function LinkedInIcon() {
  return (
    <svg className="demo-footer-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  )
}

/** SaaS-style footer: disclaimer, then © line left and contact links right. A link
 *  whose value is unset (or invalid) in ./site.ts is simply not rendered. */
export function Footer({ site = SITE, year = new Date().getFullYear() }: { site?: typeof SITE; year?: number }) {
  const linkedin = linkedinHref(site.linkedinUrl)
  const mail = mailtoHref(site.contactEmail)
  return (
    <footer className="demo-footer">
      <p className="demo-footer-note">The sample homes are demonstration homes modelled by Roomio. They are not properties for sale; furniture, finishes and dimensions are illustrative.</p>
      <div className="demo-footer-bar">
        <span>© {year} Roomio</span>
        {(mail || linkedin) && (
          <nav className="demo-footer-links" aria-label="Contact">
            {mail && <a href={mail}>Contact</a>}
            {/* rel=noopener: a new tab must not get window.opener back to us. */}
            {linkedin && (
              <a href={linkedin} target="_blank" rel="noopener noreferrer">
                <LinkedInIcon />
                LinkedIn
              </a>
            )}
          </nav>
        )}
      </div>
    </footer>
  )
}

export function Landing() {
  return (
    <div className="demo-landing">
      <header className="demo-nav">
        <span className="demo-logo">Roomio</span>
        <a className="demo-nav-cta" href="#homes">Choose a 3D tour</a>
      </header>

      <main>
        <section className="demo-hero">
          <p className="demo-kicker">Interactive 3D homes in the browser</p>
          <h1>Walk through a home before it is built.</h1>
          <p className="demo-lede">
            Roomio turns a floor plan into a furnished 3D home that anyone can explore from a link.
            No download and no sign-up, on a laptop or a phone.
          </p>
        </section>

        <section className="demo-homes" id="homes" aria-label="Choose a sample home">
          <a className="demo-home-card" href={TOUR_PATHS.duplex}>
            <span className="demo-home-emoji" aria-hidden="true">🏠</span>
            <span className="demo-home-title">3 BHK Duplex</span>
            <span className="demo-home-meta">Two floors · double-height living</span>
            <span className="demo-home-go">Explore the duplex →</span>
          </a>
          <a className="demo-home-card" href={TOUR_PATHS.house}>
            <span className="demo-home-emoji" aria-hidden="true">🏡</span>
            <span className="demo-home-title">4 BHK House</span>
            <span className="demo-home-meta">Single storey · hall, two kitchens, puja room</span>
            <span className="demo-home-go">Explore the house →</span>
          </a>
        </section>

        <section className="demo-features" aria-label="What the demo shows">
          <article>
            <h2>Every floor, one model</h2>
            <p>See the whole home at once, or isolate a floor of the duplex to read its layout.</p>
          </article>
          <article>
            <h2>Step into any room</h2>
            <p>Pick a room from the list to frame it in 3D. Orbit, zoom and pan with mouse or touch.</p>
          </article>
          <article>
            <h2>Plan view included</h2>
            <p>Switch to the 2D floor plan at any time. It also works on devices without 3D graphics.</p>
          </article>
        </section>
      </main>

      <Footer />
    </div>
  )
}

export function DemoApp() {
  const tour = tourForPath(window.location.pathname)
  if (tour) {
    return <Suspense fallback={<TourLoading />}><DemoTour tour={tour} /></Suspense>
  }
  return <Landing />
}
