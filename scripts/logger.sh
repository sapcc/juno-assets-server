#!/usr/bin/env bash

# shellcheck disable=SC2034
# https://stackoverflow.com/questions/5947742/how-to-change-the-output-color-of-echo-in-linux#5947802
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
DARK_GREY='\033[1;30m'
WHITE='\033[1;37m'
YELLOW='\033[0;33m'
BOLD_YELLOW='\033[1;33m'
BOLD_GREEN='\033[1;32m'
BOLD_PURPLE='\033[1;35m'
BOLD_BLUE='\033[1;34m'
BOLD_RED='\033[1;31m'
BOLD_GREY='\033[0;37m'
BOLD_CYAN='\033[1;36m'
NC='\033[0m' # No Color

log() {
  COLOR="$1"
  echo -e "${!COLOR}${2}${NC}"
}

msg_error() {
  echo -e "${RED}ERROR: ${1}${NC} 👎"
}

msg_info() {
  echo -e "${BLUE}${1}${NC}"
}

msg_warning() {
  echo -e "${YELLOW}WARNING: ${1}${NC}"
}

msg_success() {
  echo -e "${GREEN}${1}${NC} ✔️"
}

msg_default() {
  echo -e "${DARK_GREY}${1}${NC}"
}

msg_debug() {
  if [[ -n "$DEBUG" ]]; then
    echo -e "${BOLD_BLUE}DEBUG: ${1}${NC}"
  fi
}

msg_help() {
  echo -e "${GREEN}HELP: ${1}${NC}"
}
