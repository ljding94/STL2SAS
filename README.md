# STL2SAS

A minimal, offline 3D-model-to-small-angle-scattering workbench. Open **`index.html`** in a modern browser and drop an STL or OBJ file onto the page. No installation, network connection, or server is needed. All calculations stay on your device.

[GitHub repository](https://github.com/ljding94/STL2SAS) · [Cloudflare hosting guide](docs/CLOUDFLARE.md) · [Example files and attribution](examples/README.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fljding94%2FSTL2SAS)

For your existing repository, follow the hosting guide to connect it directly. The deploy button creates a repository copy.

## Using the app

1. Open `index.html`. The triaxial ellipsoid example runs automatically.
2. Drag a binary/ASCII `.stl` or `.obj` file directly onto the highlighted upload area, or click it to browse. The example selector includes all seven bundled mesh files: a detailed **Toy car · STL**, torus, angle block, ellipsoid, cube in STL and OBJ, and concave L-prism. Four analytic solids are also available. Select a mesh and use **Download selected model file** to save it. All examples are embedded for offline use.
3. Choose the number of volume points. Imported models must be closed solids. The app checks open and non-manifold edges before uniformly filling the enclosed volume; it never substitutes surface points.
4. Set the longest span and length unit. STL does **not** encode units. On import, the native largest bounding-box side is preserved and labeled “model unit” until you assign a physical unit. The longest span is not the maximum pair distance, Dmax.
5. Drag the particle, use arrow keys, edit X/Y/Z angles, or enable auto rotation. The XY, XZ, and YZ laboratory planes update together. Scroll over the particle to zoom without changing its physical size or scattering.
6. Adjust q range, detector resolution, and color range. Hover over a detector for its numerical q and intensity. The bottom plot includes a dark **isotropic average** and three colored azimuthal plane averages. The isotropic curve stays fixed during rotation; the plane curves change. Dashed reference curves are analytic sphere/ellipsoid plane results; the horizontal 1/N line is the approximate sampling floor.
7. The isotropic curve computes in a separate background worker. Choose Fast, Balanced, or Fine accuracy; compare settings for high q or elongated shapes. Rotation, zoom, q range, detector size, physical span, and units reuse the cached curve. A new model, resampling, point-count change, or accuracy change regenerates it.
8. **Export data** saves `stl2sas-planes.csv` with the three directional detector maps. **Export profiles** saves `stl2sas-profiles.csv` with isotropic and plane-average curves, physical q coordinates, and method/rotation metadata. At 512² the detector CSV is large; use 128² for a quick export.

The app is a single portable file: you can copy `index.html` to another computer. Its source is kept separately in `src/` for development. Current Chrome, Edge, Firefox, or Safari is recommended; the page uses Blob Web Workers, Canvas 2D, and native HTML dialogs.

## Numerical method

For N equally weighted, uniformly distributed volume points, constant contrast, and active particle rotation R:

```text
A(q) = (1/N) Σ_j exp(i q · R r_j)
P(q) = |A(q)|²,    P(0) = 1
R = Rz * Ry * Rx
```

For a detector perpendicular to Z, qz = 0, so the amplitude is the 2D Fourier transform of the particle's density projected onto XY. The same argument gives XZ and YZ. We rotate points once, deposit each projection with cloud-in-cell weights, and FFT each grid. The FFT grid has twice the detector width, keeping displayed frequencies below its Nyquist limit. A separable sinc⁴ intensity correction compensates the cloud-in-cell window. This is an approximation to the direct amplitude sum, not an exact nonuniform Fourier transform.

If M is the displayed detector width, internal grid K = 2M, D is the selected longest span, and qD_max is the range slider value:

```text
normalized coordinates: r / D
real-space grid spacing: h/D = pi / (2 qD_max)
reciprocal pixel spacing: delta(qD) = 2 qD_max / M
displayed signed indices: -M/2 ... M/2-1
```

The upper axis label marks the positive extent; the final sampled positive pixel is one q increment short of that boundary. q uses angular spatial frequency (radians/length), not cycles/length. Maps use a common logarithmic color scale; color clipping does not change exported intensities. Positive vertical q points upward; exported q coordinates are explicit.

### Cost and optimizations

- A fixed orientation's three maps cost **O(N + M² log M)**, with **O(N + M²)** working storage. The fixed-grid dependence on N is linear; this avoids the isotropic Debye O(N²) pair sum. An exact direct amplitude calculation at P detector pixels would instead cost O(NP).
- Mesh preparation and initial sampling are separate. A triangle BVH accelerates odd–even point-in-volume tests. For sparse meshes, a conservative 32³ spatial grid skips provably empty regions: all triangle-AABB cells are retained, and cells without surface crossings are classified by their centers. Sampling uniformly among equal-volume retained cells, followed by the same exact point-in-mesh rejection, preserves uniform volume sampling and cavities. Performance still depends on geometry; difficult or invalid meshes may time out after about 20 seconds.
- Sampling and scattering run in background workers. During interaction, the calculation worker completes its current job and retains only the newest pending orientation, avoiding an ever-growing queue.
- Point clouds, FFT plans, twiddle factors, and working arrays are reused. No point resampling happens during rotation. The 3D preview renders at most 12,000 of the calculation points; all N points contribute to scattering.
- Physical span/unit and log-color changes reuse computed normalized intensities. The q range slider changes qD and recalculates. The uniform-density form factor shape is unchanged by a uniform rescaling when q is rescaled with it.

Initial local benchmark, Apple arm64 / Node 25.9, three 128² detectors, 7-rotation median after warmup: 5,000 points 15.3 ms; 20,000 points 15.3 ms; 100,000 points 17.1 ms; 250,000 points 19.5 ms. These timings cover the numerical calculation, excluding import, plot drawing, and worker transfer. The browser reports its own actual calculation time. Hardware, browsers, and larger grids will differ.

### Scientific scope and limits

This is a **single-particle, uniform-contrast form factor**, normalized to forward intensity 1. It does not model interparticle correlations, multiple scattering, spatially varying contrast, polydispersity, instrumental resolution, absolute intensity, or detector curvature. Planes are flat qz=0, qy=0, and qx=0 sections in the small-angle limit.

The three colored plane curves are 2D azimuthal averages. **They are not the 3D orientational average.** The separate dark curve is the numerical isotropic average of the full point cloud:

```text
P_iso(q) = (1 / 4pi) integral_sphere |(1/N) sum_j exp(i q n · r_j)|² dOmega
         = (1/N²) sum_jk sinc(q |r_j - r_k|)    [exact Debye reference]
```

The implementation averages **intensity**, not complex amplitude, using Gauss–Legendre quadrature in cos(theta) and uniform azimuths. It evaluates only the positive hemisphere because real uniform contrast gives P(q n) = P(-q n). Each direction projects all original N points onto a line, deposits them with cloud-in-cell weights, and applies an 8192-point 1D FFT. Eight-fold oversampling and the sinc⁴ intensity window correction reduce gridding error. The result is nonnegative and normalized to P_iso(0) = 1.

Fast uses 16 polar × 64 azimuthal nodes (512 unique hemisphere directions); Balanced uses 32 × 128 (2048); Fine uses 64 × 256 (8192). This is approximate angular integration and gridding, not an exact all-pairs Debye calculation. High-q values, sharp minima and strong anisotropy can require more angular resolution; compare accuracy settings before interpreting those regions. Finite-point noise and the 1/N self term remain.

The complete qD interval 0–120 is computed once for the sampled model and selected accuracy, with 513 q values (spacing 0.234375). The current q range clips this cached curve. Model rotations never enter its worker inputs, so displayed isotropic values remain exactly unchanged as the particle rotates. Changing physical scale/units relabels the q coordinates; resampling or changing N/model/accuracy starts a new calculation. The separate worker does not block detector rotation. Its cost is O(KN + KG log G), memory O(N + G), for K unique directions and G = 8192; it stays linear in N at fixed accuracy.

Monte Carlo self terms produce an expected intensity floor of approximately 1/N. No self-term subtraction is applied. The corresponding continuum form factor becomes unreliable near/below that floor. More points lower sampling noise. At fixed q range, more detector pixels provide denser reciprocal-space sampling by increasing zero padding; the deposition spacing is set by the q range and the fixed 2× oversampling, so a larger detector does not by itself remove gridding error or Monte Carlo noise. Gridding error and finite-point noise are most visible at deep minima and high q.

Imports are limited to 50 MB / 200,000 triangles. OBJ supports vertex positions, face indices (including negatives), and simple planar polygons via ear clipping; materials, transforms, textures, lines, and points are ignored. Apply transforms before exporting. Mesh vertex positions are welded for edge checks at 10^-6 of the original largest span. Self-intersections, overlapping shells, and non-manifold vertices are not fully diagnosed. Nested shells use odd–even filling and represent cavities; overlapping solids should be unioned in a modeling tool first.

## Development and validation

No npm packages are required. Node is needed only to regenerate the portable file and run tests; Python is optional for a local HTTP preview.

```sh
npm run build       # regenerate index.html from src/
npm test            # scientific and mesh-import checks
npm run benchmark   # three-plane calculation at increasing N
npm start           # optional: http://127.0.0.1:8080
npm run preview     # build and serve Cloudflare's dist/ output
npm run deploy:check # validate the Cloudflare package without publishing
npm run deploy      # build and deploy to your signed-in Cloudflare account
```

Tests compare FFT intensities with direct complex sums on all three planes, exact finite-point Debye isotropic sums, analytic sphere scattering, quadrature weights, refinement, rotation/translation invariance, normalization, shared-axis consistency, Friedel symmetry, uniform-volume moments, actual mesh imports, and malformed/open meshes. `tests/browser-isotropic.html` checks exported isotropic invariance during rotation, changing plane averages, cache reuse, and invalidation after resampling/accuracy changes. `node scripts/make-examples.cjs` regenerates the example files.

## References and relationship to the notes

- [Larsen et al. (2023), *Shape2SAS: a web application to simulate small-angle scattering data and pair distance distributions from user-defined shapes*, J. Appl. Cryst. 56, 1287–1294](https://journals.iucr.org/j/issues/2023/04/00/jl5064/index.html). The supplied paper calculates isotropic scattering using point-pair distances. This MVP follows the proposed alternative of orientation-dependent 2D planes.
- [cw-do/morphsld_sas](https://github.com/cw-do/morphsld_sas), inspected at commit `230a2dfad50b5ea99c7be150df3a8ab45053fcbd`. Its scattering engine transforms radial scattering-length-density profiles and includes analytic sphere validation. It is context rather than an arbitrary-mesh loader or 2D detector engine.
- [SasView scattering theory](https://www.sasview.org/docs/user/qtgui/Perspectives/Fitting/theory.html) defines the isotropic 1D pattern as the orientational average of intensity; this is distinct from averaging directional detector planes.

This project is an independent implementation; no source code was copied from either reference. Two example STL assets come from the MIT-licensed Trimesh repository. The detailed car is a modified CC0 derivative of Khronos' ToyCar by Guido Odendahl and Eric Chadwick. Upstream notices, pinned source links, checksums, and the car's conversion steps are in `examples/` and embedded with the assets in the portable HTML.

Useful next additions: direct-sum spot checks in the UI, adaptive convergence checks for isotropic angular integration, GPU deposition/FFT for larger grids, mesh repair and more formats, and multiple SLD regions.
