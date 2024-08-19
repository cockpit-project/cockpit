#!/usr/bin/python3

# This file is part of Cockpit.
#
# Copyright (C) 2024 Red Hat, Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import argparse
import bisect
import fnmatch
import hashlib
import json
import os
import sys
import time
from array import array
from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import TypedDict

import pytest
from _pytest.terminal import TerminalReporter  # TODO: https://github.com/pytest-dev/pytest/issues/7469
from yarl import URL


def find_line_starts(text: str) -> Sequence[int]:
    result: list[int] = []
    try:
        line_start = 0
        while True:
            result.append(line_start)
            line_start = text.index('\n', line_start) + 1
    except ValueError:
        if not text.endswith('\n'):
            result.append(len(text) + 1)  # pretend...
        return result


# .translate() is a quick way to turn an entire sourcemap string into an
# iterable of the integer values that they represent.  We do it this way
# because parsing this string is by far the slowest thing in this program and
# .translate() happens in C.
SOURCEMAP_CHARS = b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/,;'
SOURCEMAP_TABLE = bytes(SOURCEMAP_CHARS.find(i) & 0xff for i in range(256))


# https://tc39.es/source-map/#mappings-structure
def parse_mappings(bundle: str, mappings: str) -> tuple[Sequence[int], Sequence[tuple[int, int, int]]]:
    assert mappings.endswith((';', ','))

    line_starts = find_line_starts(bundle)

    # our result
    bundle_offsets, source_offsets = array('i'), list[tuple[int, int, int]]()

    # internal state
    bundle_line = 0
    token, token_shift = [0, 0, 0, 0, 0], 0  # for collecting the machine instruction
    bits, bits_shift = 0, 0  # for collecting individual VLQ integers

    for v in mappings.encode().translate(SOURCEMAP_TABLE):
        if not v:
            # 'A': common enough for a special-case to be a net performance win
            assert not bits_shift  # We should never have an 'A' after a continuation
            token_shift += 1

        elif v < 32:
            # the final byte of a VLQ quantity: push it into the token array
            bits += v << bits_shift
            token[token_shift] += (-(bits >> 1)) if bits & 1 else (bits >> 1)  # TODO: '+=' seems oddly slow
            token_shift += 1
            bits_shift = 0
            bits = 0

        elif v < 64:
            # a non-final VLQ byte: store those bits
            bits += (v & 31) << bits_shift
            bits_shift += 5

        else:
            # a separator: process the token and emit the state
            if token_shift:
                # emit the state
                bundle_offsets.append(token[0])
                source_offsets.append((token[1], token[2], token[3]))
                token_shift = 0  # start over

            if v == 65:  # ';': a new line
                bundle_line += 1
                token[0] = line_starts[bundle_line]

    # make sure the final character is mapped -- esbuild doesn't do this for us
    bundle_offsets.append(len(bundle))
    source_offsets.append((token[1], token[2], token[3]))

    return bundle_offsets, source_offsets


# this is the type of a sourcemap: https://tc39.es/source-map/
class SourceMap(TypedDict):
    sources: str
    sourcesContent: str
    mappings: str


# these are the types reported from the browser directly via Profiler.takePreciseCoverage()
class BrowserCoverageRange(TypedDict):
    startOffset: int
    endOffset: int
    count: int


class BrowserCoverageFunction(TypedDict):
    functionName: str
    ranges: Sequence[BrowserCoverageRange]


class BrowserCoverageUrl(TypedDict):
    url: str
    functions: Sequence[BrowserCoverageFunction]


class BrowserCoverageResult(TypedDict):
    result: Sequence[BrowserCoverageUrl]


# these are the types we use in our file format (which reference the browser types)
class FileDescription(TypedDict):
    filename: str
    sha256: str


class CoverageFileEntry(TypedDict):
    bundle: FileDescription
    map: FileDescription
    functions: Sequence[BrowserCoverageFunction]


class CoverageFile(TypedDict):
    coverage: Sequence[CoverageFileEntry]


# Used to avoid reading and re-reading bundles mentioned from multiple coverage files
# also ensures that the file that we read is the one that was present during testing
class File:
    def __init__(self, description: FileDescription) -> None:
        content = Path(description['filename']).read_bytes()
        self.sha256 = hashlib.sha256(content).hexdigest()
        self.content = content.decode()

    def verify(self, description: FileDescription) -> None:
        if self.sha256 != description['sha256']:
            raise RuntimeError(f'{description['filename']} has incorrect checksum')


# A collection of all coverage data for a particular source file - mutable
class SourceCoverageData:
    def __init__(self, path: str, origin: str, content: str) -> None:
        self.path = path
        self.content = content
        self.coverage = defaultdict[tuple[str, int, int, int, int], int](lambda: 0)
        self.origin = origin
        self.line_starts = find_line_starts(content)

    def add_coverage(
        self, function: str, start_line: int, start_col: int, end_line: int, end_col: int, count: int
    ) -> None:
        self.coverage[function, start_line, start_col, end_line, end_col] += count

    def print_block(self, start_line: int, start_col: int, end_line: int, end_col: int, name: str) -> None:
        start = self.line_starts[start_line] + start_col
        end = self.line_starts[end_line] + end_col

        print(f'\033[1m{self.path}\033[0m:\033[1;36m{start_line + 1}:{start_col + 1}-{end_line + 1}:{end_col + 1} \033[34m{name}\033[0m')
        print(' ' * 6, ' ' * start_col + '▼ from here')

        for line in range(start_line, end_line + 1):
            line_start = self.line_starts[line]
            line_end = self.line_starts[line + 1] - 1

            before = self.content[line_start:start]
            highlight = self.content[max(line_start, start):min(end, line_end)]
            after = self.content[end:line_end]

            print(f'\033[1;36m{line + 1:6}\033[0m', f'{before}\033[1;31m{highlight}\033[0m{after}')

        # the end_col points to one character past the range, so adjust it backwards by 1
        print(' ' * 6, ' ' * (end_col - 1) + '▲ to here')
        print()


# A collection of all coverage data for a particular bundle - mutable
class BundleCoverageData:
    def __init__(self, filename: str, entry: CoverageFileEntry) -> None:
        self.coverage = defaultdict[tuple[str, int, int], int](lambda: 0)
        self.filename = filename
        self.bundle = File(entry['bundle'])
        self.sourcemap = File(entry['map'])
        self.functions = list[BrowserCoverageFunction]()

        try:
            map_data: SourceMap = json.loads(self.sourcemap.content)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f'{entry['map']['filename']}: {exc}') from exc

        self.src_names = map_data['sources']
        self.src_contents = map_data['sourcesContent']
        self.map_points, self.map_data = parse_mappings(self.bundle.content, map_data['mappings'])

    def add_coverage_file_entry(self, entry: CoverageFileEntry) -> None:
        assert entry['bundle']['filename'] == self.filename
        self.bundle.verify(entry['bundle'])
        self.sourcemap.verify(entry['map'])
        for f in entry['functions']:
            for r in f['ranges']:
                self.coverage[f['functionName'], r['startOffset'], r['endOffset']] += r['count']

    def map(self, start: int, end: int) -> tuple[str, str, int, int, int, int]:
        # we want to find the first point equal to or after 'start'
        # and the last point strictly before 'end'
        start_index = bisect.bisect_right(self.map_points, start - 1)
        start_file, start_line, start_col = self.map_data[start_index]

        end_index = bisect.bisect_left(self.map_points, end - 1)
        end_file, end_line, end_col = self.map_data[min(end_index, len(self.map_data) - 1)]

        # don't bother with ranges that aren't within the same file
        if start_file != end_file:
            raise ValueError

        return self.src_names[start_file], self.src_contents[start_file], start_line, start_col, end_line, end_col + 1


class Progress:
    def report_step(self, step: str) -> None:
        raise NotImplementedError

    def report_detail(self, detail: str) -> None:
        raise NotImplementedError

    def done(self) -> None:
        raise NotImplementedError


class FancyProgress(Progress):
    def report_step(self, step: str) -> None:
        self.step = step

    def report_detail(self, detail: str) -> None:
        THEME = '⠁⠁⠉⠙⠚⠒⠂⠂⠒⠲⠴⠤⠄⠄⠤⠠⠠⠤⠦⠖⠒⠐⠐⠒⠓⠋⠉⠈⠈'  # from https://github.com/console-rs/indicatif/blob/main/src/style.rs
        frame = int(time.monotonic() * 10) % len(THEME)
        sys.stdout.write(f'\r\033[2K\r{THEME[frame]} {self.step} : {detail} ')

    def done(self) -> None:
        sys.stdout.write('\r\033[2K\r')  # clear line


class BoringProgress(Progress):
    step = None

    def report_step(self, step: str) -> None:
        self.done()
        print(f'{step}:', file=sys.stderr)
        self.step = step

    def report_detail(self, detail: str) -> None:
        print(f'  {detail}', file=sys.stderr)

    def done(self) -> None:
        if self.step is not None:
            print('\n')


def report_coverage(paths: Sequence[Path], matches: Sequence[str]) -> None:
    progress = FancyProgress() if os.isatty(2) else BoringProgress()

    # We have data in three forms:
    #  - first, we have data in separate files corresponding to test runs
    #          .... which we split up and merge into ....
    #  - a set of BundleCoverageData objects, one per bundle file
    #         .... which we source-map and merge into ....
    #  - a set of SourceCoverageData objects, one per source file
    #         .... when we then use to show coverage data

    # first transformation: test runs → bundles
    progress.report_step('Parsing coverage data from test runs')
    bundles = dict[str, BundleCoverageData]()

    for path in paths:
        progress.report_detail(path.name)
        try:
            file: CoverageFile = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError) as exc:
            sys.exit(f'{path}: {exc}')

        try:
            for entry in file['coverage']:
                filename = entry['bundle']['filename']
                if filename not in bundles:
                    bundles[filename] = BundleCoverageData(filename, entry)
                bundles[filename].add_coverage_file_entry(entry)

        except (OSError, RuntimeError) as exc:
            sys.exit(f'{path}: {exc}')

    # second transformation: bundles → source files
    progress.report_step('Collecting coverage data for bundles')
    sources = dict[str, SourceCoverageData]()
    for bundle in bundles.values():
        progress.report_detail(bundle.filename)
        for (function, start, end), count in bundle.coverage.items():
            # find out what source file this block is from, and which lines/cols
            try:
                source_path, source_content, start_line, start_col, end_line, end_col = bundle.map(start, end)
            except ValueError:
                continue

            source_path = source_path.lstrip('./')  # strip leading '../' segments

            if source_path.startswith('node_modules/'):
                continue

            if source_path not in sources:
                # we didn't see this source file yet — create it
                sources[source_path] = SourceCoverageData(source_path, bundle.filename, source_content)
            else:
                # we've seen this source file before — make sure it's identical to our copy
                assert sources[source_path].content == source_content

            # add the coverage
            sources[source_path].add_coverage(function, start_line, start_col, end_line, end_col, count)

    progress.done()

    # now we're ready to print results
    any_output = False
    n_files = 0

    if matches:
        # print detailed output
        for source in sources.values():
            if not any(fnmatch.fnmatch(source.path, pat) for pat in matches):
                continue

            for (function, start_line, start_col, end_line, end_col), count in source.coverage.items():
                if count == 0:
                    source.print_block(start_line, start_col, end_line, end_col, function)
                    any_output = True

            n_files += 1

    else:
        # print summary table
        print(f'{"Path":50} {"%":>7} (bytes covered) ~ uncovered lines')
        for filename in sorted(sources):
            source = sources[filename]
            total, covered = 0, 0
            uncovered_ranges = set[tuple[int, int]]()

            for (_function, start_line, start_col, end_line, end_col), count in source.coverage.items():
                # quick and dirty - we just count byte ranges, possibly multiple-counting overlaps
                start_offset = source.line_starts[start_line] + start_col
                end_offset = source.line_starts[end_line] + end_col
                block_size = end_offset - start_offset
                total += block_size
                if count:
                    covered += block_size
                else:
                    # TODO: adjust ending line when it's at the start?
                    uncovered_ranges.add((start_line + 1, end_line + 1))

            if uncovered_ranges:
                ranges = ', '.join(f'{s}-{e}' if s != e else f'{s}' for s, e in sorted(uncovered_ranges))
                print(f'{source.path:50} {100 * covered / total:>6.1f}% ({covered} / {total}) ~ {ranges}')
                any_output = True

            n_files += 1

    if not n_files:
        print('No files considered for coverage')
    elif not any_output:
        print(f'Coverage is complete for {n_files} file{'s' if n_files != 1 else ''}')


CoverageReport = Callable[[BrowserCoverageResult], None]


@pytest.fixture
def coverage_report(
    pytestconfig: pytest.Config,
    request: pytest.FixtureRequest,
    tmp_path_factory: pytest.TempPathFactory,
) -> Iterable[CoverageReport]:
    def with_hash(filename: str) -> FileDescription:
        # capture the hash value at the time of the call. this helps to ensure
        # that we don't mix coverage data from different file versions. ideally
        # we would capture it as we serve it to the browser, but this is good
        # enough for the time being.
        path = pytestconfig.rootpath / filename
        return {
            'filename': filename,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()
        }

    output: list[CoverageFileEntry] = []

    def append_to_report(coverage_data: BrowserCoverageResult) -> None:
        for file in coverage_data['result']:
            filename = URL(file['url']).path[1:]  # pathname relative to root

            if not filename.endswith('.js'):
                continue

            try:
                output.append({
                    'bundle': with_hash(filename),
                    'map': with_hash(f'{filename}.map'),
                    'functions': file['functions']
                })
            except FileNotFoundError:
                continue

    yield append_to_report

    if output:
        basetempdir = tmp_path_factory.getbasetemp()
        if os.getenv('PYTEST_XDIST_WORKER'):
            # each xdist process gets a tmpdir subdir, but we want the parent
            basetempdir = basetempdir.parent

        assert isinstance(request.node, pytest.Item)  # fixture is not session-scoped
        item = request.node

        name = item.name.replace('/', ':') + '.js-coverage.json'
        coverage_file = basetempdir / 'js-coverage' / name
        coverage_file.parent.mkdir(exist_ok=True)
        coverage_file.write_text(json.dumps({
            'coverage': output
        }, indent=2))


def pytest_terminal_summary(config: pytest.Config, terminalreporter: TerminalReporter) -> None:
    show_cov: bool = config.getoption('jscov')
    matches: Sequence[str] = config.getoption('jscovfiles')
    if not show_cov and not matches:
        return

    # Using the tmpdir gets us:
    #  - automatic cleanup
    #  - effortless communication with xdist workers
    #  - ability to use the data out-of-process
    #  - no need to have an entire plugin to pass data around
    # So: this is definitely evil, but the alternative is *way* too complicated...
    basetempdir = config._tmp_path_factory.getbasetemp()  # type: ignore[attr-defined]
    assert isinstance(basetempdir, Path)

    coverage_dir = basetempdir / 'js-coverage'
    coverage_files = tuple(coverage_dir.glob('*.js-coverage.json'))

    terminalreporter.ensure_newline()
    terminalreporter.section('JavaScript coverage summary', sep='=', purple=True, bold=True)
    report_coverage(coverage_files, matches)


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption('--js-cov', dest='jscov', action='store_true',
                     help="Show JS coverage summary")
    parser.addoption('--js-cov-files', dest='jscovfiles', action='append',
                     help="Show detailed coverage for given JS file glob")


def main() -> None:
    parser = argparse.ArgumentParser(description='Coverage reporting tool')
    parser.add_argument('-d', '--debug', action='store_true', help="Print debugging output")
    parser.add_argument('-m', '--match', action='append', help="Filename glob pattern for source files")
    parser.add_argument('files', type=Path, nargs='+')
    args = parser.parse_args()

    report_coverage(args.files, args.match)


if __name__ == '__main__':
    main()
