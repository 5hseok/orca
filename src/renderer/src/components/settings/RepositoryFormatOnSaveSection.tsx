import type React from 'react'
import { useState } from 'react'
import type { Repo, RepoFormatOnSaveSettings } from '../../../../shared/types'
import {
  formatOnSaveIncludeToInput,
  getDefaultRepoFormatOnSaveSettings,
  normalizeRepoFormatOnSaveSettings,
  parseFormatOnSaveIncludeInput,
  SUGGESTED_FORMAT_ON_SAVE_COMMAND,
  SUGGESTED_FORMAT_ON_SAVE_INCLUDE
} from '../../../../shared/format-on-save-command'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSubsectionHeader, SettingsSwitchRow } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

type RepositoryFormatOnSaveSectionProps = {
  repo: Repo
  forceVisible?: boolean
  onUpdateFormatOnSave: (next: RepoFormatOnSaveSettings) => void
}

export function RepositoryFormatOnSaveSection({
  repo,
  forceVisible = false,
  onUpdateFormatOnSave
}: RepositoryFormatOnSaveSectionProps): React.JSX.Element {
  const settings = normalizeRepoFormatOnSaveSettings(
    repo.formatOnSave ?? getDefaultRepoFormatOnSaveSettings()
  )
  const isRemote =
    Boolean(repo.connectionId) || getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID

  const [commandDraft, setCommandDraft] = useState(settings.command)
  const [includeDraft, setIncludeDraft] = useState(formatOnSaveIncludeToInput(settings.include))
  const [committedSettings, setCommittedSettings] = useState(settings)

  // Why: the repo record can change outside this pane (another window, a sync);
  // reconcile before paint so the inputs never show a stale command.
  if (
    committedSettings.command !== settings.command ||
    formatOnSaveIncludeToInput(committedSettings.include) !==
      formatOnSaveIncludeToInput(settings.include)
  ) {
    setCommittedSettings(settings)
    setCommandDraft(settings.command)
    setIncludeDraft(formatOnSaveIncludeToInput(settings.include))
  }

  const commitCommand = (): void => {
    const command = commandDraft.trim()
    if (command === settings.command) {
      return
    }
    onUpdateFormatOnSave({ ...settings, command, enabled: settings.enabled && command.length > 0 })
  }

  const commitInclude = (): void => {
    const include = parseFormatOnSaveIncludeInput(includeDraft)
    if (formatOnSaveIncludeToInput(include) === formatOnSaveIncludeToInput(settings.include)) {
      return
    }
    onUpdateFormatOnSave({ ...settings, include })
  }

  const enableLabel = translate(
    'auto.components.settings.RepositoryFormatOnSaveSection.enableTitle',
    'Format on Save'
  )
  const enableDescription = translate(
    'auto.components.settings.RepositoryFormatOnSaveSection.enableDescription',
    "Run this project's formatter after Orca saves a file in this repository."
  )

  return (
    <section key="format-on-save" className="space-y-4">
      <SettingsSubsectionHeader
        title={enableLabel}
        description={translate(
          'auto.components.settings.RepositoryFormatOnSaveSection.sectionDescription',
          'Orca runs the command in the worktree root after each save, so the project’s own formatter config and version apply.'
        )}
      />

      <SearchableSetting
        title={enableLabel}
        description={enableDescription}
        keywords={['format', 'formatter', 'prettier', 'biome', 'gofmt', 'rustfmt', 'save']}
        forceVisible={forceVisible}
      >
        <SettingsSwitchRow
          label={enableLabel}
          description={enableDescription}
          checked={settings.enabled}
          onChange={() => onUpdateFormatOnSave({ ...settings, enabled: !settings.enabled })}
        />
        {settings.command.trim().length === 0 ? (
          // Why: an enabled toggle with no command would run nothing on every save,
          // so the switch stays off until one is set — say so instead of silently ignoring the click.
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.RepositoryFormatOnSaveSection.needsCommand',
              'Set a formatter command below to turn this on.'
            )}
          </p>
        ) : null}
      </SearchableSetting>

      <SearchableSetting
        title={translate(
          'auto.components.settings.RepositoryFormatOnSaveSection.commandTitle',
          'Formatter Command'
        )}
        description={translate(
          'auto.components.settings.RepositoryFormatOnSaveSection.commandDescription',
          'Shell command run in the worktree root. ${file} and ${relativeFile} expand to the saved file.'
        )}
        keywords={['command', 'formatter', 'prettier', 'oxfmt', 'ruff']}
        forceVisible={forceVisible}
        className="space-y-2 py-2"
      >
        <Label htmlFor="format-on-save-command">
          {translate(
            'auto.components.settings.RepositoryFormatOnSaveSection.commandTitle',
            'Formatter Command'
          )}
        </Label>
        <Input
          id="format-on-save-command"
          value={commandDraft}
          spellCheck={false}
          placeholder={SUGGESTED_FORMAT_ON_SAVE_COMMAND}
          onChange={(event) => setCommandDraft(event.target.value)}
          onBlur={commitCommand}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitCommand()
            }
          }}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.RepositoryFormatOnSaveSection.commandHint',
            'A non-zero exit leaves the saved file untouched and shows the formatter’s error.'
          )}
        </p>
      </SearchableSetting>

      <SearchableSetting
        title={translate(
          'auto.components.settings.RepositoryFormatOnSaveSection.includeTitle',
          'Included Files'
        )}
        description={translate(
          'auto.components.settings.RepositoryFormatOnSaveSection.includeDescription',
          'Comma-separated globs limiting which saved files run the command. Leave empty to format every saved file.'
        )}
        keywords={['glob', 'include', 'files', 'extensions']}
        forceVisible={forceVisible}
        className="space-y-2 py-2"
      >
        <Label htmlFor="format-on-save-include">
          {translate(
            'auto.components.settings.RepositoryFormatOnSaveSection.includeTitle',
            'Included Files'
          )}
        </Label>
        <Input
          id="format-on-save-include"
          value={includeDraft}
          spellCheck={false}
          placeholder={SUGGESTED_FORMAT_ON_SAVE_INCLUDE}
          onChange={(event) => setIncludeDraft(event.target.value)}
          onBlur={commitInclude}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitInclude()
            }
          }}
          className="font-mono text-xs"
        />
      </SearchableSetting>

      {isRemote ? (
        <p className="max-w-3xl text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.RepositoryFormatOnSaveSection.remoteNotice',
            'This project runs on a remote host. Saves there are written unformatted — Orca only runs the formatter for local and WSL worktrees.'
          )}
        </p>
      ) : null}
    </section>
  )
}
