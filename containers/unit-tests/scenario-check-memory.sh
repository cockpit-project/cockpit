#!/bin/sh

make check-memory 2>&1 || {
    cat test-suite.log
    exit 1
}
