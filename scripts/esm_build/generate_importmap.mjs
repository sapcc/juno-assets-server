/** @module ImportMap */
/**
 * This module generates importmap to be used in browser to share libs between juno apps.
 * It uses the jspm generator to resolve dependencies, build the importmap and download the
 * appropriate files.
 * In the end, all dependencies listed in the import map are loaded from the juno Assets Server.
 */

import * as glob from "/usr/local/lib/node_modules/glob/dist/esm/index.js"
import semverGt from "/usr/local/lib/node_modules/semver/functions/gt.js"
import semverCoerce from "/usr/local/lib/node_modules/semver/functions/coerce.js"
import fs from "fs"
import pathLib from "path"
import url from "url"
import convertToEsm from "./toEsm.mjs"
import { green, red, yellow, blue, cyan } from "./colors.mjs"

// this log function allows us to output to stdout without a newline
// if a new line is needed, it must be added to the end of the string "\n"
function log(...args) {
  process.stdout.write(args.join(" "))
}

// import { exit } from "node:process"

// ignore-externals allows us to bundle all libs into one final file.
// For the case the CDN with the external libs is unreachable, this flag must be set to true.
// This will include all dependencies in the final bundle.
const availableArgs = [
  "--exit-on-error=[true|false]",
  "--src=DIR_PATH",
  "--server-root=DIR_PATH",
  "--importmap-path=FILE_PATH",
  "--node-modules-path=DIR_PATH",
  "--ignore-externals=true|false",
  "--base-url=URL_OF_ASSETS_SERVER",
  "--external-path=PATH_TO_EXTERNALS_ON_LOCAL_MACHINE",
  "--verbose",
  "--env=[production|development]",
  "--help|-h",
]

const args = process.argv.slice(2)

// default argument values
const options = {
  exitOnError: true,
  src: pathLib.dirname(url.fileURLToPath(import.meta.url)),
  baseUrl: "%BASE_URL%",
  importmapPath: "./importmap.json",
  serverRoot: "./",
  nodeModulesPath: "./tmp",
  externalPath: "externals",
  ignoreExternals: false,
  verbose: false,
  env: "production",
}

// PARSE ARGS
for (let arg of args) {
  const match = arg.match(/^-{1,2}([^=]+)=?(.*)/)
  if (match) {
    let key = match[1].replace(/\W+(.)/g, function (match, chr) {
      return chr.toUpperCase()
    })

    options[key] = match[2] ? match[2] : true

    if (options[key] === "true") options[key] = true
    if (options[key] === "false") options[key] = false
    continue
  }
}

if (options.help || options.h) {
  console.log(
    green(`Usage: node ${process.argv[1]} ` + availableArgs.join(" "))
  )
}

// this timestamp will be added to the index.js files for own libs
const TIMESTAMP = Date.now()
// #########################################################################
const PACKAGES_PATHS = ["apps", "libs"]
// determine the assets source directory
const rootPath = pathLib.resolve(options.src)
// pattern to find all package.json files in the juno packages
const globPattern = `${rootPath}/@(${PACKAGES_PATHS.join("|")})/**/package.json`
// regex to extract the package name from the path
const pathRegex = new RegExp(`^${rootPath}/(.+)/package.json$`)
// find all package.json files, except in node_modules
const files = glob.sync(globPattern, {
  ignore: [`node_modules/**`, "**/node_modules/**"],
})
// build package registry based on juno packages
const packageRegistry = {}

const SERVER_ROOT = pathLib.resolve(options.serverRoot)
console.log("===SERVER_ROOT===", SERVER_ROOT)

// generate importmap entry url
const importmapEntryUrl = (path, settings = {}) => {
  let entryUrl =
    options.baseUrl + pathLib.join("/", pathLib.relative(SERVER_ROOT, path))
  if (settings.timestamp) entryUrl += `?${TIMESTAMP}`
  return entryUrl
}

// build package registry by parsing all package.json files
for (let file of files) {
  // load and parse package.json
  let pkg = JSON.parse(fs.readFileSync(file))

  const entryFile = pkg.module || pkg.main || "index.js"
  const entryDir = pathLib.dirname(file) //entryFile.slice(0, entryFile.lastIndexOf("/") + 1) || "/"
  const path = pathLib.dirname(file) //file.replace(pathRegex, "$1")
  const version = pkg.version

  packageRegistry[pkg.name] = packageRegistry[pkg.name] || {}
  packageRegistry[pkg.name][version] = {
    name: pkg.name,
    version,
    path,
    entryFile,
    entryDir,
    peerDependencies: options.ignoreExternals ? false : pkg.peerDependencies,
  }

  // if the current version is greater than the latest, update the latest
  let latest = packageRegistry[pkg.name]["latest"] || { version: "0.0.0" }
  if (semverGt(semverCoerce(version), semverCoerce(latest.version)))
    packageRegistry[pkg.name]["latest"] = {
      ...packageRegistry[pkg.name][version],
    }
}

// initialize an empty importmap
const importMap = { imports: {}, scopes: {} }

// Due to the backward compatibility, we need to add the "old" url of the es-module-shims
// to importmap to link it to the built version.
// download convert es-module-shim to esm
const buildResult = await convertToEsm("es-module-shims", "1.6.2", {
  buildDir: options.externalPath,
  verbose: options.verbose,
  nodeModulesPath: options.nodeModulesPath,
})

fs.cpSync(
  pathLib.resolve(options.externalPath, buildResult.buildName),
  pathLib.resolve(options.externalPath, `npm:${buildResult.buildName}`),
  { recursive: true, overwrite: true }
)
// end add es-module-shim

// for each package in the registry, add it to the importmap
for (let name in packageRegistry) {
  for (let version in packageRegistry[name]) {
    const pkg = packageRegistry[name][version]
    const pkgScopeKey = importmapEntryUrl(pathLib.join(pkg.entryDir, "/"))
    // console.log(pkg.name, pkg.version, pkg.path)

    log(cyan(`add ${pkg.name}@${version} to import map` + "\n"))

    // since package regisrty contains only juno packages,
    // we need to add this package to the importmap's imports section under the
    // @juno scope
    importMap.imports[`@juno/${pkg.name}@${version}`] = importmapEntryUrl(
      pathLib.join(pkg.path, pkg.entryFile),
      { timestamp: true }
    )

    // if the package has no peer dependencies, we can skip further processing
    if (!pkg.peerDependencies) {
      continue
    }

    // if the package has peer dependencies, we need to add them to the importmap's scopes section
    for (let depName in pkg.peerDependencies) {
      const depVersion = pkg.peerDependencies[depName]
      const ownPackage =
        packageRegistry[depName]?.[depVersion === "*" ? "latest" : depVersion]

      if (ownPackage) {
        log(
          yellow(
            `(-) ${name}@${version} add internal dependency ${ownPackage.name}@${ownPackage.version} from ${ownPackage.path}` +
              "\n"
          )
        )

        // initialize the scope if it does not exist
        importMap.scopes[`${pkgScopeKey}/`] = {
          ...importMap.scopes[`${pkgScopeKey}/`],
        }

        // the peer dependency is a juno package, so we need to add it to the importmap's scopes section
        importMap.scopes[`${pkgScopeKey}/`][ownPackage.name] =
          importmapEntryUrl(
            pathLib.join(ownPackage.path, ownPackage.entryFile),
            { timestamp: true }
          )
        // we can skip further processing
        continue
      }

      log(
        green(
          `(+) ${name}@${version} add external dependency ${depName}@${depVersion}` +
            "\n"
        )
      )

      // the peer dependency is an external package, so we need to convert it to esm
      const buildResult = await convertToEsm(depName, depVersion, {
        buildDir: options.externalPath,
        verbose: options.verbose,
        nodeModulesDir: options.nodeModulesPath,
      })

      // add external dependency to import map, key is the path to the package
      const addDependenciesRecursive = (
        externalDependency = {},
        key = `${pkgScopeKey}/`
      ) => {
        // if entryPoints are defined, we need to add them to the import map
        if (externalDependency.entryPoints) {
          // create scope if not exists
          importMap.scopes[key] = { ...importMap.scopes[key] }

          // add entry points to the scope. E.g. "react": "/externals/react/index.js"
          for (let entryPoint in externalDependency.entryPoints) {
            importMap.scopes[key][entryPoint] = importmapEntryUrl(
              pathLib.join(externalDependency.entryPoints[entryPoint]),
              { timestamp: true }
            )

            const depEntryUrl = importmapEntryUrl(
              pathLib.join(externalDependency.path)
            )
            // add entrypoints of the package itself to the import map for this package
            importMap.scopes[`${depEntryUrl}/`] =
              importMap.scopes[`${depEntryUrl}/`] || {}
            importMap.scopes[`${depEntryUrl}/`][entryPoint] = importmapEntryUrl(
              pathLib.join(externalDependency.entryPoints[entryPoint]),
              { timestamp: true }
            )
          }
        }
        // if dependencies are defined, we need to add them to the import map
        if (externalDependency.dependencies) {
          const depEntryUrl = importmapEntryUrl(
            pathLib.join(externalDependency.path)
          )
          // add dependencies to import map
          for (let dep in externalDependency.dependencies) {
            addDependenciesRecursive(
              externalDependency.dependencies[dep],
              `${depEntryUrl}/`
            )
          }
        }
      }

      addDependenciesRecursive(buildResult)
    }
  }
}

// ############### OPTIMIZE: remove duplicates from import map
// count how often a path is used for a key
// same key can have multiple paths (different versions)
const counts = {}
for (let key in importMap.scopes) {
  for (let subkey in importMap.scopes[key]) {
    const path = importMap.scopes[key][subkey]
    counts[subkey] = counts[subkey] || {}
    counts[subkey][path] = (counts[subkey][path] || 0) + 1
  }
}

// find the most common path for each key
// and add them to the import map as imports
for (let key in counts) {
  const paths = counts[key]
  // if key already exists in import map, skip
  if (importMap.imports[key]) continue
  // find the most common path for this key (path with most counts)
  importMap.imports[key] = Object.keys(paths).reduce((maxPath, currentPath) => {
    const currentCount = paths[currentPath]
    const maxCount = paths[maxPath] || 0

    return currentCount > maxCount ? currentPath : maxPath
  }, null)
}

// remove all paths from all scopes that are already defined as imports
for (let key in importMap.scopes) {
  for (let subkey in importMap.scopes[key]) {
    const path = importMap.scopes[key][subkey]
    // if path is already defined as import, remove it from scope
    if (path === importMap.imports[subkey]) {
      delete importMap.scopes[key][subkey]
    }
  }
  // if scope is empty, remove it
  if (Object.keys(importMap.scopes[key]).length === 0) {
    delete importMap.scopes[key]
  }
}

if (options.verbose) console.log(importMap)

if (options.env === "development") {
  fs.writeFileSync(
    pathLib.resolve(options.importmapPath),
    JSON.stringify(importMap, null, 2)
  )
} else {
  fs.writeFileSync(
    pathLib.resolve(options.importmapPath),
    JSON.stringify(importMap)
  )
}
