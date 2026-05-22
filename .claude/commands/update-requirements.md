# Update Requirements

Sync `spec/reference/requirements.md` status and counts after implementation work.

## Steps

1. **Scan recent changes:** Run `git log --oneline -20` to identify recently implemented features.

2. **Update status values in section 4:** For each implemented feature, set its status to `Implemented` in the corresponding section table. Valid statuses: `Implemented` | `In progress` | `Not started` | `Not supported (reason)` | `Removed (reason)`.

3. **Regenerate the Progress Summary table:** Run `npm run sync:requirements`. The script re-derives the Progress Summary from the section tables and rewrites the fenced region at the top of section 4.

4. **Check README.md:** For any newly implemented user-visible features, verify the README's feature matrix and annotation reference reflect the capability.

5. **Report:** Summarize what was updated (which feature IDs moved status, what the sync script changed).
