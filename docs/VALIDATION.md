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

## Complete example catalog, detailed car, and file-drop update

The example catalog now covers every bundled STL and OBJ: seven mesh files plus four separately listed analytic shapes. The build checks that the catalog exactly matches the mesh files in `examples/`, and the generated HTML embeds every file and its applicable license. The new 27,998-triangle car is a modified CC0 derivative of the Khronos ToyCar scene; the conversion adds finite wall thickness to preserve display panels during voxel remeshing. Changes are documented in `examples/README.md`.

The upload area now owns direct drag/drop listeners, while window capture listeners prevent the browser opening dropped files. File detection handles `DataTransfer.items` when `types` or `files` is still empty during a drag. The area highlights during a file drag, imports through the same file-loading path as Browse, and resets on drop, Escape, drag end, window exit, and blur.

The suite passes 23 tests. Added coverage checks real-browser-style drag metadata, upload-area and whole-page drops, canceled browser navigation, text-drag exclusion, cancellation cleanup, catalog completeness, and all bundled meshes. A browser integration fixture at `tests/browser-drop.html` creates an actual browser `File`, `DataTransfer`, and `DragEvent` payload, dispatches it to the upload area, and verifies model loading and all three calculated planes. That test passed in Chrome with `browser-dropped-cube.stl`. It exercises the browser DOM drop pipeline; it does not automate an OS Finder-to-Chrome mouse drag.

For sparsely occupied meshes, conservative spatial proposal cells reduce rejection cost while retaining exact point-in-mesh checks. A thin-shell test verifies cavities, uniform first/second moments, and volume. On a preliminary shell-only car conversion used during development, 100,000-point preparation fell from 14.37 s to 2.72 s, with acceptance rising from about 3.7% to 29.5%. The delivered model retains more body geometry through finite panel thickness: its default 50,000-point preparation took 4.51 s locally, with about 40.2% acceptance using the spatial proposal. Scattering calculations still use the same FFT method and all N points. Browser timing varies, especially for cold worker startup.

Chrome loaded the car and displayed its three planes. The profile plot was also given a fixed CSS height to prevent a canvas intrinsic-size resize feedback loop. The fixed display camera now views from above; the physical particle rotation and scattering coordinates are unchanged.

All six pre-existing mesh dropdown entries were also exercised individually in Chrome and displayed their corresponding file names, including STL and OBJ variants. The selection-specific download was confirmed complete for `concave-L.obj`. The updated Cloudflare dry run successfully read 13 static files. No live deployment was made.

## Cached 3D isotropic average

The bottom plot now includes the numerical 3D isotropic intensity average alongside the three changing plane averages. It integrates squared amplitudes over the sphere using all original N volume points, Gauss–Legendre polar weights, uniform azimuths, and 8192-point, eight-fold oversampled 1D projection FFTs. Positive-hemisphere symmetry reduces the actual evaluations to 512 / 2048 / 8192 directions for Fast / Balanced / Fine. The curve is nonnegative, retains finite-point self terms, and has P(0) = 1.

The isotropic worker receives unrotated points and no display-rotation matrix. It computes and caches 513 qD values over 0–120 once per model/point set/accuracy. Rotation, zoom, displayed q range, detector resolution, physical span and units do not launch it again. New sampling/model/N/accuracy cancels the old job, discards stale results, and starts a new calculation. Detector calculation runs in a separate worker and does not wait for isotropic completion.

`npm test`: 28 tests passed. Added independent exact finite-point Debye comparisons, solid-angle quadrature moment checks, high-q refinement checks, a point-cloud rotation/translation check, and the analytic sphere including the finite-point self contribution. Balanced agrees with the 48-point Debye fixture within the test tolerance of 3×10^-5 through qD = 32; Fine is within 5×10^-4 at the tested higher-q coordinates and improves on Fast. These are fixture tolerances, not general numerical error guarantees; high q and strong anisotropy can need refinement.

`tests/browser-isotropic.html` passed in Chrome. It captured the app's actual profile CSV exports and confirmed that isotropic rows are byte-for-byte identical after rotation while XY plane-average rows change. It also verified cache reuse when q range, detector grid and physical span change; a new calculation and different curve after resampling; and a new Fast result with 512 directions after changing accuracy. The profile CSV includes all four curves and numerical-method metadata.

Local warmed Node timings for Balanced, the full qD interval, and 513 output values were 657 ms at N = 20,000; 1433 ms at N = 100,000; and 2104 ms at N = 250,000. This is an occasional background cost, not part of each rotation's detector calculation. The updated panel is shown in `isotropic-profiles.jpg`.
