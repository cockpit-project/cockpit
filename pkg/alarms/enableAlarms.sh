#!/bin/sh
set -eu

filepath=${1}
mode=${2}

sed -i "s/MODE.*/MODE ${mode}/" ${filepath}
