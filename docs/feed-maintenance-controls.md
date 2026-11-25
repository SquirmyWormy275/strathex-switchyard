# Manage scanner signing keys and feeds

Open **Settings → Scanner signing keys and feeds** in a Personal companion
workspace. **Load installed feeds** reads local registry metadata; it downloads
nothing and queries no provider. Personal keyboard-only mode can inspect this
metadata, while registry changes require companion mode.

1. Choose **Trust a public signing key** and select the public trust policy file
   supplied by the feed operator. Compare the authority, key fingerprint, allowed
   feed types and expiry in the review with a source you trust. Confirm separately.
2. Choose **Install a signed feed** and enter the absolute path to its manifest
   on this computer. Keep the manifest and signed content together. Review the
   verified versions, hashes, size and freshness before confirming the copy.
3. Return to **Activity → Prepare a scanner setup** and load the installed feed
   metadata. Saving a setup, granting a task permission and starting a scan each
   remain separately reviewed actions.

Every registry review explains that prior pipeline and Shield receipts in this
workspace will be invalidated before the change. A public signing key establishes
whose feed signatures to accept; it does not establish complete scan coverage,
trust an executable or grant a coding task permission.

**Revoke a feed** prevents further use while retaining its files. **Remove retained
feed files** separately reviews an already revoked feed or an original uncertain
allocation, including the exact remaining bytes. **Revoke a signing key** withdraws
that exact authority/key pair. Enter a reason for each withdrawal or removal.
The server preserves changed, replaced or unfamiliar files.

The file picker accepts only the closed public-policy schema, at most 16 KiB.
Private signing-key blocks and extra fields are rejected locally. The backend
independently verifies the public P-256 key and its fingerprint. Signing secrets
are never part of the installed trust policy.

Maintenance history retains the original outcome after a lost reply. **Inspect
interrupted changes** checks the original stopped owner and budget; it does not
reinstall, delete or upgrade an uncertain result. A workspace, form or file change
invalidates the displayed approval. No mutation is retried automatically.

See [the signed-feed contract](signed-fixtures.md), [scanner setup](scanner-setup-controls.md)
and [exact source evidence](evidence/feed-ui-source-summary.json). Source tests
use real signed temporary files and encrypted registry state; browser appearance,
installed adoption and trust in any real feed remain separately unaccepted.
