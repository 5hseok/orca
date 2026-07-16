import { AlertTriangle, Blocks, Loader2 } from 'lucide-react'
import type {
  PluginHostListEntry,
  PluginMarketplaceHostListing
} from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

type PluginMarketplaceListingRowProps = {
  listing: PluginMarketplaceHostListing
  installed: PluginHostListEntry | null
  busy: boolean
  onPreview: (listing: PluginMarketplaceHostListing, update: boolean) => void
}

export function PluginMarketplaceListingRow({
  listing,
  installed,
  busy,
  onPreview
}: PluginMarketplaceListingRowProps): React.JSX.Element {
  const blocked = listing.blockedByKillList
  const canCheckUpdate = installed?.source?.kind === 'marketplace'
  const name = listing.pluginKey
    .split('.')
    .at(-1)!
    .split(/[-_]+/)
    .map((word) =>
      word.toLowerCase() === 'orca' ? 'Orca' : `${word[0]?.toUpperCase()}${word.slice(1)}`
    )
    .join(' ')
  return (
    <article
      className="flex min-h-36 flex-col rounded-xl border border-border/80 bg-card p-4 text-card-foreground shadow-xs transition-colors hover:bg-accent/20"
      data-marketplace-plugin-key={listing.pluginKey}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-border/60 bg-muted/50 p-2.5 text-muted-foreground">
          <Blocks className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="text-sm font-semibold">{name}</h4>
            {listing.official ? (
              <Badge variant="outline" className="plugin-security-chrome">
                {translate(
                  'auto.components.settings.PluginMarketplaceListingRow.official',
                  'Official'
                )}
              </Badge>
            ) : null}
            {installed ? (
              <Badge variant="secondary">
                {translate(
                  'auto.components.settings.PluginMarketplaceListingRow.installed',
                  'Installed'
                )}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {listing.marketplaceOwner} · {listing.pluginKey}
          </p>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
        {listing.description ??
          translate(
            'auto.components.settings.PluginMarketplaceListingRow.noDescription',
            'No description provided.'
          )}
      </p>

      {blocked ? (
        <p className="plugin-security-chrome mt-2 flex items-start gap-1.5 text-xs leading-5 text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {translate(
              'auto.components.settings.PluginMarketplaceListingRow.blocked',
              "Blocked by Orca's safety list: {{value0}}",
              { value0: blocked.reason }
            )}
          </span>
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-3">
        <div className="flex min-w-0 flex-wrap gap-1">
          {listing.categories.slice(0, 3).map((category) => (
            <Badge key={category} variant="outline" className="text-[10px] text-muted-foreground">
              {category}
            </Badge>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-32"
          disabled={busy || Boolean(blocked) || Boolean(installed && !canCheckUpdate)}
          onClick={() => onPreview(listing, Boolean(canCheckUpdate))}
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          {blocked
            ? translate(
                'auto.components.settings.PluginMarketplaceListingRow.blockedAction',
                'Blocked'
              )
            : canCheckUpdate
              ? translate(
                  'auto.components.settings.PluginMarketplaceListingRow.checkUpdate',
                  'Check for update'
                )
              : installed
                ? translate(
                    'auto.components.settings.PluginMarketplaceListingRow.installedAction',
                    'Installed'
                  )
                : translate(
                    'auto.components.settings.PluginMarketplaceListingRow.install',
                    'Install'
                  )}
        </Button>
      </div>
    </article>
  )
}
