# Contributing

This package was developed with AI assistance and reviewed using executable tests and source inspection. Contributors remain responsible for understanding their changes.

Open a focused issue describing the concrete input, expected behavior, observed behavior, Pi/Node versions and relevant configuration **without credentials or personal data**. Use synthetic logs and conversations in fixtures. Never submit real session archives or authentication files.

For code, create a branch and pull request. Explain the resulting behavior and validation; run `npm ci` and `npm test`. Preserve the host's permission model, explicit opt-in scope, original-log recovery and safe compaction failure path. Add meaningful regression coverage when behavior changes. Keep host-provided packages in peer dependencies rather than runtime dependencies.

Do not add benchmark promises based on one run. Compare matching cache conditions, identify sample sizes, and separate reported server work from end-to-end duration when requests can queue.

This repository is an independent extension package. Contributions to Pi's own repository must follow that repository's current contribution rules separately.
