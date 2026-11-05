# Experimental intensity-to-envelope reconstruction

The browser's inverse mode searches for a connected, uniform-density volume compatible with an isotropic small-angle-scattering curve. It is an independent prototype inspired by simulated-annealing shape methods such as [DAMMIN (Svergun, 1999)](https://www.embl-hamburg.de/biosaxs/dammin.html). It does not implement DAMMIN/DAMMIF, use their source code, or claim equivalent accuracy or validation.

## Model and objective

The user supplies a search diameter D and a grid width L of 9, 11, 15, 21 or 31; **21 is the default**. Candidate cube centers have spacing h = D/L and lie inside a sphere of radius D/2. Boundary cubes can extend beyond that sphere by up to half a cube diagonal. This center-based support avoids eroding the requested diameter: the earlier requirement that every cube corner remain inside the sphere excluded valid envelopes. Each cube is empty or occupied by the same constant contrast. Material must remain connected through cube faces. Moves producing local non-manifold contacts are rejected; cavities and handles are not globally forbidden. Finer grids add degrees of freedom and generally need more search steps; the UI offers up to 100,000 attempted moves per independent run.

The amplitude of n occupied cubes in direction u is

```text
A(q,u) = [sum_j exp(i q u·r_j) / n]
         × sinc(q h ux / 2) sinc(q h uy / 2) sinc(q h uz / 2)
P(q)   = angular average of |A(q,u)|²
I_fit(q) = a P(q) + b, with a ≥ 0 and b ≥ 0
```

`sinc(x) = sin(x)/x`. The cube factor describes continuous uniform cubes, rather than point beads; there is no finite-point sampling floor in this inverse model. With normalized scattering, the fitted scale absorbs intensity calibration and contrast/volume factors. Absolute SLD is not recovered.

For m selected q values the objective is

```text
E = (1/m) sum_i [(I_fit(q_i) - I_i) / sigma_i]²
    + lambda × exposed_cube_faces / (6 n^(2/3))
```

The second term favors compact envelopes. It is an explicit prior with a chosen dimensionless weight, not a quantity inferred from the data. Its effect depends on the weights and grid resolution. Scale a and optional background b are solved by weighted linear least squares with nonnegative boundaries for every proposal. Background is fixed to zero by default.

## Search and numerical cost

Each independent search begins with a global size scan and bounded Nelder–Mead optimization of three ellipsoid semiaxes. Sphere, prolate and oblate starts fit up to 256 measured q points using the analytic ellipsoid amplitude with numerical orientation averaging; the sphere is an orientation-independent special case. The global fit provides initial dimensions, not the delivered geometry. It uses only the input curve, not synthetic-generator metadata.

Those ellipsoids are voxelized and refined by Metropolis simulated annealing, with single-cube additions or removals at the boundary. The delivered curves are calculated from these actual continuous cube volumes. The solver retains the lowest penalized objective encountered. After at least 1,000 attempted moves, a search may stop early when its weighted RMS is below one and the penalized objective improves by less than 0.005 over 500 moves. This is a computational heuristic, not a statistical convergence test; the report records actual executed steps. Seeds differ by 7919 between runs.

Angular sampling increases with the requested qD extent. The implementation averages intensity over the positive hemisphere using Gauss–Legendre polar weights and uniform azimuths; I(q) = I(−q) holds for the real contrast model.

| Requested qD | Search directions | Final-check directions |
| --- | ---: | ---: |
| Up to 32 | 512 | 2,048 |
| Above 32 to 64 | 2,048 | 8,192 |
| Above 64 to 120 | 8,192 | 8,192 |

All retained q points are used when their count is at most 256 and the amplitude table fits the 256 MiB cache budget. Otherwise approximately evenly indexed representatives are used during the search; **every retained point** is evaluated in the final check. At the largest qD and grid size, the cache budget lowers the representative count. The report records both counts and direction settings. Disagreement between search and final residuals is flagged; these settings are not a universal accuracy guarantee.

Small grids may cache complex amplitudes per site if the table is at most 64 MiB. Otherwise `exp(i q·r) = exp(i qx x) exp(i qy y) exp(i qz z)` allows storing only the 3L axis tables. Their complex products are combined into one reusable buffer for a proposed cube. For S possible sites, Q sampled q values and K directions, full caching has O(SQK) setup/storage; separable caching has O(LQK) storage and O(QK) work per requested cube.

Initializing an occupied shape costs O(nQK) for n occupied cubes. Each proposal/update costs O(QK), with up to O(S) additional connectivity work. Cached factors use float32; accumulated amplitudes use float64. The UI remains responsive through a terminable Web Worker. Wider q ranges cost more angular samples and time. More grid detail is not itself evidence of convergence or more accurate recovered structure.

## Final evaluation

After each search, the selected geometry is evaluated at the final-check direction count above with the existing 8192-point projection FFT and its cloud-in-cell correction. The same finite cube amplitude is included. The resulting 513 q samples are linearly interpolated onto **every input point within the retained q range**, and scale/background are refitted there. This cross-check uses more directions at qD ≤ 64; above 64 it uses the same angular rule with a different amplitude evaluation. It is not proof of angular convergence, and the shape is not reoptimized afterward.

Candidates are ordered by final weighted mean-square residual plus the same compactness penalty. The plot and CSV use the final evaluation. The report also saves the optimization RMS, so disagreement with the final RMS is visible. The reported **weighted RMS** is

```text
sqrt(mean(((I_fit - I) / sigma)²))
```

It is not reduced chi-squared: the effective number of fitted shape degrees of freedom is unknown. A smaller RMS does not establish a unique or correct structure, and values below one do not by themselves validate the model.

## Inputs, units, and outputs

- The synthetic sphere generator exposes minimum q, maximum q (up to 10 Å⁻¹), 8–5,000 points, and linear/logarithmic spacing. Its radius remains 30 Å and its Gaussian noise uses fixed seed 1701, so the same settings reproduce the same curve. Linear spacing accepts q = 0; logarithmic spacing requires q_min > 0. The small-q sphere amplitude uses a series expansion to avoid cancellation at q = 0. Changing these settings regenerates an active synthetic dataset and invalidates its fit; uploaded and forward-derived data are unchanged until **Generate sphere data** is selected.
- Provide 8–5,000 distinct, finite, nonnegative q values and finite intensities. Data are sorted by q. With a supplied positive sigma column, zero and negative intensity measurements are retained. Without sigma, all intensities must be positive.
- Two-column data use assumed weights `sigma_i = max(0.05 |I_i|, 0.002 I_ref)`, where I_ref is the maximum of the first five positive intensities in ascending q order. These are not measured error bars.
- The rough size suggestion uses a straight-line fit to log I versus q², considering the first 5–24 positive points and accepting estimates satisfying q_end Rg ≤ 1.3. It does not include a full Guinier-validity or background diagnostic. Check the search diameter yourself; data without an informative low-q range may not determine it.
- q must be the angular scattering-vector magnitude (radians per length). The chosen length unit must be the inverse of the q unit. Changing the unit label does not rescale the numbers.
- The selected maximum q must retain at least eight points. The former fixed q_max D ≤ 30 guard has been replaced by adaptive angular rules up to q_max D = 120, the current browser engine's supported extent. This is an implementation limit, not a physical scattering law. Wider ranges require more angular integration and memory/time; resolution is flagged when q_max h > π. Neither this heuristic nor the extent limit certifies convergence. Points above the selected fit range are excluded from the fit; the plot and input-data export retain the complete original curve.
- Logarithmic generation uses constant q ratios. It now automatically selects a logarithmic **display axis** as well. The q-axis selector changes only the display, including residual positions and tick labels. Data with q = 0 use a linear axis; switching those data to a log axis is refused without dropping the zero-q point.
- **Download input data CSV** exports the complete curve with its source and generator settings. Three columns retain supplied sigma values; two-column inputs remain two-column exports, so assumed uncertainties are not relabeled as measurements when reimported. The run report includes generator settings and the amplitude-cache method and size.
- STL is a binary triangulation of exposed cube faces, without smoothing. Its coordinates are in the selected physical length unit, but **STL does not encode that unit**. Keep the JSON report with the STL. The block-shaped geometry is intentional: smoothing would change the volume and predicted scattering.
- Fit CSV includes q, observed I, sigma, fitted intensity, and `(fit − data)/sigma`, plus settings and weighting metadata. It has five numerical columns and is an output table; input expects the two- or three-column format above.
- The JSON report includes input points actually fitted, assumptions, settings, seeds, scales, backgrounds, weighted RMS values, all final curves, occupied sites, cube centers in physical units, and selected candidate. Sites follow the deterministic lattice construction in `src/inverse.js`.
- The forward calculator samples a returned STL with random points. Its approximate isotropic curve can differ from the continuous-cube fit because of finite sampling, angular accuracy, and q-grid interpolation. Increase the forward point count and angular accuracy before judging a round trip.

## Scope and validation still needed

The assumed object is an isolated, dilute, monodisperse particle with uniform contrast. This mode has no interparticle structure factor, instrumental smearing, polydispersity, hydration layer, symmetry constraint, multiple SLD regions, or model-selection uncertainty analysis. It cannot recover absolute orientation or distinguish mirror-related envelopes from isotropic data.

Automated checks cover finite-cube amplitudes, scale/background fitting, input parsing, deterministic sphere fit improvement, approximate size recovery, fitting an independently calculated analytic prolate-ellipsoid curve, connectedness, and consistency of fitted and exported volume. Browser checks exercise cancellation, data drop, independent results, exports and forward handoff. They do not establish performance across shape classes or experimental datasets.

Before using this for structural conclusions or a methods paper, benchmark independent synthetic shapes and noise levels, vary D/grid/q range/seeds/prior, measure quadrature and grid convergence, align and compare reconstruction ensembles, and test experimental data against established reconstruction software. Agreement with a curve alone is insufficient.
