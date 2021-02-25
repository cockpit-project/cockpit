#!/bin/sh
set -eux
source "$(realpath $(dirname "$0"))"/source-variables.sh

export PYTHONPATH=$TEST_DIR/common:$TEST_DIR/verify
$TEST_DIR/common/fmf_metadata/cli.py -u \
      --config $TEST_DIR/common/fmf_metadata/tests/cockpit_metadata_config.yaml \
      --path $TEST_DIR/verify \
      --file $TEST_DIR/verify.fmf
