# Update Requirements

Sync REQUIREMENTS.md status and counts after implementation work.

## Steps

1. **Scan recent changes:** Run `git log --oneline -20` to identify recently implemented features.

2. **Update status values in section 4:** For each implemented feature, set its status to `Implemented` in the corresponding section table. Valid statuses: `Implemented` | `In progress` | `Not started` | `Not supported (reason)` | `Removed (reason)`.

3. **Recount the Progress Summary table:** Count the actual status values in each section (4.1 through 4.15) and update the Progress Summary table at the top of section 4. Ensure the totals row matches.

4. **Check README.md:** For any newly implemented user-visible features, verify the README's feature matrix and annotation reference reflect the capability.

5. **Report:** Summarize what was updated.
