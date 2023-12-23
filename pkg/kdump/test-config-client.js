/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
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

QUnit.test("config_update", function (assert) {
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

    const filename = "cockpit_config_read";
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
                            .then(() => dataWasChanged.then(done));
                });
            });
});

window.setTimeout(function() {
    QUnit.start();
});
