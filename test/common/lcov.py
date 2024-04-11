#!/usr/bin/python3 -cimport os, sys; os.execv(os.path.dirname(sys.argv[1]) + "/pywrap", sys.argv)

# This file is part of Cockpit.
#
# Copyright (C) 2022 Red Hat, Inc.
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

# This module can convert profile data from CDP to LCOV, produce a
# HTML report, and post review comments.
#
# - write_lcov (coverage_data, outlabel)
# - create_coverage_report()

import glob
import gzip
import itertools
import json
import os
import re
import shutil
import subprocess
import sys
from bisect import bisect_left

from task import github

BASE_DIR = os.path.realpath(f'{__file__}/../../..')

debug = False

# parse_vlq and parse_sourcemap are based on
# https://github.com/mattrobenolt/python-sourcemap, licensed with
# "BSD-2-Clause License"

# Mapping of base64 letter -> integer value.
B64 = {c: i for i, c in
       enumerate('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
                 '0123456789+/')}


def parse_vlq(segment):
    """Parse a string of VLQ-encoded data.
    Returns:
      a list of integers.
    """

    values = []

    cur, shift = 0, 0
    for c in segment:
        val = B64[c]
        # Each character is 6 bits:
        # 5 of value and the high bit is the continuation.
        val, cont = val & 0b11111, val >> 5
        cur += val << shift
        shift += 5

        if not cont:
            # The low bit of the unpacked value is the sign.
            cur, sign = cur >> 1, cur & 1
            if sign:
                cur = -cur
            values.append(cur)
            cur, shift = 0, 0

    if cur or shift:
        raise Exception('leftover cur/shift in vlq decode')

    return values


def parse_sourcemap(f, line_starts, dir_name):
    smap = json.load(f)
    sources = smap['sources']
    mappings = smap['mappings']
    lines = mappings.split(';')

    our_map = []

    our_sources = set()
    for s in sources:
        if "node_modules" not in s and (s.endswith(('.js', '.jsx', '.ts', '.tsx'))):
            our_sources.add(s)

    dst_col, src_id, src_line = 0, 0, 0
    for dst_line, line in enumerate(lines):
        segments = line.split(',')
        dst_col = 0
        for segment in segments:
            if not segment:
                continue
            parse = parse_vlq(segment)
            dst_col += parse[0]

            src = None
            if len(parse) > 1:
                src_id += parse[1]
                src = sources[src_id]
                src_line += parse[2]

            if src in our_sources:
                norm_src = os.path.normpath(os.path.join(dir_name, src))
                our_map.append((line_starts[dst_line] + dst_col, norm_src, src_line))

    return our_map


class DistFile:
    def __init__(self, path):
        line_starts = [0]
        with open(path, newline='') as f:
            for line in f.readlines():
                line_starts.append(line_starts[-1] + len(line))
        with open(path + ".map") as f:
            self.smap = parse_sourcemap(f, line_starts, os.path.relpath(os.path.dirname(path), BASE_DIR))

    def find_sources_slow(self, start, end):
        res = []
        for m in self.smap:
            if m[0] >= start and m[0] < end:
                res.append(m)
        return res

    def find_sources(self, start, end):
        res = []
        i = bisect_left(self.smap, start, key=lambda m: m[0])
        while i < len(self.smap) and self.smap[i][0] < end:
            res.append(self.smap[i])
            i += 1
        if debug and res != self.find_sources_slow(start, end):
            raise RuntimeError("Bug in find_sources")
        return res


def get_dist_map(package):
    dmap = {}
    for manifest_json in glob.glob(f"{BASE_DIR}/dist/*/manifest.json") + glob.glob(f"{BASE_DIR}/dist/manifest.json"):
        with open(manifest_json) as f:
            m = json.load(f)
        if "name" in m:
            dmap[m["name"]] = os.path.dirname(manifest_json)
        elif manifest_json == f"{BASE_DIR}/dist/manifest.json":
            if "name" in package:
                dmap[package["name"]] = os.path.dirname(manifest_json)
    return dmap


def get_distfile(url, dist_map):
    parts = url.split("/")
    if len(parts) < 3 or "cockpit" not in parts:
        return None

    base = parts[-2]
    file = parts[-1]
    if file == "manifests.js":
        return None
    if base in dist_map:
        path = dist_map[base] + "/" + file
    else:
        path = f"{BASE_DIR}/dist/" + base + "/" + file
    if os.path.exists(path) and os.path.exists(path + ".map"):
        return DistFile(path)
    else:
        sys.stderr.write(f"SKIP {url} -> {path}\n")
        return None


def grow_array(arr, size, val):
    if len(arr) < size:
        arr.extend([val] * (size - len(arr)))


def record_covered(file_hits, src, line, hits):
    if src in file_hits:
        line_hits = file_hits[src]
    else:
        line_hits = []
    grow_array(line_hits, line + 1, None)
    line_hits[line] = hits
    file_hits[src] = line_hits


def record_range(file_hits, r, distfile):
    sources = distfile.find_sources(r['startOffset'], r['endOffset'])
    for src in sources:
        record_covered(file_hits, src[1], src[2], r['count'])


def merge_hits(file_hits, hits):
    for src in hits:
        if src not in file_hits:
            file_hits[src] = hits[src]
        else:
            lines = file_hits[src]
            merge_lines = hits[src]
            grow_array(lines, len(merge_lines), None)
            for i in range(len(merge_lines)):
                if lines[i] is None:
                    lines[i] = merge_lines[i]
                elif merge_lines[i] is not None:
                    lines[i] += merge_lines[i]


def print_file_coverage(path, line_hits, out):
    lines_found = 0
    lines_hit = 0
    src = f"{BASE_DIR}/{path}"
    out.write(f"SF:{src}\n")
    for i in range(len(line_hits)):
        if line_hits[i] is not None:
            lines_found += 1
            out.write(f"DA:{i + 1},{line_hits[i]}\n")
            if line_hits[i] > 0:
                lines_hit += 1
    out.write(f"LH:{lines_hit}\n")
    out.write(f"LF:{lines_found}\n")
    out.write("end_of_record\n")


class DiffMap:
    # Parse a unified diff and make a index for the added lines
    def __init__(self, diff):
        self.map = {}
        self.source_map = {}
        plus_name = None
        diff_line = 0
        with open(diff) as f:
            for line in f.readlines():
                diff_line += 1
                if line.startswith("+++ /dev/null"):
                    # removed file, only `^-` following after that until the next hunk
                    continue
                elif line.startswith("+++ b/"):
                    plus_name = os.path.normpath(line[6:].strip())
                    plus_line = 1
                    self.map[plus_name] = {}
                elif line.startswith("@@ "):
                    plus_line = int(line.split(" ")[2].split(",")[0])
                elif line.startswith(" "):
                    plus_line += 1
                elif line.startswith("+"):
                    self.map[plus_name][plus_line] = diff_line
                    self.source_map[diff_line] = (plus_name, plus_line, line[1:])
                    plus_line += 1

    def find_line(self, file, line):
        if file in self.map and line in self.map[file]:
            return self.map[file][line]
        return None

    def find_source(self, diff_line):
        return self.source_map.get(diff_line)


def print_diff_coverage(path, file_hits, out):
    if not os.path.exists(path):
        return
    dm = DiffMap(path)
    src = f"{BASE_DIR}/{path}"
    lines_found = 0
    lines_hit = 0
    out.write(f"SF:{src}\n")
    for f in file_hits:
        line_hits = file_hits[f]
        for i in range(len(line_hits)):
            if line_hits[i] is not None:
                diff_line = dm.find_line(f, i + 1)
                if diff_line:
                    lines_found += 1
                    out.write(f"DA:{diff_line},{line_hits[i]}\n")
                    if line_hits[i] > 0:
                        lines_hit += 1
    out.write(f"LH:{lines_hit}\n")
    out.write(f"LF:{lines_found}\n")
    out.write("end_of_record\n")


def write_lcov(covdata, outlabel):

    with open(f"{BASE_DIR}/package.json") as f:
        package = json.load(f)
    dist_map = get_dist_map(package)
    file_hits = {}

    def covranges(functions):
        for f in functions:
            for r in f['ranges']:
                yield r

    # Coverage data is reported as a "count" value for a range of
    # text.  These ranges overlap when functions are nested.  For
    # example, take this source code:
    #
    #  1 .  function foo(x) {
    #  2 .    function bar() {
    #  3 .    }
    #  4 .    if (x)
    #  5 .      bar();
    #  6 .  }
    #  7 .
    #  8 .  foo(0)
    #
    # There will be a range with count 1 for the whole source code
    # (lines 1 to 8) since all code is executed when loading a file.
    # Then there will be a range with count 1 for "foo" (lines 1 to 6)
    # since it is called from the top-level, and there will be a range
    # with count 0 for "bar" (lines 2 and 3), since it is never
    # actually called.  If block-level precision has been enabled
    # while collecting the coverage data, there will also be a range
    # with count 0 for line 5, since that branch if the "if" is not
    # executed.
    #
    # We process ranges like this in order, from longest to shortest,
    # and record their counts for each line they cover. The count of a
    # range that is processed later will overwrite any count that has
    # been recorded earlier. This makes the count correct for nested
    # functions since they are processed last.
    #
    # In the example, first lines 1 to 8 are set to count 1, then
    # lines 1 to 6 are set to count 1 again, then lines 2 and 3 are
    # set to count 0, and finally line 5 is also set to count 0:
    #
    #  1 1  function foo(x) {
    #  2 0    function bar() {
    #  3 0    }
    #  4 1    if (x)
    #  5 0      bar();
    #  6 1  }
    #  7 1
    #  8 1  foo(0)
    #
    # Thus, when processing ranges for a single file, we must
    # prioritize the counts of smaller ranges over larger ones, and
    # can't just add them all up.  This doesn't work, however, when
    # something like webpack is involved, and a source file is copied
    # into multiple files in "dist/".
    #
    # The coverage data contains ranges for all files that are loaded
    # into the browser during the whole session, such as when
    # transitioning from the login page to the shell, and when loading
    # multiple iframes for the individual pages.
    #
    # For example, if both shell.js (loaded at the top-level) and
    # overview.js (loaded into an iframe) include lib/button.js, then
    # the coverage data might report that shell.js does execute line 5
    # of lib/button.js and also that overview.js does not execute it.
    # We need to add the counts up for line 5 so that the combined
    # report says that is has been executed.
    #
    # The same applies to reloading and navigating in the browser.  If
    # a page is reloaded, there will be separate coverage reports for
    # its files.  For example, if a reload happens, shell.js will be
    # mentioned twice in the report, and we need to add up the counts
    # from each mention.

    for script in covdata:
        distfile = get_distfile(script['url'], dist_map)
        if distfile:
            ranges = sorted(covranges(script['functions']),
                            key=lambda r: r['endOffset'] - r['startOffset'], reverse=True)
            hits = {}
            for r in ranges:
                record_range(hits, r, distfile)
            merge_hits(file_hits, hits)

    if len(file_hits) > 0:
        os.makedirs(f"{BASE_DIR}/lcov", exist_ok=True)
        filename = f"{BASE_DIR}/lcov/{outlabel}.info.gz"
        with gzip.open(filename, "wt") as out:
            for f in file_hits:
                print_file_coverage(f, file_hits[f], out)
            print_diff_coverage("lcov/github-pr.diff", file_hits, out)
        print("Wrote coverage data to " + filename)


def get_review_comments(diff_info_file):
    comments = []
    cur_src = None
    start_line = None
    cur_line = None

    def is_interesting_line(text):
        # Don't complain when being told to shut up
        if "// not-covered: " in text:
            return False
        # Don't complain about lines that contain only punctuation, or
        # nothing but "else".  We don't seem to get reliable
        # information for them.
        if not re.search('[a-zA-Z0-9]', text.replace("else", "")):
            return False
        return True

    def flush_cur_comment():
        nonlocal comments
        if cur_src:
            ta_url = os.environ.get("TEST_ATTACHMENTS_URL", None)
            comment = {"path": cur_src,
                       "line": cur_line}
            if start_line != cur_line:
                comment["start_line"] = start_line
                body = f"These {cur_line - start_line + 1} added lines are not executed by any test."
            else:
                body = "This added line is not executed by any test."
            if ta_url:
                body += f"  [Details]({ta_url}/Coverage/lcov/github-pr.diff.gcov.html)"
            comment["body"] = body
            comments.append(comment)

    dm = DiffMap("lcov/github-pr.diff")

    with open(diff_info_file) as f:
        for line in f.readlines():
            if line.startswith("DA:"):
                parts = line[3:].split(",")
                if int(parts[1]) == 0:
                    info = dm.find_source(int(parts[0]))
                    if not info:
                        continue
                    (src, line, text) = info
                    if not is_interesting_line(text):
                        continue
                    if src == cur_src and line == cur_line + 1:
                        cur_line = line
                    else:
                        flush_cur_comment()
                        cur_src = src
                        start_line = line
                        cur_line = line
        flush_cur_comment()

    return comments


def prepare_for_code_coverage():
    # This gives us a convenient link at the top of the logs, see link-patterns.json
    print("Code coverage report in Coverage/index.html")
    if os.path.exists("lcov"):
        shutil.rmtree("lcov")
    os.makedirs("lcov")
    # Detect the default branch to compare with, Anaconda still uses master as main.
    branch = "main"
    try:
        subprocess.check_call(["git", "rev-parse", "--quiet", "--verify", branch], stdout=subprocess.DEVNULL)
    except subprocess.SubprocessError:
        branch = "master"
    with open("lcov/github-pr.diff", "w") as f:
        subprocess.check_call(["git", "-c", "diff.noprefix=false", "diff", "--patience", branch], stdout=f)


def create_coverage_report():
    output = os.environ.get("TEST_ATTACHMENTS", BASE_DIR)
    lcov_files = glob.glob(f"{BASE_DIR}/lcov/*.info.gz")
    try:
        title = os.path.basename(subprocess.check_output(["git", "remote", "get-url", "origin"])).decode().strip()
    except subprocess.CalledProcessError:
        title = "?"
    if len(lcov_files) > 0:
        all_file = f"{BASE_DIR}/lcov/all.info"
        diff_file = f"{BASE_DIR}/lcov/diff.info"
        excludes = []
        # Exclude pkg/lib in Cockpit projects such as podman/machines.
        if title != "cockpit.git":
            excludes = ["--exclude", "pkg/lib"]
        subprocess.check_call(["lcov", "--quiet", "--output", all_file, *excludes,
                               *itertools.chain(*[["--add", f] for f in lcov_files])])
        subprocess.check_call(["lcov", "--quiet", "--ignore-errors", "empty,empty,unused,unused", "--output", diff_file,
                               "--extract", all_file, "*/github-pr.diff"])
        summary = subprocess.check_output(["genhtml", "--no-function-coverage",
                                           "--prefix", os.getcwd(),
                                           "--title", title,
                                           "--output-dir", f"{output}/Coverage", all_file]).decode()

        coverage = summary.split("\n")[-2]
        match = re.search(r".*lines\.*:\s*([\d\.]*%).*", coverage)
        if match:
            print("Overall line coverage:", match.group(1))

        comments = get_review_comments(diff_file)
        rev = os.environ.get("TEST_REVISION", None)
        pull = os.environ.get("TEST_PULL", None)
        if rev and pull:
            api = github.GitHub()
            old_comments = api.get(f"pulls/{pull}/comments?sort=created&direction=desc&per_page=100") or []
            for oc in old_comments:
                if ("body" in oc and "path" in oc and "line" in oc and
                   "not executed by any test." in oc["body"]):
                    api.delete(f"pulls/comments/{oc['id']}")
            if len(comments) > 0:
                api.post(f"pulls/{pull}/reviews",
                         {"commit_id": rev, "event": "COMMENT",
                          "comments": comments})
    else:
        sys.stderr.write("Error: no code coverage files generated\n")
