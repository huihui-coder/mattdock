import RegionSettings from './RegionSettings'

export default function AccountManager({
  scopeRegionId,
  onScopeRegionChange,
  onRegionsChanged,
}) {
  return (
    <RegionSettings
      scopeRegionId={scopeRegionId}
      onScopeRegionChange={onScopeRegionChange}
      onRegionsChanged={onRegionsChanged}
    />
  )
}
