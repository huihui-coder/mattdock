export default function RegionLabel({ regionName, regionId, className = '' }) {
  const label = regionName || regionId
  if (!label) return null
  return (
    <span
      className={`inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 border border-slate-200/80 ${className}`}
      title={regionId && regionName !== regionId ? regionId : undefined}
    >
      {label}
    </span>
  )
}
