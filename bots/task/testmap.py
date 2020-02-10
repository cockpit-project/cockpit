# This file is part of Cockpit.
#
# Copyright (C) 2019 Red Hat, Inc.
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

REPO_BRANCH_CONTEXT = {
    'cockpit-project/cockpit': {
        'master': ['fedora-30/container-bastion',
            'fedora-30/selenium-firefox', 'fedora-30/selenium-chrome', 'fedora-30/selenium-edge',
            'debian-stable', 'debian-testing',
            'ubuntu-1804', 'ubuntu-stable',
            'fedora-30', 'fedora-atomic',
            'rhel-8-0-distropkg', 'rhel-8-1',
        ],
        'rhel-7.7': ['fedora-30/container-kubernetes',
            'fedora-30/container-bastion', 'fedora-30/selenium-firefox', 'fedora-30/selenium-chrome', 'rhel-7-7',
        ],
        'rhel-8.0': ['fedora-30/container-bastion',
            'fedora-30/selenium-firefox', 'fedora-30/selenium-chrome',
            'rhel-8-0',
        ],
        'rhel-8-appstream': ['fedora-30/container-bastion',
            'fedora-30/selenium-firefox', 'fedora-30/selenium-chrome', 'rhel-8-0-distropkg', 'rhel-8-1',
        ],
        'rhel-8.1': ['fedora-30/container-bastion',
            'fedora-30/selenium-firefox', 'fedora-30/selenium-chrome', 'rhel-8-1',
        ],
        # These can be triggered manually with bots/tests-trigger
        '_manual': ['fedora-i386', 'fedora-testing',
        ],
    },
    'cockpit-project/starter-kit': {
        'master': [
            'centos-7',
            'fedora-30',
        ],
    },
    'cockpit-project/cockpit-ostree': {
        'master': [
            'fedora-atomic',
            'continuous-atomic',
            'rhel-atomic',
        ],
    },
    'cockpit-project/cockpit-podman': {
        'master': [
            'fedora-29',
            'fedora-30',
            'rhel-8-1',
        ],
    },
    'weldr/lorax': {
        'master': [
            'fedora-30',
            'fedora-30/live-iso',
            'fedora-30/qcow2',
            'fedora-30/aws',
            'fedora-30/openstack',
            'fedora-30/vmware',
        ],
        '_manual': [
            'fedora-30/azure',

            'rhel-8-1',
            'rhel-8-1/live-iso',
            'rhel-8-1/qcow2',
            'rhel-8-1/aws',
            'rhel-8-1/azure',
            'rhel-8-1/openstack',
            'rhel-8-1/vmware',
        ],
        'rhel7-extras': [
            'rhel-7-7',
            'rhel-7-7/live-iso',
            'rhel-7-7/qcow2',
            'rhel-7-7/aws',
            'rhel-7-7/azure',
            'rhel-7-7/openstack',
            'rhel-7-7/vmware',
        ],
    },
    'weldr/cockpit-composer': {
        'master': [
            'fedora-30/chrome',
            'fedora-30/firefox',
            'fedora-30/edge',
            'rhel-7-7/firefox',
            'rhel-8-1/chrome',
        ],
        'rhel-8.0': ['rhel-8-0/chrome', 'rhel-8-0/firefox', 'rhel-8-0/edge'
        ],
        'rhel-8.1': ['rhel-8-1/chrome', 'rhel-8-1/firefox', 'rhel-8-1/edge'
        ],
    },
    'mvollmer/subscription-manager': {
        'master': [
            'rhel-8-0',
        ],
    }
}

def projects():
    """Return all projects for which we run tests."""
    return REPO_BRANCH_CONTEXT.keys()

def tests_for_project(project):
    """Return branch -> contexts map."""
    return REPO_BRANCH_CONTEXT.get(project, {})
