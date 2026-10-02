import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { coerceDesign } from '../persistence'
import { collection, organization, named, unit, home, personalDesign, asset, version, release,
  type Organization, type Named, type Unit, type Home, type PersonalDesign, type Asset,
  type Version, type Release } from './boundary'
import './workspace.css'

const canManage = (role: Organization['role']) => role === 'owner' || role === 'admin'
const canEdit = (role: Organization['role']) => canManage(role) || role === 'editor'
const canReview = (role: Organization['role']) => canManage(role) || role === 'publisher'
const problem = (error: unknown) => error instanceof Error ? error.message : 'The request failed'
const path = (orgId: string, projectId: string) => `/orgs/${orgId}/projects/${projectId}`

/** Staff workspace for tenant-scoped project setup, home import, assets and release inspection. */
export default function DeveloperWorkspace() {
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgId, setOrgId] = useState('')
  const [projects, setProjects] = useState<Named[]>([])
  const [projectId, setProjectId] = useState('')
  const [types, setTypes] = useState<Named[]>([])
  const [typeId, setTypeId] = useState('')
  const [units, setUnits] = useState<Unit[]>([])
  const [homes, setHomes] = useState<Home[]>([])
  const [designs, setDesigns] = useState<PersonalDesign[]>([])
  const [designId, setDesignId] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [assetId, setAssetId] = useState('')
  const [versions, setVersions] = useState<Version[]>([])
  const [releases, setReleases] = useState<Release[]>([])
  const [releaseError, setReleaseError] = useState('')
  const [releaseLoading, setReleaseLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [orgName, setOrgName] = useState('')
  const [projectName, setProjectName] = useState('')
  const [typeName, setTypeName] = useState('')
  const [unitLabel, setUnitLabel] = useState('')
  const [unitTypeId, setUnitTypeId] = useState('')
  const [assetName, setAssetName] = useState('')
  const [rightsHolder, setRightsHolder] = useState('')
  const [rightsRef, setRightsRef] = useState('')
  const [measureSource, setMeasureSource] = useState('')
  const [width, setWidth] = useState('')
  const [depth, setDepth] = useState('')
  const [height, setHeight] = useState('')
  const [publicRights, setPublicRights] = useState(false)
  const [uploadVersion, setUploadVersion] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const currentOrg = orgs.find((item) => item.id === orgId)
  const role = currentOrg?.role
  const base = orgId && projectId ? path(orgId, projectId) : ''

  useEffect(() => {
    let live = true
    api.get<unknown>('/orgs').then((raw) => {
      if (!live) return
      const rows = collection(raw, organization)
      setOrgs(rows)
      setOrgId((prior) => rows.some((row) => row.id === prior) ? prior : rows[0]?.id ?? '')
    }).catch((cause: unknown) => { if (live) setError(problem(cause)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    setProjects([]); setProjectId(''); setTypes([]); setTypeId(''); setUnits([])
    setHomes([]); setAssets([]); setAssetId(''); setVersions([]); setReleases([])
    if (!orgId) return
    let live = true
    setLoading(true); setError('')
    api.get<unknown>(`/orgs/${orgId}/projects`).then((raw) => {
      if (!live) return
      const rows = collection(raw, named)
      setProjects(rows)
      setProjectId(rows[0]?.id ?? '')
    }).catch((cause: unknown) => { if (live) setError(problem(cause)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [orgId])

  useEffect(() => {
    setTypes([]); setTypeId(''); setUnits([]); setHomes([]); setAssets([])
    setAssetId(''); setVersions([]); setReleases([]); setReleaseError('')
    if (!base) return
    let live = true
    setReleaseLoading(true)
    setLoading(true); setError('')
    Promise.all([
      api.get<unknown>(`${base}/unit-types`), api.get<unknown>(`${base}/units`),
      api.get<unknown>(`${base}/assets`),
    ]).then(([typesRaw, unitsRaw, assetsRaw]) => {
      if (!live) return
      const nextTypes = collection(typesRaw, named)
      const nextAssets = collection(assetsRaw, asset)
      setTypes(nextTypes); setTypeId(nextTypes[0]?.id ?? '')
      setUnitTypeId(nextTypes[0]?.id ?? '')
      setUnits(collection(unitsRaw, unit))
      setAssets(nextAssets); setAssetId(nextAssets[0]?.id ?? '')
    }).catch((cause: unknown) => { if (live) setError(problem(cause)) })
      .finally(() => { if (live) setLoading(false) })
    api.get<unknown>(`${base}/releases`).then((raw) => {
      if (live) setReleases(collection(raw, release))
    }).catch((cause: unknown) => {
      if (live) setReleaseError(cause instanceof ApiError && cause.status === 404
        ? 'Release inventory is not available on this server yet.' : problem(cause))
    }).finally(() => { if (live) setReleaseLoading(false) })
    return () => { live = false }
  }, [base])

  useEffect(() => {
    setHomes([])
    if (!base || !typeId) return
    let live = true
    api.get<unknown>(`${base}/unit-types/${typeId}/homes`).then((raw) => {
      if (live) setHomes(collection(raw, home))
    }).catch((cause: unknown) => { if (live) setError(problem(cause)) })
    return () => { live = false }
  }, [base, typeId])

  useEffect(() => {
    setVersions([])
    if (!base || !assetId) return
    let live = true
    api.get<unknown>(`${base}/assets/${assetId}/versions`).then((raw) => {
      if (live) setVersions(collection(raw, version))
    }).catch((cause: unknown) => { if (live) setError(problem(cause)) })
    return () => { live = false }
  }, [base, assetId])

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (cause) { setError(problem(cause)) }
    finally { setBusy(false) }
  }

  const refresh = async () => {
    const rows = collection(await api.get<unknown>('/orgs'), organization)
    setOrgs(rows)
    if (orgId && !rows.some((row) => row.id === orgId)) setOrgId(rows[0]?.id ?? '')
    if (!base) return
    const [projectRaw, typeRaw, unitRaw, assetRaw, releaseRaw] = await Promise.all([
      api.get<unknown>(`/orgs/${orgId}/projects`), api.get<unknown>(`${base}/unit-types`),
      api.get<unknown>(`${base}/units`), api.get<unknown>(`${base}/assets`),
      api.get<unknown>(`${base}/releases`),
    ])
    setProjects(collection(projectRaw, named)); setTypes(collection(typeRaw, named))
    setUnits(collection(unitRaw, unit)); setAssets(collection(assetRaw, asset))
    setReleases(collection(releaseRaw, release))
    if (typeId) setHomes(collection(await api.get<unknown>(`${base}/unit-types/${typeId}/homes`), home))
    if (assetId) setVersions(collection(await api.get<unknown>(`${base}/assets/${assetId}/versions`), version))
  }

  const createOrg = (event: FormEvent) => { event.preventDefault(); void act(async () => {
    const created = organization(await api.post<unknown>('/orgs', { name: orgName.trim() }))
    if (!created) throw new Error('The server returned an invalid organization')
    setOrgs((items) => [created, ...items]); setOrgName(''); setOrgId(created.id)
    setNotice('Organization created.')
  }) }
  const createProject = (event: FormEvent) => { event.preventDefault(); void act(async () => {
    const created = named(await api.post<unknown>(`/orgs/${orgId}/projects`, { name: projectName.trim() }))
    if (!created) throw new Error('The server returned an invalid project')
    setProjects((items) => [created, ...items]); setProjectName(''); setProjectId(created.id)
    setNotice('Project created.')
  }) }
  const createType = (event: FormEvent) => { event.preventDefault(); void act(async () => {
    const created = named(await api.post<unknown>(`${base}/unit-types`, { name: typeName.trim() }))
    if (!created) throw new Error('The server returned an invalid unit type')
    setTypes((items) => [created, ...items]); setTypeName(''); setTypeId(created.id)
    setUnitTypeId(created.id); setNotice('Unit type created.')
  }) }
  const createUnit = (event: FormEvent) => { event.preventDefault(); void act(async () => {
    const created = unit(await api.post<unknown>(`${base}/units`, { label: unitLabel.trim(), unitTypeId }))
    if (!created) throw new Error('The server returned an invalid unit')
    setUnits((items) => [created, ...items]); setUnitLabel(''); setNotice('Unit created.')
  }) }
  const loadDesigns = () => { void act(async () => {
    const summaries = collection(await api.get<unknown>('/designs'), personalDesign)
    setDesigns(summaries); setDesignId(summaries[0]?.id ?? '')
    setNotice('Your personal designs are ready for review. Only whole-home designs can be imported.')
  }) }
  const importHome = () => { void act(async () => {
    const raw = await api.get<unknown>(`/designs/${encodeURIComponent(designId)}`)
    const design = coerceDesign(raw)
    if (!design?.house || design.house.rooms.length === 0) {
      throw new Error('Select a saved whole-home design. A single room cannot be imported.')
    }
    const response = await api.post<unknown>(`${base}/unit-types/${typeId}/homes/import`, { designId })
    const created = response !== null && typeof response === 'object' ? response as Record<string, unknown> : null
    if (!created || typeof created.id !== 'string') throw new Error('The server did not confirm the import')
    setHomes(collection(await api.get<unknown>(`${base}/unit-types/${typeId}/homes`), home))
    setNotice('Whole home copied into this unit type. Your personal design remains private.')
  }) }
  const createAsset = (event: FormEvent) => { event.preventDefault(); void act(async () => {
    const created = asset(await api.post<unknown>(`${base}/assets`, { name: assetName.trim() }))
    if (!created) throw new Error('The server returned an invalid asset')
    setAssets((items) => [created, ...items]); setAssetName(''); setAssetId(created.id)
    setNotice('Private asset created. Add its measured and rights-reviewed version next.')
  }) }
  const createVersion = (event: FormEvent) => { event.preventDefault(); void act(async () => {
    const measured = [width, depth, height].map(Number)
    if (measured.some((n) => !Number.isFinite(n) || n <= 0 || n > 2000)) throw new Error('Enter measured dimensions in centimetres, up to 2000.')
    const raw = await api.post<unknown>(`${base}/assets/${assetId}/versions`, {
      rightsHolder: rightsHolder.trim(), rightsScope: publicRights ? 'private-review,public-display' : 'private-review',
      rightsEvidenceRef: rightsRef.trim(), measurementSource: measureSource.trim(),
      measuredWidthCm: measured[0], measuredDepthCm: measured[1], measuredHeightCm: measured[2],
    })
    const created = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : null
    if (!created || typeof created.id !== 'string') throw new Error('The server did not confirm the version')
    setVersions(collection(await api.get<unknown>(`${base}/assets/${assetId}/versions`), version))
    setUploadVersion(created.id); setNotice('Version reserved. Upload its GLB to start review.')
  }) }
  const upload = () => { void act(async () => {
    if (!uploadFile || !uploadVersion) throw new Error('Select a reserved version and a GLB file.')
    if (uploadFile.size === 0 || uploadFile.size > 10 * 1024 * 1024) throw new Error('GLB must be between 1 byte and 10 MB.')
    if (!uploadFile.name.toLowerCase().endsWith('.glb')) throw new Error('Choose a .glb file.')
    let response: Response
    try {
      response = await fetch(`/api${base}/assets/${assetId}/versions/${uploadVersion}/content`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'model/gltf-binary' }, body: uploadFile,
      })
    } catch { throw new Error('Could not reach the server') }
    if (!response.ok) {
      const raw: unknown = await response.json().catch(() => null)
      const detail = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string' ? raw.error : `Upload failed (${response.status})`
      throw new Error(detail)
    }
    setVersions(collection(await api.get<unknown>(`${base}/assets/${assetId}/versions`), version))
    setUploadFile(null); setNotice('GLB uploaded as a private draft. An independent reviewer must approve it.')
  }) }
  const approve = (versionId: string) => { void act(async () => {
    await api.post<unknown>(`${base}/assets/${assetId}/versions/${versionId}/approve`)
    setVersions(collection(await api.get<unknown>(`${base}/assets/${assetId}/versions`), version))
    setNotice('Asset version approved. Its recorded physical dimensions and rights are now fixed.')
  }) }

  return <main className="developer-workspace">
    <header className="developer-header"><a href="/" className="developer-mark">Roomio</a><span>Developer workspace</span></header>
    <div className="developer-shell">
      <div className="developer-intro"><p className="developer-eyebrow">Projects and sales experiences</p>
        <h1>Build a home buyers can explore.</h1>
        <p>Organize unit types, import complete homes, review furniture and inspect published releases. Every project stays inside its organization.</p></div>
      {error && <p className="developer-alert" role="alert">{error}</p>}
      {notice && <p className="developer-notice" role="status">{notice}</p>}
      {loading && <p className="developer-loading" role="status">Loading workspace…</p>}

      <section className="developer-panel" aria-labelledby="developer-org-title">
        <div className="developer-panel-head"><div><p className="developer-step">01 / Organization</p><h2 id="developer-org-title">Choose your team</h2></div>{role && <span className="developer-role">{role}</span>}</div>
        <label>Organization<select value={orgId} onChange={(event) => setOrgId(event.target.value)} disabled={busy}>
          <option value="">Choose an organization</option>{orgs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        {orgs.length === 0 && !loading && <p className="developer-empty">You have no developer organization yet.</p>}
        <form className="developer-inline" onSubmit={createOrg}><label>New organization<input value={orgName} onChange={(event) => setOrgName(event.target.value)} maxLength={120} required placeholder="Developer company" /></label><button disabled={busy || !orgName.trim()}>Create organization</button></form>
      </section>

      {currentOrg && <section className="developer-panel" aria-labelledby="developer-project-title">
        <div className="developer-panel-head"><div><p className="developer-step">02 / Development</p><h2 id="developer-project-title">Project and unit types</h2></div></div>
        <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={busy}>
          <option value="">Choose a project</option>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        {canManage(role!) && <form className="developer-inline" onSubmit={createProject}><label>New project<input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={120} required placeholder="Residential development" /></label><button disabled={busy || !projectName.trim()}>Create project</button></form>}
        {base && <>
          <label>Unit type<select value={typeId} onChange={(event) => setTypeId(event.target.value)} disabled={busy}>
            <option value="">Choose a unit type</option>{types.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
          {canEdit(role!) && <form className="developer-inline" onSubmit={createType}><label>New unit type<input value={typeName} onChange={(event) => setTypeName(event.target.value)} maxLength={120} required placeholder="Duplex · 4 bedroom" /></label><button disabled={busy || !typeName.trim()}>Add unit type</button></form>}
          <h3>Units <span>{units.length}</span></h3>
          {units.length ? <ul className="developer-list">{units.map((item) => <li key={item.id}><b>{item.label}</b><small>{types.find((type) => type.id === item.unitTypeId)?.name ?? 'Unit type unavailable'}</small></li>)}</ul> : <p className="developer-empty">No units in this project yet.</p>}
          {canEdit(role!) && types.length > 0 && <form className="developer-inline" onSubmit={createUnit}><label>Unit label<input value={unitLabel} onChange={(event) => setUnitLabel(event.target.value)} maxLength={80} required placeholder="Villa 01" /></label><label>Type<select value={unitTypeId} onChange={(event) => setUnitTypeId(event.target.value)} required>{types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button disabled={busy || !unitLabel.trim()}>Add unit</button></form>}
        </>}
      </section>}

      {base && typeId && <section className="developer-panel" aria-labelledby="developer-homes-title">
        <div className="developer-panel-head"><div><p className="developer-step">03 / Home designs</p><h2 id="developer-homes-title">Homes in this unit type</h2></div><span className="developer-count">{homes.length}</span></div>
        {homes.length ? <ul className="developer-list">{homes.map((item) => <li key={item.id}><b>{item.name}</b><small>Revision {item.revision} · Updated {new Date(item.updatedAt).toLocaleDateString()}</small></li>)}</ul> : <p className="developer-empty">No project homes yet. Import a complete personal design to start.</p>}
        {canEdit(role!) && <div className="developer-import"><h3>Import a whole home</h3><p>Import makes a separate project copy. Your personal design remains in your account. Single-room designs are not eligible.</p>
          <button className="developer-secondary" onClick={loadDesigns} disabled={busy}>Load my saved designs</button>
          {designs.length > 0 && <div className="developer-inline"><label>Personal design<select value={designId} onChange={(event) => setDesignId(event.target.value)}>{designs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button onClick={importHome} disabled={busy || !designId}>Review and import</button></div>}
          {designs.length === 0 && <p className="developer-empty">No personal designs loaded.</p>}</div>}
      </section>}

      {base && <section className="developer-panel" aria-labelledby="developer-assets-title">
        <div className="developer-panel-head"><div><p className="developer-step">04 / Furnishing library</p><h2 id="developer-assets-title">Private furniture assets</h2></div><span className="developer-count">{assets.length}</span></div>
        <p>Uploaded models stay private until a separate reviewer approves the exact version. Record physical measurements from a trusted source.</p>
        <label>Asset<select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Choose an asset</option>{assets.map((item) => <option key={item.id} value={item.id}>{item.name}{item.brand ? ` · ${item.brand}` : ''}</option>)}</select></label>
        {canEdit(role!) && <form className="developer-inline" onSubmit={createAsset}><label>New asset<input value={assetName} onChange={(event) => setAssetName(event.target.value)} maxLength={120} required placeholder="Measured dining chair" /></label><button disabled={busy || !assetName.trim()}>Add asset</button></form>}
        {assetId && <><h3>Versions</h3>{versions.length ? <ul className="developer-list">{versions.map((item) => <li key={item.id}><b>Version {item.id.slice(0, 8)}</b><span className={`developer-status ${item.status}`}>{item.status}</span><small>{item.measuredWidthCm} × {item.measuredDepthCm} × {item.measuredHeightCm} cm {item.sha256 ? `· SHA-256 ${item.sha256.slice(0, 12)}…` : ''}</small>{item.status === 'draft' && canReview(role!) && <button className="developer-secondary" onClick={() => approve(item.id)} disabled={busy}>Approve as independent reviewer</button>}</li>)}</ul> : <p className="developer-empty">No versions yet.</p>}
          {canEdit(role!) && <form className="developer-version-form" onSubmit={createVersion}><h3>Reserve a measured version</h3><div className="developer-fields"><label>Rights holder<input value={rightsHolder} onChange={(event) => setRightsHolder(event.target.value)} maxLength={120} required /></label><label>Rights evidence reference<input value={rightsRef} onChange={(event) => setRightsRef(event.target.value)} maxLength={200} required /></label><label>Measurement source<input value={measureSource} onChange={(event) => setMeasureSource(event.target.value)} maxLength={200} required /></label><label>Width · cm<input type="number" min="0.01" max="2000" step="0.01" value={width} onChange={(event) => setWidth(event.target.value)} required /></label><label>Depth · cm<input type="number" min="0.01" max="2000" step="0.01" value={depth} onChange={(event) => setDepth(event.target.value)} required /></label><label>Height · cm<input type="number" min="0.01" max="2000" step="0.01" value={height} onChange={(event) => setHeight(event.target.value)} required /></label></div><label className="developer-check"><input type="checkbox" checked={publicRights} onChange={(event) => setPublicRights(event.target.checked)} />Evidence permits public display of this exact model</label><button disabled={busy}>Reserve version</button></form>}
          {canEdit(role!) && versions.some((item) => item.status === 'reserved') && <div className="developer-upload"><h3>Upload GLB</h3><div className="developer-inline"><label>Reserved version<select value={uploadVersion} onChange={(event) => setUploadVersion(event.target.value)}><option value="">Choose version</option>{versions.filter((item) => item.status === 'reserved').map((item) => <option key={item.id} value={item.id}>{item.id.slice(0, 8)}</option>)}</select></label><label>GLB file<input type="file" accept=".glb,model/gltf-binary" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /></label><button onClick={upload} disabled={busy || !uploadFile || !uploadVersion}>Upload private draft</button></div></div>}
        </>}
      </section>}

      {base && <section className="developer-panel" aria-labelledby="developer-releases-title">
        <div className="developer-panel-head"><div><p className="developer-step">05 / Buyer experience</p><h2 id="developer-releases-title">Release inventory</h2></div><span className="developer-count">{releases.length}</span></div>
        {releaseLoading ? <p className="developer-empty" role="status">Loading release inventory…</p> :
          releaseError ? <p className="developer-alert" role="alert">{releaseError}</p> : releases.length ?
          <ul className="developer-list">{releases.map((item) => <li key={item.id}><b>{homes.find((candidate) => candidate.id === item.homeId)?.name ?? `Home ${item.homeId.slice(0, 8)}`}</b><span className={`developer-status ${item.state}`}>{item.state}</span><small>Created {new Date(item.createdAt).toLocaleDateString()} · Release {item.id.slice(0, 8)}</small>{item.state === 'published' && <a href={`/release/${item.id}`} target="_blank" rel="noopener noreferrer">Open buyer view</a>}</li>)}</ul> : <p className="developer-empty">No releases in this project. A reviewed source package and approval are required before publication.</p>}
        <p className="developer-caution">The Embercrest prototype is not approved for public sales. Its local showcase is a preview only.</p>
        <button className="developer-secondary" onClick={() => { void act(async () => { await refresh(); setNotice('Workspace refreshed.') }) }} disabled={busy}>Refresh workspace</button>
      </section>}
    </div>
  </main>
}
