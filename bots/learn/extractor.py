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
VERSION = 1

# This code extracts features from log items. In particular it normalizes
# and exracts the log.
#
# TODO: We could weight log lines using TF-IDF, but that would require
# a distance function that could apply that weight between lines. The
# NCD distance we use cannot do that.

import re

import sklearn.feature_extraction.text

# Ignore lines that appear in at least this fraction of logs
IGNORE_THRESHHOLD = 0.2

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

# Return already tokenized data
def noop(value):
    return value

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
        value = item["log"]
        for line in value.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
            line = line.strip()
            for substitute, pattern in NOISE.items():
                line = pattern.sub(substitute, line)
            else:
                result.append(DIGITS.sub('000', line))
        return result

    def fit(self, items, tokenize=True):
        tokenized = tokenize and map(Extractor.tokenize, items) or items
        self.extract.fit(tokenized)

    def transform(self, items, tokenize=True):
        tokenized = tokenize and map(Extractor.tokenize, items) or items
        results = [ ]
        for lines in tokenized:
            filtered = filter(lambda line: line not in self.extract.stop_words_, lines)
            results.append(("\n".join(filtered), ))
        return results

    def fit_transform(self, items):
        tokenized = list(map(Extractor.tokenize, items))
        self.fit(tokenized, tokenize=False)
        return self.transform(tokenized, tokenize=False)

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
