#!/bin/sh

if [ ! -f "./manifest.json" ]; then
  echo "ERROR: no ./manifest.json found!"
  exit
fi

ASSET_TYPE=$1

echo "cleanup $ASSET_TYPE"
rm -f $ASSET_TYPE/*@latest

package_json_files=$(find $ASSET_TYPE/ -type f -name package.json)
WORKDIR=$(pwd)

for f in $package_json_files; do
  NAME=$(jq -r '.name' $f)
  # check for already created symlinkg
  if [[ -L "${ASSET_TYPE}/${NAME}@latest" ]]; then
    #echo "${NAME}@latest already seen, skip to next..."
    continue
  fi

  if [[ "$NAME" == "widget-loader" ]]; then
    # widget_loader is on different location
    VERSIONS=$(jq -r "._global.\"$NAME\" | . [] | .version" ./manifest.json)
  else
    VERSIONS=$(jq -r ".\"$NAME\" | . [] | .version" ./manifest.json)
  fi

  echo $NAME versions found: $VERSIONS
  SORTED_VERSIONS=$(echo "$VERSIONS" | tr ' ' '\n' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tr '\n' ' ')
  LATEST_VERSION=$(echo "$SORTED_VERSIONS" | awk '{print $NF}')
  echo "$NAME latest version: $LATEST_VERSION"
  cd $ASSET_TYPE
  echo "create symlink for $NAME@latest"
  ln -s "${NAME}@${LATEST_VERSION}" "${NAME}@latest"
  cd $WORKDIR
done
