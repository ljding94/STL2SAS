# MVP validation · 2026-11-04

`npm test`: 13 tests passed. The checks cover actual binary and ASCII STL / OBJ imports, malformed and open meshes, concave volume sampling, nested-shell cavities, sphere and ellipsoid volume moments, rotation conventions, direct-amplitude versus FFT agreement, Friedel symmetry, shared detector axes, normalization, and the maximum supported q range.

FFT versus direct-sum tests compare three rotated reciprocal-space planes, including off-axis and negative-q points, with an absolute normalized-intensity tolerance of 3×10^-4. The 100,000-point sphere agrees with the analytic low-q form factor to an absolute tolerance of 0.004. These checks establish the tested cases, not a general error bound for arbitrary meshes.

The in-app browser successfully loaded the app through `http://127.0.0.1:8080/`. Verified workflows: default model calculation, sphere example, real concave OBJ file selection and volume sampling, real curved binary STL import (2,208 triangles), angle editing, automatic rotation, changing to a 256² detector, and CSV download. No browser console warnings or errors were observed in the checked run.

The 128² CSV was read back from disk: 49,152 data rows (three times 128²), all three central intensities exactly 1, and rotation metadata matching the edited angles (20°, -25°, 75°). The earlier 256² CSV also contained the expected 196,608 rows and three central intensities of 1. An angle input event issue found during this check was fixed before the final export verification.

The browser preview tool blocks `file:` navigation. Direct-from-disk browser launch could therefore not be exercised with that tool. `index.html` embeds its styles, application code, numerical core, and Blob Worker source; no runtime files, remote libraries, fonts, or network requests are required. Opening the delivered file directly remains a manual verification step.

The benchmark in README is a local warmed-up Node numerical benchmark; the browser's measured default calculation was approximately 17–57 ms in the checked runs, including cold starts. Import, rendering, transfer and CSV serialization are separate costs. No claim is made about other hardware or all browser engines.

## STL examples and Cloudflare preparation

The updated suite passes 16 tests, including byte-for-byte upstream checksums of the downloaded torus and angle-block STL files, closed-volume sampling of both models, preservation of the torus central hole, exact embedded offline model bytes, third-party license notices, and the static deployment output. `npm test` builds its required assets automatically.

Browser checks loaded both real STL examples from the dropdown, generated all three scattering planes, and saved the torus through its download button. The downloaded bytes matched the original upstream SHA-256 checksum. The torus screenshot is `examples-preview.jpg`.

`npm run deploy:check` completed successfully with Wrangler 4.86.0, read the 10 intended static files from `dist/`, reported no bindings, and exited in dry-run mode. This validates local deployment preparation; no live Cloudflare deployment was made. GitHub CI also rebuilds and checks that the committed portable HTML is current.
