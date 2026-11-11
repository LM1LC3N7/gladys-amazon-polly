# Third-party notices

## AWS SDK for JavaScript v3

Amazon Polly is reached through `@aws-sdk/client-polly` (version 3.1166.0,
2026-11-10) and `@smithy/node-http-handler`, installed from npm and shipped in
the Docker image under `node_modules/` with their own license files. No code
of theirs is copied into this repository. Both are licensed under the Apache
License, Version 2.0 (the same text as [LICENSE](LICENSE)):

```
AWS SDK for JavaScript
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License"). You may not
use this file except in compliance with the License. You may obtain a copy of
the License at http://www.apache.org/licenses/LICENSE-2.0
```

Their own dependencies are under the Apache-2.0, MIT and 0BSD licenses
(`npm ls --omit=dev --all` lists them).

## Amazon Polly

"Amazon Polly" and "AWS" are trademarks of Amazon.com, Inc. or its
affiliates, used only to name the service this integration talks to. The
voice list of `src/constants.js` follows the public Amazon Polly
documentation.
