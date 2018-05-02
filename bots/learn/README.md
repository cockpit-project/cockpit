# Test Flake Analysis Machine Learning

This code clusters log items related to similarity and then
classify whether new test logs fit into those clusters. The clustering
is unsupervised, and currently uses DBSCAN to accomplish this.
The classification currently uses nearest neighbor techniques.

We use distances to tell us whether two items are similar or not.
These distances are currently calculated via normalized compression
distance in ncd.py

For invoking this code see the following bots:

    bots/learn-tests
    bots/tests-data
    bots/tests-invoke
