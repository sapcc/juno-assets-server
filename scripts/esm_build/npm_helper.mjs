import fs from "fs"
import path from "path"
import https from "https"
import semver from "/usr/local/lib/node_modules/semver/index.js"
import child_process from "child_process"

const VERSION_RANGE_REGEX = /^([><]=?|~|\^)/

// get fix version of a package
async function getFixPackageVersion(name, version = "*") {
  // return version if version is not a range
  if (
    version !== "" &&
    version !== "*" &&
    version !== "latest" &&
    !version.match(VERSION_RANGE_REGEX)
  )
    return version.trim()

  // make an api call to npm to get the latest version
  return new Promise((resolve, reject) => {
    const req = https
      .get(
        `https://registry.npmjs.org/${name}`,
        {
          headers: {
            Accept: "application/vnd.npm.install-v1+json",
            timeout: 300000,
          },
        }, // this header makes the response smaller
        (res) => {
          // iniiialize data
          let data = ""

          // add received data to data
          res.on("data", (d) => (data += d))
          // resolve the promise when the response ends
          res.on("end", () => {
            try {
              // get all versions
              const versions = Object.keys(JSON.parse(data).versions)
              // get the latest version that satisfies the version range
              const currentVersion = semver.maxSatisfying(versions, version)
              // resolve the promise
              resolve(currentVersion)
            } catch (e) {
              console.error(
                "\n=========================ERROR: parse version",
                name,
                version
              )
              console.warn(e)
              //reject(e)
              resolve(version.replace(VERSION_RANGE_REGEX, ""))
            }
          })
        }
      )
      .on("error", (e) => {
        console.log(
          "\n=========================ERROR: connection error",
          name,
          version
        )
        console.error(e)
        //reject(e)
        resolve(version.replace(VERSION_RANGE_REGEX, ""))
      })
    req.end()
  })
}

// use npm to install a package
function installNpmPackage(name, version = "latest", options = {}) {
  const verbose = options.verbose || false

  // cached downloaded packages default to /tmp
  const nodeModulesDir = path.resolve(
    options.nodeModulesDir || "/tmp",
    `${name}@${version}`
  )
  // const nodeModulesDir = path.resolve(options.nodeModulesDir || "/tmp")

  if (version === "*") version = "latest"
  // create the node_modules parent directory if it doesn't exist
  if (!fs.existsSync(nodeModulesDir))
    fs.mkdirSync(nodeModulesDir, { recursive: true })

  // create a package.json file if it doesn't exist
  // this is needed only for npm to install the package
  // so we can just create a dummy package.json file
  if (!fs.existsSync(path.join(nodeModulesDir, "package.json")))
    fs.writeFileSync(
      path.join(nodeModulesDir, "package.json"),
      JSON.stringify({ name: "esmBuild", version: "1.0.0" }, null, 2)
    )
  if (verbose) console.log(blue("INFO:"), `install npm "${name}@${version}"`)
  // use npm to install the package
  // attention: --legacy-peer-deps option is needed to avoid warnings while overwriting
  // packages with the same name but different versions
  // --save-exact option is needed to install the exact version
  child_process.execSync(`npm i "${name}@${version}" --save-exact`, {
    cwd: nodeModulesDir,
  })

  // try to install peer dependencies which are declared in the package.json
  // as optional in peerDependenciesMeta
  try {
    const peerDependencies =
      JSON.parse(
        fs.readFileSync(
          path.join(nodeModulesDir, "node_modules", name, "package.json")
        )
      )?.peerDependencies || {}
    if (peerDependencies) {
      console.log(name, "install peerDependencies: ", peerDependencies)
      const packages = Object.keys(peerDependencies)
        .map((name) => `"${name}@${peerDependencies[name]}"`)
        .join(" ")
      child_process.execSync(`npm i ${packages} --save-exact`, {
        cwd: nodeModulesDir,
      })
    }
  } catch (e) {
    console.warn(e)
  }

  return path.join(nodeModulesDir, "node_modules", name)
}

export { getFixPackageVersion, installNpmPackage }
