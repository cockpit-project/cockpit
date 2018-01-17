#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2017 Slavek Kabrda
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

# WARNING: As you change this code increment this version number so
# the machine learning model uses a new place to store the model
VERSION = 3

# This code extracts features from log items. In particular it normalizes
# and exracts the log.
#
# TODO: We could weight log lines using TF-IDF, but that would require
# a distance function that could apply that weight between lines. The
# NCD distance we use cannot do that.

import calendar
import re
import time

import sklearn.feature_extraction.text

# Ignore lines that appear in at least this fraction of logs
IGNORE_THRESHHOLD = 0.07

# Choose only one out of every N tracked items. These have
# already been manually "clustered" elsewhere, and we only need
# some cluster seeds
TRACKER_SPARSE = 100

# TODO: We should be able to detect these automatically and ignore them
# But for now this is a pragmatic hack to reduce noise and processing time
NOISE = {
    "Wrote file": re.compile("Wrote.*\.(png|html|log)"),
    "Journal extracted": re.compile("Journal extracted to.*\.log"),
    "Core dumps downloaded": re.compile("Core dumps downloaded to.*\.core"),
    "not ok": re.compile("^not ok.*"),
    "ok": re.compile("^ok.*"),
    "# Flake": re.compile("# Flake.*"),
    'File "\\1"': re.compile('File "/[^"]+/([^/]+)"'),
    "### ": re.compile('#{3,80}\s+'),
}

DIGITS = re.compile('\d+')

# Various features extracted
FEATURE_LOG = 0                # string: The normalized and collapsed log extracted
FEATURE_INDEX = 1              # number: Unique index of the item
FEATURE_URL = 2                # string: The full URL to the test result
FEATURE_NAME = 3               # string: The name of the test run
FEATURE_CONTEXT = 4            # string: The context in which the test is run
FEATURE_TRACKER = 5            # string: A tracker issue for this
FEATURE_MERGED = 6             # number: 1 if merged, 0 if not, -1 if unknown
FEATURE_TIMESTAMP = 7          # number: The time since epoch at which test was run

# Return already tokenized data
def noop(value):
    return value

# Select which items we want to operate on.
#
# Because we have so many tracked failures, we need to only bring
# some of those into our clustering algorithm. We can assume that
# these are already clusters
tracked = { }
def select(item):
    if item.get("status") != "failure":
        return False
    tracker = item.get("tracker")
    if not tracker:
        return True
    count = tracked[tracker] = tracked.get(tracker, 0) + 1
    return count % TRACKER_SPARSE == 0 # Only every Nth for tracked failures

# The actual feature extractor. Currently only extracts a
# normalized log from each item. By using fit() you can train
# the extractor to ignore frequently found lines.
class Extractor():
    def __init__(self, verbose=False):
        self.extract = sklearn.feature_extraction.text.CountVectorizer(
            analyzer='word',
            tokenizer=noop,
            lowercase=False,
            max_df=IGNORE_THRESHHOLD)
        self.verbose = verbose

    @staticmethod
    def tokenize(item):
        result = [ ]
        value = item["log"] or ""
        for line in value.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
            line = line.strip()
            for substitute, pattern in NOISE.items():
                line = pattern.sub(substitute, line)
            else:
                result.append(DIGITS.sub('000', line))
        return result

    def fit(self, items, tokenized=None):
        tokenized = tokenized or map(Extractor.tokenize, items)
        self.extract.fit(tokenized)

    def transform(self, items, tokenized=None):
        tokenized = list(tokenized or map(Extractor.tokenize, items))
        results = [ ]
        for index, item in enumerate(items):
            if not select(item):
                continue
            lines = tokenized[index]
            filtered = filter(lambda line: line not in self.extract.stop_words_, lines)
            try:
                timestamp = calendar.timegm(time.strptime(item.get("date", ""), "%Y-%m-%dT%H:%M:%SZ"))
            except ValueError:
                timestamp = -1
            merged = item.get("merged")
            if merged is None:
                merged = -1
            else:
                merged = merged and 1 or 0
            results.append((
                "\n".join(filtered),      # FEATURE_LOG
                index,                    # FEATURE_INDEX
                item.get("url", ""),      # FEATURE_URL
                item.get("test", ""),     # FEATURE_NAME
                item.get("context", ""),  # FEATURE_CONTEXT
                item.get("tracker", ""),  # FEATURE_TRACKER
                merged,                   # FEATURE_MERGED
                timestamp                 # FEATURE_TIMESTAMP
            ))
        return results

    def fit_transform(self, items):
        tokenized = list(map(Extractor.tokenize, items))
        self.fit(items, tokenized)
        return self.transform(items, tokenized)

    def stop_tokens(self):
        return self.extract.stop_words_

# This is a helpful debugger to help diagnose data, and figure out if we're
# getting the above threshold and regular expressions right
if __name__ == '__main__':
    import data
    import argparse

    parser = argparse.ArgumentParser(description="Look for noise lines in input jsonl")
    parser.add_argument("--only", action="append", help="Only analyze these statuses")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print verbose progress output")
    parser.add_argument("filename", help="The filename in JSONL gzip format")
    opts = parser.parse_args()

    # The kind of statuses to inlcude
    if not opts.only:
        only = None
    else:
        only = lambda item: item.get("status") in opts.only

    # Load the actual data
    items = data.load(opts.filename, only=only, verbose=opts.verbose)

    # Print out all lines we think are stop lines in the data
    extract = Extractor()
    extract.fit(items)
    for stop in extract.stop_tokens():
        print(stop)
