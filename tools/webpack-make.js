#!/usr/bin/env node

/*
 * Builds with webpack and generates a Makefile include that
 * lists all dependencies, inputs, outputs, and installable files
 */

const webpack = require("webpack");
const path = require("path");
const argparse = require("argparse");
const fs = require("fs");
const CockpitRsyncPlugin = require("../pkg/lib/cockpit-rsync-plugin");

// argv0 is node
const webpack_watch = process.argv[1].includes('webpack-watch');

const parser = argparse.ArgumentParser();
parser.add_argument('-c', '--config', { help: "Path to webpack.config.js", default: "webpack.config.js" });
parser.add_argument('-r', '--rsync', { help: "rsync webpack to ssh target after build", metavar: "HOST" });
parser.add_argument('-w', '--watch', { action: 'store_true', help: "Enable webpack watch mode", default: webpack_watch });
parser.add_argument('-e', '--no-eslint', { action: 'store_true', help: "Disable eslint linting" });
parser.add_argument('-s', '--no-stylelint', { action: 'store_true', help: "Disable stylelint linting" });
parser.add_argument('prefix', { help: "The directory to build (eg. base1, shell, ...)", metavar: "DIRECTORY" });
const args = parser.parse_args();

if (args.no_eslint) {
    process.env.ESLINT = "0";
} else if (args.watch) {
    process.env.ESLINT = "1";
}

if (args.no_stylelint) {
    process.env.STYLELINT = "0";
} else if (args.watch) {
    process.env.STYLELINT = "1";
}

if (args.prefix.includes('/')) {
    parser.error("Directory must not contain '/'");
}

const prefix = args.prefix;
const makefile = "dist/" + prefix + "/Makefile.deps";
process.env.ONLYDIR = prefix + "/";

const srcdir = (process.env.SRCDIR || ".").replace(/\/$/, '');
const cwd = process.cwd();
const config_path = path.resolve(cwd, args.config);
const config = require(config_path);

if (args.rsync) {
    process.env.RSYNC = args.rsync;
    config.plugins.push(new CockpitRsyncPlugin({ source: path.dirname(makefile) }));
}

const compiler = webpack(config);

if (args.watch) {
    compiler.hooks.watchRun.tap("WebpackInfo", compilation => {
        const time = new Date().toTimeString().split(' ')[0];
        process.stdout.write(`${time} Build started\n`);
    });
    compiler.watch(config.watchOptions, process_result);
} else {
    compiler.run(process_result);
}

function process_result(err, stats) {
    // process.stdout.write(stats.toString({colors: true}) + "\n");

    if (err) {
        console.log(JSON.stringify(err));
        process.exit(1);
    }

    if (args.watch) {
        const info = stats.toJson();
        const time = new Date().toTimeString().split(' ')[0];
        process.stdout.write(`${time} Build succeeded, took ${info.time / 1000}s\n`);
    }

    // Failure exit code when compilation fails
    if (stats.hasErrors() || stats.hasWarnings())
        console.log(stats.toString("normal"));

    if (stats.hasErrors()) {
        if (!args.watch)
            process.exit(1);
        return;
    }

    generateDeps(makefile, stats);
}

function generateDeps(makefile, stats) {
    const stampfile = '$(srcdir)/' + path.dirname(makefile) + '/manifest.json';
    const dir = path.relative('', stats.compilation.outputOptions.path);
    const now = Math.floor(Date.now() / 1000);

    /* If any of these changes, then everything definitely needs to be
     * rebuilt.  These aren't mentioned in fileDependencies, though.
     */
    const inputs = new Set([
        'package-lock.json',
        'tools/webpack-make.js',
        'webpack.config.js',
    ]);

    for (const file of stats.compilation.fileDependencies) {
        // node modules  are handled by the dependency on package-lock.json
        if (file.includes('/node_modules/'))
            continue;

        // Webpack 5 includes directories: https://github.com/webpack/webpack/issues/11971
        if (fs.lstatSync(file).isDirectory())
            continue;

        const input = path.relative(srcdir, file);

        // HACK: webpack looks at files in parent dir: https://github.com/webpack/webpack/issues/14481
        if (input.startsWith("../")) {
            process.stderr.write(`webpack-make: Ignoring file dependency ${file} outside of project directory: ${srcdir}\n`);
            continue;
        }

        inputs.add(input);
    }

    const outputs = new Set();
    const installs = new Set();
    const tests = new Set();
    for (const asset in stats.compilation.assets) {
        const output = path.join(dir, asset);
        fs.utimesSync(output, now, now);

        if (!asset.endsWith("/manifest.json") && !asset.endsWith(".map"))
            outputs.add(output);

        if (asset.includes("/test-")) {
            if (asset.endsWith(".html")) {
                tests.add(output);
            }
            continue;
        }

        if (asset.endsWith(".map") || asset.endsWith(".LICENSE.txt"))
            continue;

        installs.add(output);
    }

    const lines = ["# Generated Makefile data for " + prefix];

    function makeArray(name, set) {
        lines.push(name + " = \\");
        for (const value of [...set.keys()].sort()) {
            lines.push("\t" + value + " \\");
        }
        lines.push("\t$(NULL)");
        lines.push("");
    }

    makeArray(prefix + "_INPUTS", inputs);
    makeArray(prefix + "_OUTPUTS", outputs);

    makeArray(prefix + "_INSTALL", installs);
    makeArray(prefix + "_TESTS", tests);

    lines.push(stampfile + ": $(" + prefix + "_INPUTS)");
    lines.push("");

    for (const name of [...outputs.keys()].sort()) {
        lines.push(name + ": " + stampfile);
        lines.push("");
    }

    for (const name of [...inputs.keys()].sort()) {
        lines.push(name + ":");
        lines.push("");
    }

    lines.push("WEBPACK_INPUTS += $(" + prefix + "_INPUTS)");
    lines.push("WEBPACK_OUTPUTS += $(" + prefix + "_OUTPUTS)");
    lines.push("WEBPACK_INSTALL += $(" + prefix + "_INSTALL)");
    lines.push("WEBPACK_GZ_INSTALL += $(" + prefix + "_GZ_INSTALL)");
    lines.push("TESTS += $(" + prefix + "_TESTS)");
    lines.push("");

    lines.push(prefix + ": " + stampfile);

    fs.writeFileSync(makefile, lines.join("\n") + "\n");
}
