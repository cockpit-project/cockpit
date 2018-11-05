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

var QUnit = require("qunit-tests");
var cockpit = require("cockpit");
var assert = QUnit;

var kdump = require("./config-client.es6");

var basicConfig = [
    "# top comment",
    "",
    "foo bar",
    " indented value",
    "",
    "will disappear",
    "key value #comment"
].join("\n");

var changedConfig = [
    "# top comment",
    "",
    "foo moo",
    "indented value",
    "",
    "#key value #comment",
    "hooray value",
    ""
].join("\n");

QUnit.asyncTest("config_update", function() {
    assert.expect(10);
    var dataWasChanged = cockpit.defer();
    var config;
    var configChanged = function(event, settings) {
        assert.equal(settings["foo"].value, "moo", "value changed correctly");
        assert.equal("key" in settings, false, "setting with comment deleted correctly");
        assert.equal("will" in settings, false, "setting without comment deleted correctly");
        assert.equal(settings["hooray"].value, "value", "value added correctly");
        assert.equal(config._rawContent, changedConfig, "raw text for changed config is correct");
        dataWasChanged.resolve();
    };

    var filename = "cockpit_config_read";
    var configFile = cockpit.file(filename);
    configFile
        .replace(basicConfig)
        .always(function() {
            assert.equal(this.state(), "resolved", "writing initial config didn't fail");
            assert.equal(configFile.path, filename, "file has correct path");
            config = new kdump.ConfigFile(filename);
            config.wait().always(function() {
                assert.equal(this.state(), "resolved", "waiting for config didn't fail");
                config.settings["foo"].value = "moo";
                delete config.settings["key"];
                delete config.settings["will"];
                config.settings["hooray"] = { value: "value" };
                config.addEventListener('kdumpConfigChanged', configChanged);
                config.write(config.settings)
                    .always(function() {
                        assert.equal(this.state(), "resolved", "writing to config didn't fail");
                        dataWasChanged.promise().done(function() {
                            assert.equal(this.state(), "resolved", "waiting for config change didn't fail");
                            QUnit.start();
                        });
                    });
            });
        });
});

window.setTimeout(function() {
    QUnit.start();
});
