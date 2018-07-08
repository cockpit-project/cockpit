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
VERSION = 5

# This attempts to cluster log items related to similarity and then
# classify whether new test logs fit into those clusters. The clustering
# is unsupervised, and currently uses DBSCAN to accomplish this.
# The classification currently uses nearest neighbor techniques.
#
# We use distances to tell us whether two items are similar or not.
# These distances are currently calculated via normalized compression
# distance in ncd.py

# The threshhold of where we start to treat a cluster as a flakey if
# the number of tests that failed but were merged anyway is over:
FLAKE_THRESHOLD = 0.4

import gzip
import operator
import os
import pickle
import random
import sys
import time
import tempfile

import sklearn.cluster
import sklearn.neighbors

BASE = os.path.dirname(__file__)
sys.path.insert(1, os.path.join(BASE, ".."))

from learn import ncd
from learn import extractor

# The name and version of the learning data
FILENAME = "tests-learn-{0}-{1}.model".format(VERSION, extractor.VERSION)

# Note that we use pickle protocol=4 to get over size limits

# Load a model from the given directory
# Return None of the model doesn't exist
def load(directory):
    path = os.path.join(directory, FILENAME)
    if not os.path.exists(path):
        return None
    with gzip.open(path, 'rb') as fp:
        model = pickle.load(fp)
    return model

# Write a model to the given directory
def save(directory, model):
    path = os.path.join(directory, FILENAME)
    (outfd, outname) = tempfile.mkstemp(prefix=FILENAME, dir=directory)
    os.close(outfd)
    with gzip.open(outname, 'wb') as fp:
        pickle.dump(model, fp, protocol=4)
    os.rename(outname, path)
    return path

# A cluster of items with optional analysis of those items
# The items are not stored here, but their points in the
# array are.
class Cluster():
    def __init__(self, label, points):
        self.label = label
        self.points = points

    # Analyse the cluster, based on the points added in
    # the cluster. The points should be indexes into the
    # items array.
    def analyze(self, features):
        num_merged = 0

        for point in self.points:
            merged = features[point][extractor.FEATURE_MERGED]
            if merged == 1:
                num_merged += 1

        total = len(self.points)

        # Calculate the merged probabilities
        if total:
            merged = (float(num_merged) / float(total))
            if merged > 1:
                merged = 1

        # Probability that this cluster represents the given name
        return {
            "total": total,
            "merged": merged,
            "trackers": self.group_by(features, extractor.FEATURE_TRACKER, factor=extractor.TRACKER_SPARSE),
            "names": self.group_by(features, extractor.FEATURE_NAME),
            "contexts": self.group_by(features, extractor.FEATURE_CONTEXT)
        }

    # Figure out how often given values of a feature show up in a cluster
    def group_by(self, features, feature, limit=5, factor=1):
        values = { }
        total = 0
        for point in self.points:
            value = features[point][feature]
            if value:
                # If we have a factor, some of the features may be sparse
                # So account for the spareness in our probability estimates
                values[value] = values.get(value, 0) + factor
                total += factor
            else:
                total += 1
        listing = [ ]
        for value, count in values.items():
            probability = float(count) / float(total or 1)
            listing.append((value, min(probability, 1)))
        listing.sort(key=operator.itemgetter(1), reverse=True)
        return listing[0:limit]

    # Dump the selected cluster to disk. The features are the inputs
    # from the model that were used to build the cluster.
    def dump(self, directory, features, detail=None):
        if self.label is None:
            label = "noise"
        else:
            label = "cluster-{0}".format(self.label)

        # Dump our stuff into the directory
        if not os.path.exists(directory):
            os.mkdir(directory)

        path = os.path.join(directory, "{0}-{1}.log".format(label, detail or len(self.points)))
        with open(path, "a") as fp:
            for row in self.analyze(features).items():
                fp.write("{0}: {1}\n".format(row[0], repr(row[1])))
            fp.write("\n\n")
            for point in self.points:
                url = features[point][extractor.FEATURE_URL]
                if url:
                    fp.write("{0}\n".format(url))
                fp.write(features[point][extractor.FEATURE_LOG])
                fp.write("\n\n")

# The clustering model. Uses unsupervised clustering to build clusters
# out of data extracted from test logs. See extractor.py for the code
# that extracts features from the logs.
#
# Also allows classification into the built clusters.
#
class Model():
    eps = 0.3           # Maximum distance between two samples in neighborhood
    min_samples = 3     # Minimum number of samples in a cluster

    def __init__(self, verbose=False):
        self.clusters = { }      # The actual clustered items
        self.verbose = verbose
        self.extractor = None
        self.features = None

    # Perform the unsupervised clustering
    def train(self, items):
        self.clusters = { }
        self.noise = [ ]

        items = list(items)

        # Extract the features we want to use for clustering from the items
        self.extractor = extractor.Extractor()
        self.features = self.extractor.fit_transform(items)

        if self.verbose:
            sys.stderr.write("{0}: Items to train\n".format(len(self.features)))

        jobs = os.cpu_count() or -1
        start = time.perf_counter()

        # Initialize the NCD code with our log feature. Currently only
        # one feature is used: the normalized log
        X = ncd.prepare(map(lambda features: features[extractor.FEATURE_LOG], self.features))

        # Calculate all the pairwise distances between the items in question
        # The scikit DBSCAN implementation does this anyway, poorly. So why not
        # do it ahead of time and parralelize it ... which we do here. Then we
        #
        # TODO: This takes forever and is an O(n^2) operation
        # There is significant room for improvement both here, and in the following
        # DBSCAN usage and implementation. Techniques such as feature/item selection
        # BIRCH, ball trees, or many other things could make this better/faster
        matrix = sklearn.metrics.pairwise.pairwise_distances(X, metric=ncd.metric, n_jobs=jobs)

        if self.verbose:
            sys.stderr.write("{0}: Computed distances in {1} seconds on {2} cores\n".format(
                int((len(self.features) * len(self.features)) / 2),
                int(time.perf_counter() - start), jobs
            ))

        # Actually perform the clustering. This is fast compared to above
        min_samples = min(self.min_samples, len(self.features) / 10)
        dbs = sklearn.cluster.DBSCAN(metric='precomputed', eps=self.eps, min_samples=min_samples)
        dbs.fit(matrix)
        labels = dbs.labels_

        # Create clusters of all the items
        clusters = { }
        noise = [ ]
        for i, label in enumerate(labels):
            if label == -1:
                noise.append(i)
            else:
                if label not in clusters:
                    clusters[label] = [ ]
                clusters[label].append(i)
        self.clusters = { }
        for label, indexes in clusters.items():
            self.clusters[label] = Cluster(label, indexes)
        self.noise = Cluster(None, noise)

        # Print out a rough description of that
        if self.verbose:
            sys.stderr.write("{0}: Clusters ({1} items, {2} noise)\n".format(
                len(self.clusters.keys()),
                len(self.features) - len(noise),
                len(noise)
            ))

        # Setup our neighbors classifier for predict()
        self.neighbors = sklearn.neighbors.KNeighborsClassifier(metric='precomputed', weights='distance')
        self.neighbors.fit(matrix, labels)

    # Predict which clusters these items are a part of
    # The cluster labels are returned for each item, along with a probability
    def predict(self, items):
        features = self.extractor.transform(items)
        Y = ncd.prepare(map(lambda x: x[0], self.features))
        X = ncd.prepare(map(lambda x: x[0], features))
        matrix = sklearn.metrics.pairwise.pairwise_distances(X, Y, metric=ncd.metric, n_jobs=-1)
        result = [ ]

        # TODO: The probability is currently bogus, we could use distance measurements to fill it in
        for label in self.neighbors.predict(matrix):
            if label == -1:
                result.append((None, 0.0))
            else:
                # TODO: The problem here is we don't classify noise properly, should use eps (above)
                result.append((label, 0.5))
        return result

    # Dump the cluster's models and noise to a directory
    def dump(self, directory):
        for label, cluster in self.clusters.items():
            cluster.dump(directory, self.features)
        self.noise.dump(directory, self.features)

# This is a helpful debugger to help diagnose data, and figure out if we're
# getting the above threshold and regular expressions right
if __name__ == '__main__':
    import data
    import argparse

    parser = argparse.ArgumentParser(description="Clusterize input data")
    parser.add_argument("--only", action="append", help="Only analyze these statuses")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print verbose progress output")
    parser.add_argument("filename", help="Training data in JSONL gzip format")
    opts = parser.parse_args()

    # The kind of statuses to inlcude
    if not opts.only:
        only = None
    else:
        only = lambda item: item.get("status") in opts.only

    # Load the actual data
    items = data.load(opts.filename, only=only, verbose=opts.verbose)

    # Split items into two sets with probability factor
    def split(items, factor):
        a, b = [ ], [ ]
        for item in items:
            if random.random() < factor:
                a.append(item)
            else:
                b.append(item)
        return a, b
    train, predict = split(items, 0.6)

    # Write to the current directory
    directory = "."

    model = Model(verbose=opts.verbose)
    model.train(train)

    results = model.predict(predict)

    # Dump our clusters and predicted results, using fake clusters
    model.dump(directory)
    for point, result in enumerate(results):
        Cluster(result[0], [ 0 ]).dump(directory, [ (predict[point]["log"], ) ], detail="predict")
