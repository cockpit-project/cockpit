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

var angular = require("angular");
var QUnit = require("qunit-tests");

require("./projects");

function suite(fixtures) {
    "use strict";

    /* Filled in with a function */
    var inject;
    var assert = QUnit;

    var module = angular.module("registry.projects.tests", [
        "kubeClient",
        "registry.projects",
    ]);

    function projectsTest(name, count, fixtures, func) {
        QUnit.asyncTest(name, function() {
            assert.expect(count);

            inject([
                "kubeLoader",
                "kubeSelect",
                "projectPolicy",
                function(loader, select, pol, data) {
                    loader.reset(true);
                    if (fixtures)
                        loader.handle(fixtures);

                    var interval = window.setInterval(function () {
                        if (select().kind("RoleBinding").length == 6) {
                            window.clearInterval(interval);
                            inject(func);
                        }
                    }, 10);
                }
            ]);
        });
    }

    projectsTest("format Users", 4, fixtures, [
        "projectData",
        'kubeSelect',
        function(projectUtil, select) {
            var user = select().kind("User").name("amanda");
            assert.equal(user.length, 1, "number of users");
            assert.equal(projectUtil.formatMembers(user.one().groups, 'Groups'),
                         "finance,", "number of groups");
            user = select().kind("User").name("jay");
            assert.equal(projectUtil.formatMembers(user.one().groups, 'Groups'),
                         "4 Groups", "number of groups");
            var group = select().kind("Group").name("finance");
            assert.equal(projectUtil.formatMembers(user.one().groups, 'Users'),
                         "4 Users", "number of users");
            QUnit.start();
        }
    ]);

    projectsTest("policy checks", 11, fixtures, [
        "projectData",
        'kubeSelect',
        function(projectUtil, select) {
            var user = select().kind("User").name("amanda");
            var policybinding = select().kind("PolicyBinding").namespace("financeprj").name(":default");
            assert.equal(user.length, 1, "number of users");
            assert.equal(policybinding.length, 1, "number of policybinding");
            var rolesArray = projectUtil.getAllRoles("", "");
            assert.equal(rolesArray.length, 0, "no values passed 1 ");
            rolesArray = projectUtil.getAllRoles();
            assert.equal(rolesArray.length, 0, "no values passed 2");
            rolesArray = projectUtil.getAllRoles(user.one(), "financeprj");
            assert.equal(rolesArray.length, 3, "values passed");

            var regRolesArray = projectUtil.getRegistryRoles(user.one(), "financeprj");
            assert.equal(regRolesArray[0], "Admin", "getRegistryRoles displayRole values");
            regRolesArray = projectUtil.getRegistryRoles("", "");
            assert.equal(regRolesArray.length, 0, "no values passed 3 ");
            regRolesArray = projectUtil.getRegistryRoles();
            assert.equal(regRolesArray.length, 0, "no values passed 4");

            assert.equal(projectUtil.isRegistryRole(user.one(), "Admin", "financeprj"), true, "check if Admin registry role");
            assert.equal(projectUtil.isRegistryRole("system:unauthenticated", "Pull", "financeprj"), true, "check if Pull registry role");
            assert.equal(projectUtil.isRoles(user.one(), "financeprj"), true, "check if any role exist");
            QUnit.start();
        }
    ]);

    angular.module('exceptionOverride', []).factory('$exceptionHandler', function() {
        return function(exception, cause) {
            exception.message += ' (caused by "' + cause + '")';
            throw exception;
        };
    });

    module.run([
        '$injector',
        function($injector) {
            inject = function inject(func) {
                return $injector.invoke(func);
            };
            QUnit.start();
        }
    ]);

    angular.bootstrap(document, ['registry.projects.tests']);
}

/* Invoke the test suite with this data */
suite([
    {
        "kind": "User",
        "apiVersion": "v1",
        "metadata": {
            "name": "amanda",
            "selfLink": "/oapi/v1/users/amanda",
            "uid": "8d10b355-b9d4-11e5-b7ad-5254009e00f1",
            "resourceVersion": "1114",
            "creationTimestamp": "2016-01-13T09:03:45Z"
        },
        "identities": [
            "anypassword:abc123"
        ],
        "groups": [
            "finance"
        ]
    },
    {
        "kind": "User",
        "apiVersion": "v1",
        "metadata": {
            "name": "jay",
            "selfLink": "/oapi/v1/users/jay",
            "uid": "8d10b355-b9d4-11e5-b7ad-5254009e00f1",
            "resourceVersion": "1114",
            "creationTimestamp": "2016-01-13T09:03:45Z"
        },
        "identities": [
            "anypassword:abc123"
        ],
        "groups": [
            "finance","admin","hr","dev"
        ]
    },
    {
        "kind": "Group",
        "apiVersion": "v1",
        "metadata": {
            "name": "finance",
            "selfLink": "/oapi/v1/groups/finance",
            "uid": "bff4578c-b9d4-11e5-b7ad-5254009e00f1",
            "resourceVersion": "1124",
            "creationTimestamp": "2016-01-13T09:05:10Z"
        },
        "users": [
            "tom",
            "jay",
            "amanda",
            "myadmin"
        ]
    },
    {
      "kind": "PolicyBinding",
      "apiVersion": "v1",
      "metadata": {
        "name": ":default",
        "namespace": "financeprj",
        "selfLink": "/oapi/v1/namespaces/financeprj/policybindings/:default",
        "uid": "d5a78dfc-e9e4-11e5-a1bd-3c970eb867f7",
        "resourceVersion": "53908",
        "creationTimestamp": "2016-03-14T13:01:15Z"
      },
      "lastModified": "2016-03-24T07:19:42Z",
      "policyRef": {
        "name": "default"
      },
      "roleBindings": [
        {
          "name": "admin",
          "roleBinding": {
            "metadata": {
              "name": "admin",
              "namespace": "financeprj",
              "uid": "f33cbdd7-ea0e-11e5-ba57-3c970eb867f7",
              "resourceVersion": "24003",
              "creationTimestamp": "2016-03-14T18:02:43Z"
            },
            "userNames": null,
            "groupNames": null,
            "subjects": [

            ],
            "roleRef": {
              "name": "admin"
            }
          }
        },
        {
          "name": "edit",
          "roleBinding": {
            "metadata": {
              "name": "edit",
              "namespace": "financeprj",
              "selfLink": "/oapi/v1/namespaces/financeprj/rolebindings/edit",
              "uid": "d5a340e0-e9e4-11e5-a1bd-3c970eb867f7",
              "resourceVersion": "24002",
              "creationTimestamp": "2016-03-14T13:01:15Z"
            },
            "userNames": [
              "amanda"
            ],
            "groupNames": null,
            "subjects": [
              {
                "kind": "User",
                "name": "amanda"
              }
            ],
            "roleRef": {
              "name": "edit"
            }
          }
        },
        {
          "name": "registry-admin",
          "roleBinding": {
            "metadata": {
              "name": "registry-admin",
              "namespace": "financeprj",
              "uid": "c0746786-f0fd-11e5-b5cb-3c970eb867f7",
              "resourceVersion": "24005",
              "creationTimestamp": "2016-03-23T13:47:15Z"
            },
            "userNames": [
              "amanda"
            ],
            "groupNames": null,
            "subjects": [
              {
                "kind": "User",
                "name": "amanda"
              }
            ],
            "roleRef": {
              "name": "registry-admin"
            }
          }
        },
        {
          "name": "registry-editor",
          "roleBinding": {
            "metadata": {
              "name": "registry-editor",
              "namespace": "financeprj",
              "selfLink": "/oapi/v1/namespaces/financeprj/rolebindings/registry-editor",
              "uid": "c613716d-f0fd-11e5-b5cb-3c970eb867f7",
              "resourceVersion": "24339",
              "creationTimestamp": "2016-03-23T13:47:24Z"
            },
            "userNames": [
              "sunny",
              "sam",
              "janet"
            ],
            "groupNames": null,
            "subjects": [
              {
                "kind": "User",
                "name": "sunny"
              },
              {
                "kind": "User",
                "name": "sam"
              },
              {
                "kind": "User",
                "name": "janet"
              }
            ],
            "roleRef": {
              "name": "registry-editor"
            }
          }
        },
        {
          "name": "registry-viewer",
          "roleBinding": {
            "metadata": {
              "name": "registry-viewer",
              "namespace": "financeprj",
              "uid": "de6e0980-f0fd-11e5-b5cb-3c970eb867f7",
              "resourceVersion": "24264",
              "creationTimestamp": "2016-03-23T13:48:05Z"
            },
            "userNames": [
              "janet",
              "sunny"
            ],
            "groupNames": null,
            "subjects": [
              {
                "kind": "User",
                "name": "janet"
              },
              {
                "kind": "User",
                "name": "sunny"
              },
              {
                "kind": "SystemGroup",
                "name": "system:unauthenticated"
              }
            ],
            "roleRef": {
              "name": "registry-viewer"
            }
          }
        },
        {
          "name": "view",
          "roleBinding": {
            "metadata": {
              "name": "view",
              "namespace": "financeprj",
              "uid": "07e34b4c-ea0f-11e5-ba57-3c970eb867f7",
              "resourceVersion": "23860",
              "creationTimestamp": "2016-03-14T18:03:18Z"
            },
            "userNames": null,
            "groupNames": null,
            "subjects": [

            ],
            "roleRef": {
              "name": "view"
            }
          }
        }
      ]
    },
    {
      "kind": "RoleBinding",
      "apiVersion": "v1",
      "metadata": {
        "name": "registry-admin",
        "namespace": "financeprj",
        "selfLink": "/oapi/v1/namespaces/financeprj/rolebindings/registry-admin",
        "uid": "c0746786-f0fd-11e5-b5cb-3c970eb867f7",
        "resourceVersion": "24005",
        "creationTimestamp": "2016-03-23T13:47:15Z"
      },
      "userNames": [
        "amanda"
      ],
      "groupNames": null,
      "subjects": [
        {
          "kind": "User",
          "name": "amanda"
        }
      ],
      "roleRef": {
        "name": "registry-admin"
      }
    },
    {
      "kind": "RoleBinding",
      "apiVersion": "v1",
      "metadata": {
        "name": "admin",
        "namespace": "financeprj",
        "selfLink": "/oapi/v1/namespaces/financeprj/rolebindings/admin",
        "uid": "c0746786-f0fd-11e5-b5cb-3c970eb867f7",
        "resourceVersion": "24005",
        "creationTimestamp": "2016-03-23T13:47:15Z"
      },
      "userNames": [
        "amanda"
      ],
      "groupNames": null,
      "subjects": [
        {
          "kind": "User",
          "name": "amanda"
        }
      ],
      "roleRef": {
        "name": "admin"
      }
    }
]);
