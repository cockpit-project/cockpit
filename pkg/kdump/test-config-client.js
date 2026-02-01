/*
 * Copyright (C) 2016 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import QUnit from "qunit-tests";
import cockpit from "cockpit";

import * as kdump from "./config-client.js";

const basicConfig = [
    "# top comment",
    "",
    "foo bar",
    " indented value",
    "",
    "will disappear",
    "key value #comment"
].join("\n");

const changedConfig = [
    "# top comment",
    "",
    "foo moo",
    "indented value",
    "",
    "#key value #comment",
    "hooray value",
    "core_collector makedumpfile -l --message-level 7 -d 31",
    ""
].join("\n");

QUnit.module("kdump", hooks => {
    let filename = "";

    hooks.before(async () => {
        filename = await cockpit.spawn(["/usr/bin/mktemp", "--suffix", "kdump-test"]);
        filename = filename.trim();
    });

    hooks.after(() => cockpit.spawn(["rm", "-f", filename]));

    QUnit.test("config_update", function(assert) {
        const done = assert.async();
        assert.expect(6);
        const dataWasChanged = new Promise(resolve => { this.dataWasChangedResolve = resolve });
        let config;
        const configChanged = (event, settings) => {
            assert.equal(settings._internal.foo.value, "moo", "value changed correctly");
            assert.equal("key" in settings._internal, false, "setting with comment deleted correctly");
            assert.equal("will" in settings._internal, false, "setting without comment deleted correctly");
            assert.equal(settings._internal.hooray.value, "value", "value added correctly");
            assert.equal(config._rawContent, changedConfig, "raw text for changed config is correct");
            this.dataWasChangedResolve();
        };

        const configFile = cockpit.file(filename);
        configFile
                .replace(basicConfig)
                .then(() => {
                    assert.equal(configFile.path, filename, "file has correct path");
                    config = new kdump.ConfigFile(filename);
                    config.wait().then(() => {
                        config.settings._internal.foo.value = "moo";
                        delete config.settings._internal.key;
                        delete config.settings._internal.will;
                        config.settings._internal.hooray = { value: "value" };
                        config.addEventListener('kdumpConfigChanged', configChanged);
                        config.write(config.settings)
                                .then(() => {
                                    // Close watch channel
                                    config.removeEventListener('kdumpConfigChanged', configChanged);
                                    config.close();
                                    dataWasChanged.then(done);
                                });
                    });
                });
    });
});

window.setTimeout(function() {
    QUnit.start();
});
