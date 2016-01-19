/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

/* Try to load docker and if it's not available
 * return an empty module instead of an error
 */
require(['docker/docker'],
    function () {},
    function (err) {
        require.undef("docker/docker");
        define("docker/docker", [], function () {});
        require(['docker/docker'], function () {});
    }
);

define([
    "jquery",
    "base1/cockpit",
    "docker/docker",
    "kubernetes/client",
    "system/service",
    "kubernetes/config"
], function($, cockpit, docker, kubernetes, service, config) {
    "use strict";

    var nulecule = { };
    var _ = cockpit.gettext;
    var client = kubernetes.k8client();

    function debug(args) {
        if (window.debugging == "all" || window.debugging == "nulecule")
            console.debug.apply(console, arguments);

    }

    /**
     * NuleculeClient
     *
     */
    function NuleculeClient() {
        var self = this;
        self.answers = {};
        var MINIMUM_SUPPORTED_ATOMIC_VERSION = 1.1;
        var MINIMUM_SUPPORTED_ATOMICAPP_VERSION = "0.1.11";
        var install_dir = null;

        function create_tmp() {
            return cockpit.spawn(['mktemp', '-p', '/tmp', '-d', 'APP_ENTITY.XXXX']);
        }

        function delete_tmp() {
            var msgl = install_dir.split('/tmp/');
            var folder;
            if(msgl.length > 1) {
                folder = msgl[1];
            }
            debug("removing folder " + folder);
            var process = cockpit.spawn(["rm", "-fr", folder],{ err: "out", superuser: true , directory: '/tmp', pty: true });
            install_dir = null;

            return process.fail(function (ex) {
                console.warn("Error cleaning up nulecule temporary files: " + ex.message);
            });
        }

        function write_answer_file(data) {
            var dfd = $.Deferred();
            debug("writing to " + install_dir + "/answers.conf");
            var file = cockpit.file(install_dir + "/answers.conf");
            var req = file.replace(JSON.stringify(data))
                .done(function(){
                    dfd.resolve();
                    file.close();
                })
                .fail(function(ex){
                    console.warn(ex);
                    dfd.reject(ex);
                    file.close();
                });

            var promise = dfd.promise();
            promise.cancel = function cancel() {
                req.cancel();
                file.close();
            };

            return promise;
        }


        function get_version(data) {
            var atm_versions = {};
            var msgl;
            var datal = data.split("\n");
            for (var i = datal.length - 1; i >= 0; i--) {
                if(datal[i].indexOf("io.projectatomic.nulecule.atomicappversion:") > -1) {
                    msgl = datal[i].split('io.projectatomic.nulecule.atomicappversion:');
                    if(msgl.length > 1)
                        atm_versions.atomicappversion = msgl[1];
                } else if (datal[i].indexOf("io.projectatomic.nulecule.specversion:") > -1) {
                    msgl = datal[i].split('io.projectatomic.nulecule.specversion:');
                    if(msgl.length > 1)
                        atm_versions.specversion = msgl[1];
                } else if(datal[i].indexOf("io.projectatomic.nulecule.providers:") > -1) {
                    msgl = datal[i].split('io.projectatomic.nulecule.providers:');
                    if(msgl.length > 1)
                        atm_versions.providers = msgl[1];
                }
            }
            return atm_versions;
        }

        function check_nulecule_version(image) {
            var dfd = $.Deferred();
            var versions = {};
            debug("checking nulecule specversion");
            var process = cockpit.spawn(["/usr/bin/atomic", "info", image], { superuser: true })
                .fail(function(ex) {
                    console.warn(ex.message);
                    dfd.reject(new Error(_("The image is not a correctly labeled Nulecule image.")));
                })
                .done(function(data) {
                    versions = get_version(data);
                    debug(versions);
                    if (Object.keys(versions).length == 3) {
                        dfd.resolve(versions);
                    } else {
                        if (!versions.providers)
                           console.warn("This image does not contain io.projectatomic.nulecule.providers .");
                        else if (!versions.specversion)
                            console.warn("This image does not contain io.projectatomic.nulecule.specversion.");
                        else if (!versions.atomicappversion)
                            console.warn("This image does not contain io.projectatomic.nulecule.atomicappversion.");
                        dfd.reject(new Error(_("This image is not a supported Nulecule image")));
                    }
                })
                .always(function(){
                    process.close();
                });

            var promise = dfd.promise();
            promise.cancel = function cancel() {
                process.close();
            };

            return promise;
        }

        function check_atomic_version() {
            var dfd = $.Deferred();
            debug("checking atomic version");
            var process = cockpit.spawn(["/usr/bin/atomic", "--version"],{ err: "out", superuser: true , pty: true })
                .fail(function(ex) {
                    console.warn(ex.message);
                    var message = _("The 'atomic' command is not installed on the system.");
                    var err = new Error(message);
                    dfd.reject(err);
                })
                .done(function(data) {
                    var atomic_version = parseFloat(data);
                    debug("atomic version is " + atomic_version);
                    if (parseFloat(data) >= MINIMUM_SUPPORTED_ATOMIC_VERSION) {
                        dfd.resolve(data);
                    } else {
                        var message = cockpit.format(_("The 'atomic' command version $0 is not supported."), atomic_version);
                        var err = new Error(message);
                        dfd.reject(err);
                    }
                })
                .always(function(){
                    process.close();
                });

            var promise = dfd.promise();
            promise.cancel = function cancel() {
                process.close();
            };

            return promise;
        }

        function ensure_image_exists(image) {
            var deferred = $.Deferred();
            var docker_service = service.proxy("docker");
            docker_service.start()
                .fail(function(ex) {
                    console.warn(ex);
                    var message = _("Unable to start docker");
                    var err = new Error(message);
                    deferred.reject(err);
                })
                .done(function(data) {
                    docker.inspect_image(image)
                        .done(function(data) {
                            deferred.resolve();
                        })
                        .fail(function(ex) {
                            var tag = "latest";
                            var tagl = image.split(":");
                            if(tagl.length > 1)
                                tag = tag[1];

                            docker.pull(image, tag)
                                .progress(function(msg) {
                                    deferred.notify(msg);
                                })
                                .done(function(d) {
                                    deferred.resolve();
                                })
                                .fail(function(ex) {
                                    deferred.reject(new Error(_("Unable to pull Nulecule app image.")));
                                });
                        });
                });
            return deferred.promise();
        }

        function is_flavor_present(providers, flavor) {
            if (providers && providers.indexOf(flavor) >= 0) {
                return true;
            }
            return false;
        }

        function format_provider_list(providers) {
            var providersl = providers.split(",");
            var newproviders = [];
            for (var i = providersl.length - 1; i >= 0; i--) {
                newproviders.push(providersl[i].trim());
            }
            return newproviders;
        }

        function check_flavor_supported(versions) {
            var providersl = format_provider_list(versions.providers);
            var supported = false;
            if (client.flavor === "openshift" || client.flavor === "kubernetes") {
                supported = is_flavor_present(providersl, client.flavor);
            } else {
                supported = false;
            }
            return supported;
        }

        function check_versions(image) {
            var deferred = $.Deferred();
            check_atomic_version()
                .done(function() {
                    ensure_image_exists(image)
                        .progress(function(msg) {
                            deferred.notify(msg);
                        })
                        .done(function() {
                            check_nulecule_version(image)
                                .done(function(version_info) {
                                    if (check_flavor_supported(version_info)) {
                                        deferred.resolve(version_info);
                                    } else {
                                        deferred.reject(new Error(_("No supported providers found.")));
                                    }
                                })
                                .fail(function(err) {
                                    deferred.reject(err);
                                });
                        })
                        .fail(function(err) {
                            deferred.reject(err);
                        });
                })
                .fail(function(err) {
                    deferred.reject(err);
                });
            var promise = deferred.promise();
            return promise;
        }

        function installrun(ptype, image) {
            var deferred = $.Deferred();
            var promise;
            var process;

            if (!install_dir) {
                deferred.reject();
                return deferred.promise();
            }

            if(ptype === "install") {
                //atomic install --opt2=--answers-format=json <IMAGE> command
                //internally calls...
                //atomicapp --answers-format=json install <IMAGE>
                process = cockpit.spawn(["/usr/bin/atomic", "install", "--opt2=--answers-format=json", image],{ err: "out", superuser: true , directory: install_dir, pty: true });
                debug("Installing image: " + image + " in folder " + install_dir);
                deferred.notify(_("Installing ..."));
            } else {
                //atomic run --opt2=--answers="/tmp/answers.conf" <IMAGE>
                //internally calls...
                //atomicapp --answers=/tmp/answers.conf run <IMAGE>
                process = cockpit.spawn(["/usr/bin/atomic", "run", "--opt2=--answers=/atomicapp/answers.conf", image],{ err: "out", superuser: true , directory: install_dir , pty: true});
                debug("Running image: " + image + " in folder " + install_dir);
                deferred.notify(_("Running ..."));
            }

            function get_message(text, key) {
                var final_msg = null;
                var msgg = null;
                var msgl = text.split(key);
                if (msgl.length > 1) {
                    final_msg = msgl[1];
                    msgg = final_msg.split("\n");
                    if (msgg.length > 1) {
                        final_msg = msgg[0];
                    }
                }
                return final_msg;
            }

            process.always(function() {
                    process.close();
                })
                .stream(function(text) {
                    text = String(text);
                    debug("buffer="+text);
                    var msgl;
                    if(text.indexOf("atomicapp.status.info.message") > -1) {
                        msgl = get_message(text, "atomicapp.status.info.message=");
                        if (msgl)
                            deferred.notify(msgl);
                    } else if(text.indexOf("atomicapp.status.error.message") > -1) {
                        msgl = get_message(text, "atomicapp.status.error.message=");
                        if (msgl) {
                            deferred.reject(new Error(msgl));
                        }
                    } else if(text.indexOf("error") > -1) {
                        //In some cases atomicapp just exits normally with error message
                        console.warn(text);
                    }
                })
                .done(function(output) {

                    deferred.resolve();
                })
                .fail(function(ex) {

                    if (ex.problem === "cancelled") {
                        deferred.reject(ex);
                        return;
                    }

                    var message = _("Image failed to " + ptype);
                    console.warn(ex.message);
                    var err = new Error(message);
                    deferred.reject(err);

                });

            promise = deferred.promise();
            promise.cancel = function cancel() {
                process.close("cancelled");
            };

            return promise;
        }

        self.close = function close() {
            if (install_dir)
                delete_tmp();
            return;
        };

        function fetch_answers_file() {
            var deferred = $.Deferred();
            deferred.notify(_("Reading answers file ..."));

            function read_file() {
                var d = $.Deferred();
                var file = cockpit.file(install_dir + "/answers.conf.sample");
                    file.read()
                        .done(function(content) {
                            if (content) {
                                var jdata = JSON.parse(content);
                                d.resolve(jdata);
                            } else {
                                d.reject(new Error(_("Unable to read answer.conf.sample file.")));
                            }
                        })
                        .fail(function(ex) {
                            console.warn(ex);
                            d.reject(ex);
                        })
                        .always(function(){
                            file.close();
                        });
                return d.promise();
            }

            if (client.config) {
                var cfile = cockpit.file(install_dir + "/config");
                cfile.replace(client.config)
                    .done(function(){
                        debug("Reading " + install_dir + "/answers.conf.sample");
                        read_file()
                            .done(function(jdata){
                                jdata.general.providerconfig = install_dir + "/config";
                                jdata.general.provider = client.flavor;
                                debug(jdata);
                                self.answers = jdata;
                                deferred.resolve(jdata);
                            })
                            .fail(function(error){
                                deferred.reject(error);
                            });
                    })
                    .fail(function (error) {
                        deferred.reject(error);
                    })
                    .always(function(){
                        cfile.close();
                    });
            } else {
                debug("Reading " + install_dir + "/answers.conf.sample");
                read_file(deferred)
                    .done(function(jdata){
                        jdata.general.provider = client.flavor;
                        debug(jdata);
                        self.answers = jdata;
                        deferred.resolve(jdata);
                    })
                    .fail(function(error){
                        deferred.reject(error);
                    });
            }
            return deferred.promise();
        }

        self.install = function install(image) {
            var deferred = $.Deferred();
            var promise = null;
            var create;
            var runner;

            if (install_dir)
                delete_tmp();

            check_versions(image)
                .progress(function(msg){
                    deferred.notify(msg);
                })
                .done(function(version_info) {
                    var atomicapp_version = version_info.atomicappversion.trim();
                    var validver = config.version_compare(atomicapp_version, MINIMUM_SUPPORTED_ATOMICAPP_VERSION);
                    if (validver >= 0) {
                        create = create_tmp()
                            .done(function(dir){
                                install_dir = dir.trim();
                                debug("created directory :"+ install_dir);
                                runner = installrun("install", image)
                                    .progress(function(msg) {
                                        deferred.notify(msg);
                                    })
                                    .done(function() {
                                        fetch_answers_file()
                                            .done(function(ans) {
                                                deferred.resolve(ans);
                                            })
                                            .fail(function(ex) {
                                                console.warn(ex);
                                                deferred.reject(ex);
                                            })
                                            .progress(function(msg) {
                                                deferred.notify(msg);
                                            });
                                    })
                                    .fail(function(ex){
                                        var message = _("Image failed to install.");
                                        console.warn(ex.message);
                                        var err = new Error(message);
                                        deferred.reject(err);
                                    });
                            })
                            .fail(function(ex){
                                var message = _("Temporary folder was not created");
                                console.warn(ex.message);
                                var err = new Error(message);
                                deferred.reject(err);
                            });

                    } else {
                        var message = cockpit.format(_("atomicapp version $0 is not supported."), atomicapp_version);
                        console.warn(message);
                        console.warn(cockpit.format(_("Only atomicapp version gretater than $0 is supported."), MINIMUM_SUPPORTED_ATOMICAPP_VERSION));
                        var err = new Error(message);
                        deferred.reject(err);
                    }
                })
                .fail(function(err){
                    deferred.reject(err);
                });

            promise = deferred.promise();
            promise.cancel = function cancel() {
                if (runner)
                    runner.cancel();
                if (create)
                    create.cancel();
            };

            return promise;
        };

        self.run = function run(image) {
            var deferred = $.Deferred();
            var promise = null;
            var writer;
            var runner;

            writer = write_answer_file(self.answers)
                .progress(function(msg) {
                    deferred.notify (msg);
                })
                .done(function(){
                    runner = installrun("run", image)
                        .progress(function(msg) {
                            deferred.notify (msg);
                        })
                        .done(function(){
                            deferred.resolve();
                        })
                        .fail(function(ex){
                            var message = _("Image failed to run.");
                            console.warn(ex.message);
                            var err = new Error(message);
                            deferred.reject(err);
                        });
                })
                .fail(function(ex) {
                    deferred.reject(ex);
                });

            promise = deferred.promise();
            promise.cancel = function cancel() {
                if (runner)
                    runner.cancel();
                if (writer)
                    writer.cancel();
            };

            return promise;
        };
    }

    nulecule.nuleculeclient =  function client() {
        return new NuleculeClient();
    };

    nulecule.check_requirements =  function () {
        if (docker) {
            return cockpit.spawn(["ls", "/usr/bin/atomic"]);
        } else {
            var deferred = $.Deferred();
            deferred.reject("No docker");
            return deferred;
        }
    };

    return nulecule;
});
