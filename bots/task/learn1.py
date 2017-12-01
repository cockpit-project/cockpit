#!/usr/bin/env python
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

import collections
import gzip
import pickle
import operator
import re

from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

# The threshhold for predicting based on learned data
PREDICT_THRESHHOLD = 0.70

# The name and version of the learning data
# This changes every time something about this neural network changes
LEARN_DATA = "tests-learn-2.nn"

def load(path):
    with gzip.open(path, 'rb') as fp:
        network = pickle.load(fp)
    return network

def save(path, network):
    with gzip.open(path, 'wb') as fp:
        pickle.dump(network, fp)


# -----------------------------------------------------------------------------
# The Neural Network

class NNWithScaler1:
    def __init__(self, tokenizer):
        self.tokenizer = tokenizer
        self.network = MLPClassifier(hidden_layer_sizes=(500, 500))
        self.scaler = StandardScaler()

    def predict(self, item):
        features, unused = self.digest(item)
        X = self.scaler.transform([features])
        return self.network.predict(X)[0]

    def predict_proba(self, item):
        features, unused = self.digest(item)
        X = self.scaler.transform([features])
        return self.network.predict_proba(X)[0]

    def digest(self, item):
        tokens = self.tokenizer.tokenize(item['log'])
        features = []
        # firstly output features for contexts
        for context in self.tokenizer.contexts:
            features.append(int(item['context'] == context))
        # secondly output features for tests
        for test in self.tokenizer.tests:
            features.append(int(item['test'] == test))
        # thirdly output features for tokens
        for token in self.tokenizer.tokens:
            features.append(tokens[token])
        # When "merged" is none it's unknown, lets use -1 for that
        result = item.get('merged')
        if result:
            result = 1
        elif result is not None:
            result = 0
        return features, result

    def train(self, items):
        # For sanity checking
        not_merged = 0
        merged = 0

        # Create the data set
        X, y = [], []
        for i, item in enumerate(items):
            if item.get('status') != "failure":
                continue
            features, result = self.digest(item)
            if result == 0:
                not_merged += 1
            elif result == 1:
                merged += 1
            else:
                continue
            X.append(features)
            y.append(result)

        # Some validation now
        if merged + not_merged < 100:
            raise RuntimeError("too few training data points: {0}".format(merged + not_merged))
        if not_merged < 100:
            raise RuntimeError("too little of training data represents non-flakes: {0}".format(not_merged))
        if merged < 100:
            raise RuntimeError("too little of training data represents flakes: {0}".format(merged))

        # Actual neural network training
        self.scaler.fit(X)
        X = self.scaler.transform(X)
        self.network.fit(X, y)

# -----------------------------------------------------------------------------
# The Tokenizer

SPLIT_RE = re.compile(r'[\s]')

TOKEN_REGEXES = {
    'SpecialToken:Number': re.compile(r'^\d+(\.\d+)?$'),
    'SpecialToken:Percent': re.compile(r'^\d+(\.\d+)?%$'),
    'SpecialToken:Time': re.compile(r'\d\d:\d\d:\d\d'),
    'SpecialToken:UUID': re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I),
    'SpecialToken:WSCerts': re.compile(r'^/etc/cockpit/ws-certs.d/0-self-signed.cert:[\w/\+]+$'),
}

class Tokenizer1:
    top_tokens = 9000

    def __init__(self):
        self.tokens = collections.defaultdict(int)
        self.contexts = set()
        self.tests = set()

    def tokenize(self, log):
        def noise(line):
            return line.startswith("Journal extracted") or \
                line.startswith("Wrote ") or \
                line.startswith("Warning: Permanently added") or \
                line.startswith("not ok ") or \
                line.startswith("# Flake") or \
                line.startswith("# ---------------") or \
                line.strip() == "#"

        # Filter out noise lines
        log = "\n".join(filter(lambda x: not noise(x), log.split('\n')))

        result = [ ]

        def unify_token(token):
            if len(token) < 4:
                return None
            elif len(set(token)) == 1:
                # omit stuf like "--------------------------"
                return None
            else:
                for name, regex in TOKEN_REGEXES.items():
                    if regex.match(token):
                        return name
            return token

        split = SPLIT_RE.split(log)
        for i in split:
            unified = unify_token(i)
            if unified is not None:
                result.append(unified)

        tokens = collections.defaultdict(int)
        for token in result:
            tokens[token] = tokens.get(token, 0) + 1
        return tokens

    def parse(self, items, verbose=False):
        tokens = collections.defaultdict(int)
        contexts = set()
        tests = set()

        for item in items:
            for token, count in self.tokenize(item['log']).items():
                tokens[token] = tokens.get(token, 0) + count
            contexts.add(item['context'])
            tests.add(item['test'])

        # Get the top number of tokens
        usetokens = []
        for token, count in sorted(tokens.items(), key=operator.itemgetter(1), reverse=True):
            usetokens.append(token)
            if len(usetokens) == self.top_tokens:
                break

        self.tokens = usetokens
        self.contexts = sorted(contexts)
        self.tests = sorted(tests)
