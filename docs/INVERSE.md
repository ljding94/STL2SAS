# Experimental intensity-to-envelope reconstruction

The browser's inverse mode searches for a connected, uniform-density volume compatible with an isotropic small-angle-scattering curve. It is an independent prototype inspired by simulated-annealing shape methods such as [DAMMIN (Svergun, 1999)](https://www.embl-hamburg.de/biosaxs/dammin.html). It does not implement DAMMIN/DAMMIF, use their source code, or claim equivalent accuracy or validation.

## Model and objective

The user supplies a search diameter D and a grid width L of 9 or 11. Candidate cube centers have spacing h = D/L; only cubes conservatively contained in the spherical search region are available. Each cube is empty or occupied by the same constant contrast. Material must remain connected through cube faces. Moves producing local non-manifold contacts are rejected; cavities and handles are not globally forbidden.

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

Each independent search starts from a sphere, prolate ellipsoid, or oblate ellipsoid with a rough low-q size, then proposes single-cube additions or removals at the boundary. It uses a Metropolis acceptance rule with a cooling schedule and retains the lowest objective encountered. Starts use deterministic seeds separated by 7919. The schedule and initial shapes are heuristics; a finite search does not guarantee the global optimum.

Optimization uses at most 64 approximately evenly indexed q samples and 256 unique angular directions: 16-node Gauss–Legendre polar quadrature × 32 azimuths, restricted to the positive hemisphere. Intensity is even under u → −u for the real contrast model. Complex amplitudes for every possible cube and sampled q/direction are cached. Adding or removing a cube updates the total amplitude incrementally, avoiding a point-pair Debye sum.

For S possible sites, Q fit samples, and K directions, setup and cache storage scale as O(SQK); each intensity proposal/update costs O(QK), with up to O(S) additional connectivity work. The cache stores cosine and sine in float32; accumulated amplitudes use float64. The UI remains responsive because computation runs in a terminable Web Worker. A 9³/1,000-step single run is a useful quick preview. Runtime depends on the browser and hardware; three 11³/5,000-step searches took about 13 seconds in one local Chrome check.

## Final evaluation

After each search, the selected geometry is evaluated at 2,048 unique angular directions with the existing 8192-point projection FFT and its cloud-in-cell correction. The same finite cube amplitude is included. The resulting 513 q samples are linearly interpolated onto **every input point within the retained q range**, and scale/background are refitted there. This denser evaluation is a numerical cross-check, not a proof of angular convergence. The shape is not reoptimized after the cross-check.

Candidates are ordered by final weighted mean-square residual plus the same compactness penalty. The plot and CSV use the final evaluation. The report also saves the optimization RMS, so disagreement with the final RMS is visible. The reported **weighted RMS** is

```text
sqrt(mean(((I_fit - I) / sigma)²))
```

It is not reduced chi-squared: the effective number of fitted shape degrees of freedom is unknown. A smaller RMS does not establish a unique or correct structure, and values below one do not by themselves validate the model.

## Inputs, units, and outputs

- Provide 8–5,000 distinct, finite, nonnegative q values and finite intensities. Data are sorted by q. With a supplied positive sigma column, zero and negative intensity measurements are retained. Without sigma, all intensities must be positive.
- Two-column data use assumed weights `sigma_i = max(0.05 |I_i|, 0.002 I_ref)`, where I_ref is the maximum of the first five positive intensities in ascending q order. These are not measured error bars.
- The rough size suggestion uses a straight-line fit to log I versus q², considering the first 5–24 positive points and accepting estimates satisfying q_end Rg ≤ 1.3. It does not include a full Guinier-validity or background diagnostic. Check the search diameter yourself; data without an informative low-q range may not determine it.
- q must be the angular scattering-vector magnitude (radians per length). The chosen length unit must be the inverse of the q unit. Changing the unit label does not rescale the numbers.
- The selected maximum q must retain at least eight points and satisfy q_max D ≤ 30. This bound limits a coarse exploratory model; it does not certify spatial or angular convergence. Truncated high-q points are excluded, not silently fitted.
- STL is a binary triangulation of exposed cube faces, without smoothing. Its coordinates are in the selected physical length unit, but **STL does not encode that unit**. Keep the JSON report with the STL. The block-shaped geometry is intentional: smoothing would change the volume and predicted scattering.
- Fit CSV includes q, observed I, sigma, fitted intensity, and `(fit − data)/sigma`, plus settings and weighting metadata. It has five numerical columns and is an output table; input expects the two- or three-column format above.
- The JSON report includes input points actually fitted, assumptions, settings, seeds, scales, backgrounds, weighted RMS values, all final curves, occupied sites, cube centers in physical units, and selected candidate. Sites follow the deterministic lattice construction in `src/inverse.js`.
- The forward calculator samples a returned STL with random points. Its approximate isotropic curve can differ from the continuous-cube fit because of finite sampling, angular accuracy, and q-grid interpolation. Increase the forward point count and angular accuracy before judging a round trip.

## Scope and validation still needed

The assumed object is an isolated, dilute, monodisperse particle with uniform contrast. This mode has no interparticle structure factor, instrumental smearing, polydispersity, hydration layer, symmetry constraint, multiple SLD regions, or model-selection uncertainty analysis. It cannot recover absolute orientation or distinguish mirror-related envelopes from isotropic data.

Automated checks cover finite-cube amplitudes, scale/background fitting, input parsing, deterministic sphere fit improvement, approximate size recovery, fitting an independently calculated analytic prolate-ellipsoid curve, connectedness, and consistency of fitted and exported volume. Browser checks exercise cancellation, data drop, independent results, exports and forward handoff. They do not establish performance across shape classes or experimental datasets.

Before using this for structural conclusions or a methods paper, benchmark independent synthetic shapes and noise levels, vary D/grid/q range/seeds/prior, measure quadrature and grid convergence, align and compare reconstruction ensembles, and test experimental data against established reconstruction software. Agreement with a curve alone is insufficient.
