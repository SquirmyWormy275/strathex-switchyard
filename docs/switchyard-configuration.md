# Try the Switchyard configuration workspace

Use Node 24.14.0 from `.node-version`. From the repository root:

```sh
mise exec node@24.14.0 -- npm ci --ignore-scripts
mise exec node@24.14.0 -- npm run layout:studio
```

Open the printed local URL. The next implementation adds a shared keyboard
workspace, structured proposals, and a reversible host connection to the existing
Studio. The original [Studio guide](../tools/layout-studio/README.md) documents
QMK imports, aggregate observations, direct editing and exports.

This is a private development build, with no public installer or new release.
See [current behavior and evidence](switchyard-status.md) before applying changes.
