# Host STL2SAS on your Cloudflare account

The app is a static website. `npm run build` creates a clean `dist/` folder containing the app and example models. Calculations and model imports remain in each visitor's browser; no API, database, server code, or application secrets are needed.

## Connect the existing GitHub repository (recommended)

1. Open **Workers & Pages → Create application → Import a repository** in your Cloudflare dashboard and select **ljding94/STL2SAS**. If prompted to connect GitHub, grant the Cloudflare integration access to this repository.
2. Create a **Worker** with these settings:

   | Setting | Value |
   | --- | --- |
   | Worker/project name | `stl2sas` |
   | Production branch | `main` |
   | Root directory | repository root |
   | Build command | `npm run build` |
   | Deploy command | `npx --yes wrangler@4 deploy` |
   | Node version | `24` (also declared in `.node-version`) |

3. Deploy. `wrangler.jsonc` declares `dist/` as the static asset directory. Cloudflare returns your site's `workers.dev` URL; subsequent production-branch pushes can rebuild and deploy through the Git connection.
4. To use your own domain, add it under your Worker's **Settings → Domains & Routes**.

Dashboard wording can vary; choose the Git repository import flow for a Worker with static assets. No Worker JavaScript entry point is required for this app. The browser's Blob Workers used for numerical calculations are unrelated to Cloudflare Workers.

## Deploy button (creates a repository copy)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fljding94%2FSTL2SAS)

Cloudflare's deploy button imports the app into your account, creates a repository copy, and offers the build/deploy settings. Because you already own `ljding94/STL2SAS`, choose a different name for that copy, or use the existing-repository method above to keep development in the original repo.

## Deploy from your computer

From the project folder:

```sh
npx --yes wrangler@4 login
npm run deploy
```

Wrangler opens Cloudflare sign-in and deploys the generated static assets into the account you choose. To check configuration without publishing:

```sh
npm run deploy:check
```

`npm run preview` builds the same `dist/` and serves it at `http://127.0.0.1:8080` using Python 3. The build and scientific tests use Node only, with no npm dependencies.

## Cloudflare Pages alternative

If you prefer Pages, create a **Pages** project and connect the same GitHub repository. Set the framework preset to **None**, production branch to `main`, build command to `npm run build`, and output directory to `dist`. A Pages build does not run the Worker deploy command. The root `wrangler.jsonc` configures Workers static assets; it is not a Pages Functions configuration.

You can also build locally and upload the **contents of `dist/`** through Pages Direct Upload. `index.html` must sit at the deployment root. Upload the built folder, not the repository root.

## What is published

`dist/index.html`, the STL/OBJ example files, and their attribution/license documents. Development sources, Git metadata, validation screenshots, notes, and credentials are not copied into `dist/`. `dist/` is generated and ignored by Git.

This repository prepares deployment; it does not create a project in your Cloudflare account or connect your GitHub integration automatically. A successful deployment returns the actual public site URL.

Official references: [Workers static assets](https://developers.cloudflare.com/workers/static-assets/), [asset configuration](https://developers.cloudflare.com/workers/static-assets/binding/), [Workers Builds settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [Pages static HTML](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/).
