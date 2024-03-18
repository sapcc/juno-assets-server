import fs from "fs"
import path from "path"
import esbuild from "/usr/local/lib/node_modules/esbuild/lib/main.js"
import * as glob from "/usr/local/lib/node_modules/glob/dist/esm/index.js"
import cjsToEsm from "./cjs_to_esm_esbuild_plugin.js"
import requireToImport from "./require_to_import_esbuild_plugin.js"
import { getFixPackageVersion, installNpmPackage } from "./npm_helper.mjs"
import { green, red, yellow, blue, cyan } from "./colors.mjs"

function log(...args) {
  process.stdout.write(args.join(" "))
}

// all js files found in the package root directory are potential entry points
// files pointed to by the main and module fields in the package.json are also entry points
function getEntryPoints(packagePath) {
  let files = []
  let pkgJson
  try {
    pkgJson = JSON.parse(
      fs.readFileSync(path.join(packagePath, "package.json"))
    )
    // add main and module entry points
    if (pkgJson.main) {
      files.push(path.join(packagePath, pkgJson.main))
    } else if (pkgJson.module) {
      files.push(path.join(packagePath, pkgJson.module))
    }
  } catch (e) {
    console.log(red("ERROR:"), "failed to parse package.json of", packagePath)
    return files
  }
  // add all js files in the package root directory
  files = files.concat(
    glob.sync(path.join(packagePath, "*.js"), {
      ignore: "node_modules/**",
    })
  )
  return files
}

// convert a package to esm. This function is recursive, it converts all dependencies recursively
async function convertToEsm(packageName, packageVersion, options = {}) {
  // determine the package build directory
  const buildDir = path.resolve(options.buildDir || "./build")
  // determine the node_modules parent directory
  const nodeModulesDir = path.resolve(options.nodeModulesDir || "/tmp")
  // the indent string is used for logging. It gets a space added to it for each recursive call
  const indent = options.indent || ""

  const verbose = options.verbose || false

  log(
    "\n" +
      indent +
      green("PROCESS: ") +
      packageName +
      "@" +
      packageVersion +
      "\n"
  )

  // get the current version of the package
  const currentVersion = await getFixPackageVersion(packageName, packageVersion)

  if (verbose)
    log(
      indent,
      blue("INFO:"),
      `current version of ${packageName} is ${currentVersion}`,
      "\n"
    )

  // determine the build log path. We log the build result to this file.
  // This file is used to avoid rebuilding the same package again.
  const buildLogPath = path.join(
    buildDir,
    `${packageName}@${currentVersion}`,
    ".build.log.json"
  )

  // caching: if the build result file exists, we read it and return the result. We are done!
  if (fs.existsSync(buildLogPath)) {
    return JSON.parse(fs.readFileSync(buildLogPath).toString())
  }

  // install package
  const pkgPath = installNpmPackage(packageName, currentVersion, {
    nodeModulesDir,
  })

  // read package.json
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(pkgPath, "package.json"))
  )

  // get the main and module files
  const mainFile = pkgJson.main || "index.js"
  const moduleFile = pkgJson.module || "index.mjs"

  // determine the entry points
  let entryPoints = getEntryPoints(pkgPath)
  if (verbose) console.log(blue("INFO:"), "entrypoints are", entryPoints)

  // to speed up, we consider only the peerDependencies!
  const externals = { ...pkgJson.peerDependencies } //{ ...pkgJson.peerDependencies, ...pkgJson.dependencies }

  // initialize the result object
  const result = {
    buildName: `${packageName}@${currentVersion}`,
    built: false,
    name: packageName,
    entryPoints: {},
    dependencies: {},
  }

  // start the recursive conversion of the dependencies
  // convert externals in parallel
  const results = await Promise.all(
    Object.keys(externals).map((external) =>
      convertToEsm(external, externals[external], {
        buildDir,
        nodeModulesDir,
        indent: indent + "  ",
        verbose,
      })
    )
  )

  results.forEach(({ built, ...depResult }) => {
    if (built) {
      result.dependencies[depResult.name] = depResult
    } else delete externals[depResult.name] // Important: remove externals that are not built!
  })

  // all dependencies which could not be converted to esm are removed from externals
  // esbuild will NOT handle them as external dependencies and will bundle them into the build

  if (verbose) console.log(blue("INFO:"), "externals are", externals)
  // remove duplicates
  entryPoints = Array.from(new Set(entryPoints))

  for (let entryPoint of entryPoints) {
    try {
      // log the current entry point
      process.stdout.write(
        "\n" +
          indent +
          "  " +
          blue("CONVERT: ") +
          entryPoint.replace(pkgPath, packageName) +
          " to esm "
      )

      // add entry points to externals
      const packagesToIgnore = [
        ...Object.keys(externals || {}),
        ...entryPoints.map((e) =>
          e.replace(pkgPath, packageName).replace(/\.m?js$/, "")
        ),
      ]

      let entryPointPath

      // handle type="module" (already esm module)
      if (pkgJson.type === "module") {
        // replace entry point name with build name and entrypoint, like "NAME@VERSION/ENTRYPOINT"
        const entryPointName = entryPoint.replace(
          pkgPath,
          `${packageName}@${currentVersion}`
        )
        // create the directory in build folder
        fs.mkdirSync(path.join(buildDir, path.dirname(entryPointName)), {
          recursive: true,
        })
        // copy the file to the build folder
        fs.copyFileSync(entryPoint, path.join(buildDir, entryPointName))
        entryPointPath = path.join(buildDir, entryPointName)
      } else {
        // entry point is a commonjs module
        // convert to esm
        // bundle all previous failed dependencies into the build (external)
        const buildResults = await esbuild.build({
          entryPoints: [entryPoint],
          bundle: true,
          minify: true,
          metafile: true,
          format: "esm",
          platform: "browser",
          outdir: path.join(buildDir, `${packageName}@${currentVersion}`),
          external: packagesToIgnore,
          plugins: [cjsToEsm, requireToImport],
          target: "esnext",
          keepNames: true,
          //ignoreAnnotations: true,
          logLevel: "silent",
        })
        // if metafile option is set, we get the output file name from the metafile
        // this file already contains the build directory
        entryPointPath = path.resolve(
          Object.keys(buildResults.metafile?.outputs)?.[0]
        )
      }
      result.built = true

      if (entryPointPath)
        result.path = path.resolve(path.dirname(entryPointPath))
      const entryPointFile = entryPoint.replace(pkgPath, packageName)
      const entryPointName = entryPointFile.replace(/\.m?js$/, "")

      // handle main entrypoint
      // if entrypoint matches main or module file then add
      // the package name as entrypoint pointing to the main file
      if (
        entryPointFile ===
          path.join(packageName, mainFile || moduleFile || "") ||
        entryPoint === path.join(packageName, mainFile || moduleFile || "")
      ) {
        result.entryPoints[packageName] = entryPointPath
        result.main = entryPointName
      } else {
        // else add entrypoint to result without .js extension
        // add entrypoint to result without .js extension
        result.entryPoints[entryPointName] = entryPointPath
      }

      process.stdout.write(green("DONE") + "\n")
    } catch (e) {
      log(
        yellow("FAILED") +
          (verbose ? e.message : "") +
          cyan(" -> ignore this entrypoint ") +
          green("DONE") +
          "\n"
      )
      if (verbose) console.log(e)
    }
  }

  if (result.built) {
    if (verbose) console.log(cyan(JSON.stringify(result, null, 2)))

    // IMPORTANT: write the build result to the build log file
    fs.writeFileSync(buildLogPath, JSON.stringify(result, null, 2))
  }
  return result
}

export default convertToEsm
