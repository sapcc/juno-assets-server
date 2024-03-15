#!/bin/bash

# creates or merge a build-log file

# Usage:
# build_log.sh --help
# or
# build_log.sh log --src EXISTING_FILE --output MERGED_RESULTS_FILE --type TYPE --name NAME --version VERSION --passed PASSED --build-url BUILD_URL --error ERROR
# or
# build_log.sh merge --output MERGED_RESULTS_FILE INPUT_FILE1 INPUT_FILE2 ...

usage() {
  echo "Usage:"
  echo "LOG"
  echo "build_log.sh log --file LOG_FILE --type TYPE --name NAME --version VERSION --check CHECK_NAME --passed PASSED --build-url BUILD_URL --error ERROR"
  # print all options, required and optional
  echo "Options:"
  echo "  --file BUILD_FILE (required): the file to write the merged results"
  echo "  --type TYPE (required): the type of the build"
  echo "  --name NAME (required): the name of the build"
  echo "  --version VERSION (required): the version of the build"
  echo "  --check CHECK_NAME (required): the name of the check"
  echo "  --passed PASSED (required): true if the build passed, false otherwise"
  echo "  --build-url BUILD_URL (required): the URL of the build"
  echo "  --error ERROR (optional): the error message if the build failed"
  echo ""
  echo "Example:"
  echo "build_log.sh log --file build-log.json --type build --name my-app --version 1.0.0 --check integrity --passed true --build-url https://example.com/build/1"
  echo ""
  echo "MERGE"
  echo "build_log.sh merge --output MERGED_RESULTS_FILE INPUT_FILE1 INPUT_FILE2 ..."
  echo "Options:"
  echo "  --output MERGED_RESULTS_FILE (required): the file to write the merged results"
  echo "  INPUT_FILE1 INPUT_FILE2 ... (required): the files to merge"
  echo ""
  echo "Example:"
  echo "build_log.sh merge --output build-log.json build-log1.json build-log2.json"
  echo ""
  echo "General options:"
  echo "  --help: print this message"
}

COMMAND=$1
shift

# if command is merge
if [ "$COMMAND" = "merge" ]; then
  # convert arguments to named parameters
  while [[ $# -gt 1 ]]; do
    key="$1"
    case $key in
    --output)
      OUTPUT="$2"
      shift
      ;;
    esac
    shift
  done

  # create output file folder if it does not exist
  mkdir -p "$(dirname "$OUTPUT")"
  # merge all input files to the output file
  jq -s 'flatten' "$@" >"$OUTPUT"
  exit 0
fi

# if command is log
if [ "$COMMAND" = "log" ]; then

  # convert arguments to named parameters
  while [[ $# -gt 1 ]]; do
    key="$1"
    case $key in
    --file)
      FILE="$2"
      shift
      ;;
    --type)
      TYPE="$2"
      shift
      ;;
    --name)
      NAME="$2"
      shift
      ;;
    --version)
      VERSION="$2"
      shift
      ;;
    --check)
      CHECK="$2"
      shift
      ;;
    --passed)
      PASSED="$2"
      shift
      ;;
    --build-url)
      BUILD_URL="$2"
      shift
      ;;
    --error)
      ERROR="$2"
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      # unknown option
      echo "Unknown option: $key, ignoring it."
      ;;
    esac
    shift
  done

  # print an error if some of options are missing except error
  if [ -z "$FILE" ] || [ -z "$TYPE" ] || [ -z "$NAME" ] || [ -z "$VERSION" ] || [ -z "$CHECK" ] || [ -z "$PASSED" ] || [ -z "$BUILD_URL" ]; then
    echo "Missing required options"
    usage
    exit 1
  fi

  # if passed is true, reset the error
  if [ "$PASSED" = "true" ]; then
    ERROR=""
  fi

  # read the src file or create a string with empty json array
  if [ -f "$FILE" ]; then
    # read the src file
    INPUT=$(cat "$FILE")
  else
    # create an empty array
    INPUT="[]"
  fi

  # create output file folder if it does not exist
  mkdir -p "$(dirname "$FILE")"

  # remove the entry for this app in the INPUT string if it exists using jq
  INPUT=$(echo "$INPUT" | jq "map(select(.name != \"$NAME\"))")

  # add the new entry to the INPUT string using jq
  RESULT=$(echo "$INPUT" | jq ". += [{\"name\":\"$NAME\",\"type\":\"$TYPE\",\"version\":\"$VERSION\",\"check\":\"$CHECK\",\"date\":\"$(date +%s)\",\"passed\":$PASSED,\"buildUrl\":\"$BUILD_URL\",\"error\":\"$ERROR\" }]")

  # write RESULT to the output file
  echo "$RESULT" >"$FILE"
  exit 0
fi

echo "Unknown command: $COMMAND"
usage
exit 1
