define(["exports",
        "jquery",
        "base1/cockpit",
        "ostree/ember",
        "ostree/notifications",
], function (exports, $, cockpit, Ember, notifications) {
 "use strict";

    var _ = cockpit.gettext;

    var month_names = [ _('Jan'), _('Feb'), _('Mar'),
                        _('Apr'), _('May'), _('Jun'),
                        _('Jul'), _('Aug'), _('Sep'),
                        _('Oct'), _('Nov'), _('Dec')];
    var DIFF_NAMES = ["add", "remove", "update", "roll back"];

    var DEST = 'org.projectatomic.rpmostree1';
    var PATH = '/org/projectatomic/rpmostree1';

    var DEPLOYMENT = 'org.projectatomic.rpmostree1.Deployment';
    var DEPLOYMENTS_PATH = '/org/projectatomic/rpmostree1/Deployments';

    var REFSPEC = 'org.projectatomic.rpmostree1.RefSpec';
    var REFSPECS_PATH = '/org/projectatomic/rpmostree1/RefSpecs';

    var MANAGER = 'org.projectatomic.rpmostree1.Manager';
    var MANAGER_PATH = '/org/projectatomic/rpmostree1/Manager';

    function RPMOSTreeDbusClient() {
        var self = this;

        self.deployments = null;
        self.refspecs = null;
        self.connection_error = null;

        var client = null;
        var waits = null;

        function fire_when_ready() {
            if (self.deployments !== null && self.refspecs !== null)
                waits.fire();
        }

        function tear_down(ex) {
            client = null;
            self.connection_error = ex;
            $(self.deployments).off();
            $(self.refspecs).off();
        }

        function closing (event, ex) {
            tear_down(ex);
        }

        self.wait = function(func) {
            waits.add(func);
        };

        self.get_client = function () {
            if (!client) {
                self.deployments = null;
                self.refspecs = null;
                self.connection_error = null;

                waits = $.Callbacks("once memory");
                client = cockpit.dbus(DEST, {"superuser" : true});

                // Watch and closing because watch
                // currently fires first
                client.watch(PATH).fail(tear_down);
                $(client).on("close", closing);

                var deployments = client.proxies(DEPLOYMENT, DEPLOYMENTS_PATH);
                deployments.wait(function () {
                    self.deployments = deployments;
                    fire_when_ready();
                });

                var refspecs = client.proxies(REFSPEC, REFSPECS_PATH);
                refspecs.wait(function () {
                    self.refspecs = refspecs;
                    fire_when_ready();
                });
            }
            return client;
        };
    }

    var rpmostree_client = new RPMOSTreeDbusClient();

    /**
    A Mixin meant to be used with reopenClass
    on classes that mixin ProxyModel.
    Defines createAsPromise that allows
    model instantiation asynchronously.

    Returns a promise that will resolve
    with a proxy for the given
    interface and path.
    **/
    var ProxyModelClass = Ember.Mixin.create({
        createAsPromise: function(client, iface, path) {
            var self = this;
            return new Ember.RSVP.Promise(function (resolve, reject) {
                var proxy = client.proxy(iface, path);
                proxy.wait(function () {
                    var mod = self.create({'proxy': proxy});
                    resolve(mod);
                });
            });
        }
    });

    /**
    A Mixin meant to be used with a cockpit
    proxy. Changes on the proxy are set
    as attributes on the model.
    **/
    var n_created = 0;
    var ProxyModel = Ember.Mixin.create({
        proxy: null,
        listenID: null,
        nameMap: {},

        willDestroy: function () {
            var proxy = this.get('proxy');
            if (proxy) {
                $(proxy).off("." + this.get('listenID'));
            }
        },

        proxyDataPopulate: function (data) {
            var self = this;
            this.beginPropertyChanges();
            for (var prop in data) {
                var key = prop;
                if (prop in self.nameMap)
                    key = self.nameMap[prop];
                if (self.get(key) !== data[prop])
                    self.set(key, data[prop]);
            }
            this.endPropertyChanges();
        },

        lostChannel: function (data) {
        },

        proxyClean: function () {
            var self = this;
            var proxy = self.get('proxy');
            if (proxy) {
                $(proxy).off("." + this.get('listenID'));
            }
        }.observesBefore('proxy'),

        proxyMonitor: function () {
            var self = this;

            Ember.run.once(function () {
                n_created++;
                self.set('listenID', n_created);
                var proxy = self.get('proxy');

                if (proxy) {
                    $(proxy).on("changed." + self.get('listenID'), function (event, data) {
                        self.proxyDataPopulate (data);
                    });

                    $(proxy.client).on("close." + self.get('listenID'), function (event, data) {
                        self.lostChannel(data);
                    });

                    self.proxyDataPopulate (proxy.data);
                }
            });
        }.observes('proxy').on('init')
    });

    var TargetManager = Ember.Object.extend(ProxyModel, {

        deploymentLocations: {
            "DefaultDeployment": 'defaultTarget',
            "BootedDeployment": 'bootedTarget',
            "rollbackPath": "rollbackTarget",
        },

        bootedTarget: null,
        rollbackTarget: null,
        upgradeTarget: null,
        defaultTarget: null,

        upgradePath: null,
        rollbackPath: null,

        DefaultDeployment: null,
        BootedDeployment: null,
        UpdateRunning: null,

        channelDied: false,

        setupListeners: function () {
            /** Only bother to remove the rollback deployment
            target if it went away the others are set by
            the proxy and picked up by observers when they change.
            **/
            var self = this;
            var removed = "removed."+self.get('listenID');
            var owner = "owner."+self.get('listenID');
            $(rpmostree_client.deployments).on(removed, function(event, proxy) {
                if (self.get("rollbackTarget") == proxy.path)
                    self.setRollbackTarget();
            });

            $(rpmostree_client.get_client()).on("owner", function(event, proxy) {
                if (self.get("UpdateRunning"))
                    self.set("UpdateRunning", "");
            });
        },

        getValidTarget: function (targetName) {
            var self = this;
            return new Ember.RSVP.Promise(function(resolve,reject) {
                if (self.get("channelDied")) {
                    self.reconnectClient()
                            .then(function () {
                                resolve(self.get(targetName));
                            })
                            .catch(function (ex) {
                                reject(ex);
                            });
                } else {
                    resolve(self.get(targetName));
                }
            });
        },

        reconnectClient: function () {
            var self = this;
            return new Ember.RSVP.Promise(function(resolve,reject) {
                var client = rpmostree_client.get_client();
                var old_proxy = self.get('proxy');
                var proxy = client.proxy(old_proxy.iface, old_proxy.path);

                rpmostree_client.wait(function () {
                    if (rpmostree_client.connection_error) {
                        reject (rpmostree_client.connection_error);
                    } else {
                        // update all the proxies so updates are back on
                        self.beginPropertyChanges();
                        for (var prop in self.deploymentLocations) {
                            self.setDeploymentTarget(prop);
                        }
                        self.setUpgradeTarget();
                        self.endPropertyChanges();

                        // update manager proxy
                        self.set('proxy', proxy);
                        resolve();
                    }
                });
            });
        },

        lostChannel: function () {
            // try to get it back once
            // if we fail, mark it
            var self = this;
            Ember.run.once(function () {
                self.reconnectClient()
                    .then(function () {
                         self.set('channelDied', false);
                    })
                    .catch(function () {
                        self.set('channelDied', true);
                    });
            });
        },

        setTargetAttr: function (attr, obj) {
            if (obj) {
                var model = this.get(attr);
                if (model) {
                    for (var key in obj) {
                        model.set(key, obj[key]);
                    }
                } else {
                    model = Target.create(obj);
                    this.set(attr, model);
                }
            } else {
                this.set(attr, null);
            }
        },

        setDeploymentTarget: function (pathAttr) {
            var path = this.get(pathAttr);
            var obj = null;
            if (path) {
                var proxy = rpmostree_client.deployments[path];
                if (proxy) {
                    obj = {'proxy': proxy};
                }
            }
            this.setTargetAttr(this.deploymentLocations[pathAttr], obj);
        },

        reloadRollback: function () {
            var self = this;
            Ember.run.once(function () {
                self.setDeploymentTarget("rollbackPath");
            });
        }.observes('rollbackPath'),

        reloadDefault: function () {
            var self = this;
            Ember.run.once(function () {
                self.setDeploymentTarget('DefaultDeployment');
            });
        }.observes('DefaultDeployment'),

        reloadBooted: function () {
            var self = this;
            Ember.run.once(function () {
                self.setDeploymentTarget('BootedDeployment');
            });
        }.observes('BootedDeployment'),

        setUpgradeTarget: function () {
            var obj = null;
            var path = this.get('upgradePath');
            if (path) {
                var proxy = rpmostree_client.refspecs[path];
                if (proxy) {
                    obj = {'proxy': proxy,
                           'OSName': this.get('bootedTarget.OSName')};
                }
            }
            this.setTargetAttr('upgradeTarget', obj);
        },

        reloadUpgrade: function () {
            Ember.run.once(this, "setUpgradeTarget");
        }.observes('upgradePath'),

        getUpgradePath: function () {
            var self = this;
            var proxy = self.get('proxy');
            var os = self.get('bootedTarget.OSName');
            self.set('upgradePath', null);

            function rejected(ex) {
                notifications.Manager.push({
                        type: 'danger',
                        msg: cockpit.format(_("Error finding upgrade target: $0"),
                                            cockpit.message(ex))
                });
            }

            proxy.call("GetUpgradeRefSpec",
                       [{ "os": cockpit.variant("s", os)}],
                       {"type" : "a{sv}"})
                .done(function (result) {
                    self.set('upgradePath', result[0]);
                })
                .fail(function (ex) {
                    rejected(ex);
                });
        },

        setUpgradePath: function () {
            Ember.run.once(this, "getUpgradePath");
        }.observes('bootedTarget.Checksum'),

        getRollbackPath: function () {
            var self = this;

            var proxy = self.get('proxy');
            var os = self.get('defaultTarget.OSName');
            self.set('rollbackPath', null);

            function rejected(ex) {
                notifications.Manager.push({
                        type: 'danger',
                        msg: cockpit.format(_("Error finding rollback target $0"),
                                            cockpit.message(ex))
                });
            }

            proxy.call("GetDeployments",
                       [{ "os": cockpit.variant("s", os)}],
                       {"type" : "a{sv}"})
                .done(function (result) {
                        if (!result)
                            return;

                        result = result[0];
                        if (result.length > 1) {
                            var booted = self.get('BootedDeployment');
                            var rollback = result[1];
                            if (booted != result[0]) {
                                // booted is not currently booted
                                // rollback to it.
                                rollback = booted;
                            }
                            self.set('rollbackPath', rollback);
                        }
                })
                .fail(function (ex) {
                    rejected(ex);
                });
        },

        setRollbackTarget: function () {
            Ember.run.once(this, "getRollbackPath");
        }.observes('defaultTarget.Checksum'),
    });

    TargetManager.reopenClass(ProxyModelClass, {
        createPromise : function (defaults) {
            var self = this;
            return new Ember.RSVP.Promise(function(resolve,reject) {
                    self.createAsPromise(rpmostree_client.get_client(), MANAGER, MANAGER_PATH).
                        then(function(model) {
                            rpmostree_client.wait(function () {
                                    if (!rpmostree_client.connection_error) {
                                        model.setupListeners();
                                        resolve(model);
                                    } else {
                                        reject(rpmostree_client.connection_error);
                                    }
                            });
                        }).catch(function (ex) {
                            reject(ex);
                        });
            });
        }
    });
    exports.TargetManager = TargetManager;

    var Target = Ember.Object.extend(ProxyModel, {
        nameMap: {"Head": "Checksum"},
        progressMessage: "",

        getRpmDiff: function() {
            var proxy = this.get('proxy');
            return new Ember.RSVP.Promise(function(resolve, reject) {
                proxy.GetRpmDiff().
                    done(function (result) {
                        var diffs = [];
                        for (var i = 0; i < result.length; i++) {
                            var obj = {
                                name: result[i][0],
                                type: result[i][1],
                                prettyType: DIFF_NAMES[result[i][1]],
                            };

                            if (result[i][1] == 3 || result[i][1] == 1)
                                obj.version = result[i][2]["PreviousPackage"]["v"][1];
                            else
                                obj.version = result[i][2]["NewPackage"]["v"][1];

                            diffs.push(obj);
                        }
                        resolve(diffs);
                    }).
                    fail(function (ex) {
                        reject(cockpit.message(ex));
                    });
            });
        },

        callAndWaitForComplete: function(manager, method, method_args) {
            var self = this;
            var ran = false;
            var proxy = self.get('proxy');

            self.set("progressMessage", "");
            var signal_proxy = manager.get('proxy');

            var signal_name = "UpdateCompleted." + self.get('listenID');
            var owned_name = "owner." + self.get('listenID');
            var progress_name = "ProgressMessage." + self.get('listenID');

            return new Ember.RSVP.Promise(function(resolve, reject) {
                var finished = false;

                function cleanup() {
                    $(signal_proxy).off(signal_name);
                    $(proxy).off(progress_name);
                    $(proxy.client).off(owned_name);
                }

                $(signal_proxy).on(signal_name, function (data, result, message) {
                    cleanup();
                    if (ran) {
                        if (result) {
                            resolve(message);
                        } else {
                            reject(message);
                            self.set("progressMessage", "");
                        }
                    }
                });

                $(proxy).on(progress_name, function (event, msg) {
                    self.set("progressMessage", msg);
                });

                proxy.call(method, method_args).
                    done(function (result) {
                        ran = true;

                        // owner changed means the signal will never come
                        $(proxy.client).on(owned_name, function () {
                            if (!finished)
                                reject(_("The task was interrupted"));
                        });
                    }).
                    fail(function (ex) {
                        reject(cockpit.message(ex));
                        cleanup();
                    });
            });
        },

        releaseName: function() {
            var name = this.get('prettyDate');
            if (this.get('Version'))
                name = this.get('Version') + " " + name;
            return cockpit.format(_("OS Release $0"), name);
        }.property('Version', 'Timestamp'),

        prettyDate: function() {
            var t = this.get('Timestamp');
            var formated = "";
            if (t) {
                var d = new Date(t*1000);
                formated = _(month_names[d.getMonth()]) + "-" + d.getDate();
            }

            return formated;
        }.property('Timestamp'),
    });
    Target.reopenClass(ProxyModelClass, {});
    exports.Target = Target;

});
