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

'use strict';

var React = require('react');
var createReactClass = require('create-react-class');

var cockpit = require('cockpit');
var _ = cockpit.gettext;

var $ = require("jquery");
var docker = require('./docker');
var atomic = require('./atomic');
var util = require('./util');
var searchImage = require("./search");

var Listing = require('cockpit-components-listing.jsx');
var Select = require('cockpit-components-select.jsx');
var moment = require('moment');

moment.locale(cockpit.language);

var Dropdown = createReactClass({
    getDefaultProps: function () {
        return {
            actions: [ { label: '' } ]
        };
    },

    handleClick: function (event) {
        if (event.button !== 0)
            return;

        var action = this.props.actions[event.currentTarget.getAttribute('data-value')];
        if (!action.disabled && action.onActivate)
            action.onActivate();
    },

    render: function () {
        return (
            <div className="btn-group">
                <button className="btn btn-default" type="button" data-value="0" onClick={this.handleClick}>
                    <span>{ this.props.actions[0].label }</span>
                </button>
                <button className="btn btn-default dropdown-toggle" data-toggle="dropdown">
                    <div className="caret" />
                </button>
                <ul className="dropdown-menu dropdown-menu-right" role="menu">
                    {
                        this.props.actions.map(function (action, index) {
                            return (
                                <li className={ action.disabled ? 'disabled' : '' }>
                                    <a data-value={index} role="link" tabIndex="0" onClick={this.handleClick}>{action.label}</a>
                                </li>
                            );
                        }.bind(this))
                    }
                </ul>
            </div>
        );
    }
});

var ContainerHeader = createReactClass({
    getInitialState: function () {
        return {
            filter: 'running',
            filterText: ''
        };
    },

    filterChanged: function () {
        if (this.props.onFilterChanged)
            this.props.onFilterChanged(this.state.filter, this.state.filterText);
    },

    handleFilterChange: function (value) {
        this.setState({ filter: value }, this.filterChanged);
    },

    handleFilterTextChange: function () {
        this.setState({ filterText: this.refs.filterTextInput.value }, this.filterChanged);
    },

    render: function () {
        return (
            <div>
                <Select.Select id="containers-containers-filter" initial={this.state.filter} onChange={this.handleFilterChange}>
                    <Select.SelectEntry data='all'>{_("Everything")}</Select.SelectEntry>
                    <Select.SelectEntry data='running'>{_("Images and running containers")}</Select.SelectEntry>
                </Select.Select>
                <input type="text"
                       id="containers-filter"
                       ref="filterTextInput"
                       className="form-control"
                       placeholder={_("Type to filter…")}
                       onChange={this.handleFilterTextChange} />
            </div>
        );
    }
});

var ContainerDetails = createReactClass({
    render: function () {
        var container = this.props.container;
        return (
            <div className='listing-ct-body'>
                <dl>
                    <dt>{_("Id")}      </dt> <dd>{ container.Id }</dd>
                    <dt>{_("Created")} </dt>
                    <dd>{ moment(container.Created).isValid() ? moment(container.Created).calendar() : container.Created }</dd>
                    <dt>{_("Image")}   </dt> <dd>{ container.Image }</dd>
                    <dt>{_("Command")}</dt> <dd>{ util.render_container_cmdline(container) }</dd>
                    <dt>{_("State")}   </dt> <dd>{ util.render_container_state(container.State) }</dd>
                </dl>
            </div>
        );
    }
});

var ContainerProblems = createReactClass({
    onItemClick: function (event) {
        cockpit.jump(event.currentTarget.dataset.url, cockpit.transport.host);
    },

    render: function () {
        var problem = this.props.problem;
        var problem_cursors = [];
        for (var i = 0; i < problem.length; i++) {
            problem_cursors.push(<a data-url={problem[i][0]} className='list-group-item' role="link" tabIndex="0" onClick={this.onItemClick}>
                <span className="pficon pficon-warning-triangle-o fa-lg" />
                {problem[i][1]}
            </a>);
        }

        return (
            <div className='list-group dialog-list-ct'>
                {problem_cursors}
            </div>
        );
    }
});

var ContainerList = createReactClass({
    getDefaultProps: function () {
        return {
            client: {},
            onlyShowRunning: true,
            filterText: ''
        };
    },

    getInitialState: function () {
        return {
            containers: [],
            problems: {}
        };
    },

    navigateToContainer: function (container) {
        cockpit.location.go([ container.Id ]);
    },

    startContainer: function (container) {
        this.props.client.start(container.Id).fail(util.show_unexpected_error);
    },

    stopContainer: function (container) {
        this.props.client.stop(container.Id).fail(util.show_unexpected_error);
    },

    restartContainer: function (container) {
        this.props.client.restart(container.Id).fail(util.show_unexpected_error);
    },

    deleteContainer: function (container, event) {
        if (event.button !== 0)
            return;

        util.confirm(cockpit.format(_("Please confirm deletion of $0"), docker.truncate_id(container.Id)),
                     _("Deleting a container will erase all data in it."),
                     _("Delete"))
                .done(function () {
                    util.docker_container_delete(this.props.client, container.Id,
                                                 function() { }, function () { });
                }.bind(this));
    },

    containersChanged: function () {
        var containers = Object.keys(this.props.client.containers).map(function (id) {
            return this.props.client.containers[id];
        }.bind(this));

        containers.sort(function (a, b) {
            return new Date(b.Created).getTime() - new Date(a.Created).getTime();
        });

        this.setState({ containers: containers });
    },

    setNewProblem: function (c_id, url, message) {
        /* New problem is always displayed, no matter if the same problem is
         * already shown. It is because user may be interested into dynamic
         * watching of the problems occurring. After refreshing the site, only
         * the latest occurrence is displayed.
         */
        var known_problems = this.state.problems;
        if (c_id in known_problems)
            known_problems[c_id].push([url, message]);
        else
            known_problems[c_id] = [[url, message]];
        this.setState({ problems: known_problems });
    },

    newProblemOccurred: function (event, problem_path) {
        util.find_container_log(this.problems_client, problem_path, this.setNewProblem);
    },

    componentDidMount: function () {
        var self = this;
        this.problems_client = cockpit.dbus('org.freedesktop.problems', { superuser: "try" });
        this.service = this.problems_client.proxy('org.freedesktop.Problems2', '/org/freedesktop/Problems2');
        this.problems = this.problems_client.proxies('org.freedesktop.Problems2.Entry', '/org/freedesktop/Problems2/Entry');
        this.problems.wait(function() {
            if (typeof self.service.GetSession !== "undefined") {
                self.service.GetSession()
                        .done(function(session_path) {
                            self.problems_client.call(session_path, "org.freedesktop.Problems2.Session", "Authorize", [{}]);
                        });
            }
        });

        $(this.props.client).on('container.containers', this.containersChanged);
        $(this.props.client).on('container.container-details', this.containersChanged);
        this.service.addEventListener("Crash", this.newProblemOccurred);

        util.find_all_problems(this.problems, this.problems_client, this.service, self.setNewProblem);
    },

    componentWillUnmount: function () {
        $(this.props.client).off('container.containers', this.containersChanged);
        $(this.props.client).off('container.container-details', this.containersChanged);
        this.service.removeEventListener("Crash", this.newProblemOccurred);
        this.problems_client.close();
    },

    render: function () {
        var filtered = this.state.containers.filter(function (container) {
            if (this.props.onlyShowRunning && !container.State.Running)
                return false;

            if (container.Name.toLowerCase().indexOf(this.props.filterText.toLowerCase()) < 0)
                return false;

            return true;
        }.bind(this));

        var rows = filtered.map(function (container) {
            var isRunning = !!container.State.Running;
            var hasProblem = false;
            var shortContID = container.Id.slice(0, 12);

            var state;
            if (this.props.client.waiting[container.Id]) {
                state = { element: <div className="spinner" />, tight: true };
            } else {
                state = util.render_container_status(container.State);
            }

            var image = container.Image;
            if (container.ImageID && image == container.ImageID)
                image = docker.truncate_id(image);

            if (shortContID in this.state.problems) {
                hasProblem = true;
                state = <div><span className="pficon pficon-warning-triangle-o" />{state}</div>;
            }

            var columns = [
                { name: container.Name.replace(/^\//, ''), header: true },
                image,
                util.render_container_cmdline(container),
                util.format_cpu_usage(container.CpuUsage),
                util.format_memory_and_limit(container.MemoryUsage, container.MemoryLimit),
                state,
            ];

            var startStopActions = [];
            if (isRunning)
                startStopActions.push({ label: _("Stop"), onActivate: this.stopContainer.bind(this, container) });
            else
                startStopActions.push({ label: _("Start"), onActivate: this.startContainer.bind(this, container) });

            startStopActions.push({
                label: _("Restart"),
                onActivate: this.restartContainer.bind(this, container),
                disabled: !isRunning
            });

            var actions = [
                <button className="btn btn-danger btn-delete pficon pficon-delete"
                        onClick={ this.deleteContainer.bind(this, container) } />,
                <button className="btn btn-default"
                        disabled={isRunning}
                        data-container-id={container.Id}
                        data-toggle="modal" data-target="#container-commit-dialog">
                    {_("Commit")}
                </button>,
                <Dropdown actions={startStopActions} />
            ];

            var tabs = [
                {
                    name: _("Details"),
                    renderer: ContainerDetails,
                    data: { container: container }
                }
            ];
            if (hasProblem) {
                var c_problems = this.state.problems[shortContID] || [];
                tabs.push(
                    {
                        name: _("Problems"),
                        renderer: ContainerProblems,
                        data: { problem: c_problems }
                    }
                );
            }

            return <Listing.ListingRow key={container.Id}
                                       columns={columns}
                                       tabRenderers={tabs}
                                       navigateToItem={ this.navigateToContainer.bind(this, container) }
                                       listingActions={actions} />;
        }, this);

        var columnTitles = [_("Name"), _("Image"), _("Command"), _("CPU"), _("Memory"), _("State")];

        var emptyCaption;
        if (this.props.onlyShowRunning) {
            if (this.props.filterText === '')
                emptyCaption = _("No running containers");
            else
                emptyCaption = _("No running containers that match the current filter");
        } else {
            if (this.props.filterText === '')
                emptyCaption = _("No containers");
            else
                emptyCaption = _("No containers that match the current filter");
        }

        return (
            <Listing.Listing title={_("Containers")} columnTitles={columnTitles} emptyCaption={emptyCaption}>
                {rows}
            </Listing.Listing>
        );
    }
});

var ImageDetails = createReactClass({
    render: function () {
        var image = this.props.image;
        var created = moment.unix(image.Created);
        var entrypoint = '';
        var command = '';
        var ports = [];

        if (image.Config) {
            entrypoint = image.Config.Entrypoint;
            command = image.Config.Cmd;
            ports = Object.keys(image.Config.ExposedPorts || {});
        }

        var repotags = image.RepoTags || [];

        return (
            <div className='listing-ct-body'>
                <dl>
                    <dt>{_("Id")}</dt>         <dd title={image.Id}>{ docker.truncate_id(image.Id) }</dd>
                    <dt>{_("Tags")}</dt>       <dd>{ repotags.join(" ") }</dd>
                    <dt>{_("Entrypoint")}</dt> <dd>{ util.quote_cmdline(entrypoint) }</dd>
                    <dt>{_("Command")}</dt>    <dd>{ util.quote_cmdline(command) }</dd>
                    <dt>{_("Created")}</dt>    <dd title={ created.toLocaleString() }>{ created.calendar() }</dd>
                    <dt>{_("Author")}</dt>     <dd>{ image.Author}</dd>
                    <dt>{_("Ports")}</dt>      <dd>{ ports.join(', ') }</dd>
                </dl>
            </div>
        );
    }
});

var ImageSecurity = createReactClass({
    render: function () {
        var info = this.props.info;
        var text, rows;
        var args = {
            time: info.finishedTime.format('MMM Do'),
            type: info.scanType,
            count: info.vulnerabilities.length
        };

        if (info.successful === false) {
            text = _("The scan from $time ($type) was not successful.");
        } else if (info.vulnerabilities.length === 0) {
            text = _("The scan from $time ($type) found no vulnerabilities.");
        } else {
            text = cockpit.ngettext('The scan from $time ($type) found one vulnerability:',
                                    'The scan from $time ($type) found $count vulnerabilities:',
                                    info.vulnerabilities.length);

            rows = info.vulnerabilities.map(function (vulnerability) {
                return (
                    <div className="vulnerability-row-ct-docker" title={vulnerability.description}>
                        <span>{vulnerability.title}</span>
                        <span className="pull-right">{vulnerability.severity}</span>
                    </div>
                );
            });
        }

        return (
            <div>
                <div className="listing-ct-body-header">
                    { cockpit.format(text, args) }
                </div>
                <div>
                    {rows}
                </div>
            </div>
        );
    }
});

var ImageInline = createReactClass({
    getInitialState: function () {
        return {
            vulnerableInfos: {}
        };
    },

    vulnerableInfoChanged: function(event, infos) {
        this.setState({ vulnerableInfos: infos });
    },

    componentDidMount: function () {
        atomic.addEventListener('vulnerableInfoChanged', this.vulnerableInfoChanged);
    },

    componentWillUnmount: function () {
        atomic.removeEventListener('vulnerableInfoChanged', this.vulnerableInfoChanged);
    },

    render: function() {
        var image = this.props.image;

        if (!image) {
            return (
                <div className="curtains-ct blank-slate-pf">
                    <div className="blank-slate-pf-icon">
                        <i className="fa fa-exclamation-circle" />
                    </div>
                    <h1>{_("This image does not exist.")}</h1>
                </div>
            );
        }

        var vulnerableInfo = this.state.vulnerableInfos[image.Id.replace(/^sha256:/, '')];

        if (vulnerableInfo) {
            return (
                <div className="listing-ct-inline">
                    <h3>{_("Details")}</h3>
                    <ImageDetails image={image} />
                    <h3>{_("Security")}</h3>
                    <ImageSecurity image={image} info={vulnerableInfo} />
                </div>
            );
        }

        return (
            <div className="listing-ct-inline">
                <h3>{_("Details")}</h3>
                <ImageDetails image={image} />
            </div>
        );
    }
});

var ImageList = createReactClass({
    getDefaultProps: function () {
        return {
            client: {},
            filterText: ''
        };
    },

    getInitialState: function () {
        return {
            images: [],
            pulling: [],
            vulnerableInfos: {}
        };
    },

    navigateToImage: function (image) {
        cockpit.location.go([ 'image', image.Id ]);
    },

    handleSearchImageClick: function (event) {
        if (event.button !== 0)
            return;

        searchImage(this.props.client).then(function (repo, tag, registry) {
            this.props.client.pull(repo, tag, registry);
        }.bind(this));
    },

    deleteImage: function (image, event) {
        if (event.button !== 0)
            return;
        util.delete_image_confirm(this.props.client, image).done(
            (runningContainers, force) => {
                var stopPromises = runningContainers.map(id => this.props.client.stop(id));
                cockpit.all(stopPromises).done(() =>
                    this.props.client.rmi(image.Id, force).fail((ex) => {
                        util.show_unexpected_error(ex);
                    }));
            });
    },

    showRunImageDialog: function (event) {
        $('#containers_run_image_dialog').modal('show', event.currentTarget);
        event.stopPropagation();
    },

    imagesChanged: function () {
        var images = Object.keys(this.props.client.images).map(function (id) {
            return this.props.client.images[id];
        }.bind(this));

        images.sort(function (a, b) {
            return b.Created - a.Created; /* unix timestamps */
        });

        this.setState({ images: images });
    },

    pullingChanged: function () {
        this.setState({ pulling: this.props.client.pulling });
    },

    vulnerableInfoChanged: function (event, infos) {
        this.setState({ vulnerableInfos: infos });
    },

    componentDidMount: function () {
        $(this.props.client).on('image.containers', this.imagesChanged);
        $(this.props.client).on('pulling.containers', this.pullingChanged);

        atomic.addEventListener('vulnerableInfoChanged', this.vulnerableInfoChanged);
    },

    componentWillUnmount: function () {
        $(this.props.client).off('image.containers', this.imagesChanged);
        $(this.props.client).off('pulling.containers', this.pullingChanged);

        atomic.removeEventListener('vulnerableInfoChanged', this.vulnerableInfoChanged);
    },

    renderRow: function (image) {
        var vulnerabilityColumn = '';

        var vulnerableInfo = this.state.vulnerableInfos[image.Id.replace(/^sha256:/, '')];
        var count;

        if (vulnerableInfo) {
            count = vulnerableInfo.vulnerabilities.length;
            if (count > 0)
                vulnerabilityColumn = (
                    <div>
                        <span className="pficon pficon-warning-triangle-o" />
                        &nbsp;
                        { cockpit.format(cockpit.ngettext('1 Vulnerability', '$0 Vulnerabilities', count), count) }
                    </div>
                );
        }

        var element;
        if (this.props.client.waiting[image.Id]) {
            element = <div className="spinner" />;
        } else {
            element = <button className="btn btn-default btn-control-ct fa fa-play"
                onClick={ this.showRunImageDialog }
                data-image={image.Id} />;
        }

        var columns = [
            { name: image.RepoTags[0], header: true },
            vulnerabilityColumn,
            moment.unix(image.Created).calendar(),
            cockpit.format_bytes(image.VirtualSize),
            {
                element: element,
                tight: true
            }
        ];

        var tabs = [];

        tabs.push({
            name: _("Details"),
            renderer: ImageDetails,
            data: { image: image }
        });

        if (vulnerableInfo !== undefined) {
            tabs.push({
                name: _("Security"),
                renderer: ImageSecurity,
                data: {
                    image: image,
                    info: vulnerableInfo,
                }
            });
        }

        var actions = [
            <button key="delete" className="btn btn-danger btn-delete pficon pficon-delete"
                    onClick={ this.deleteImage.bind(this, image) } />
        ];

        return <Listing.ListingRow key={image.Id}
                                   rowId={image.Id}
                                   columns={columns}
                                   tabRenderers={tabs}
                                   navigateToItem={ this.navigateToImage.bind(this, image) }
                                   listingActions={actions} />;
    },

    render: function () {
        var filtered = this.state.images.filter(function (image) {
            return (image.RepoTags &&
                    image.RepoTags[0].toLowerCase().indexOf(this.props.filterText.toLowerCase()) >= 0);
        }.bind(this));

        var imageRows = filtered.map(this.renderRow, this);

        var getNewImageAction = <a key="new" role="link" tabIndex="0" onClick={this.handleSearchImageClick} className="card-pf-link-with-icon pull-right">
            <span className="pficon pficon-add-circle-o" />{_("Get new image")}
        </a>;

        var columnTitles = [ _("Name"), '', _("Created"), _("Size"), '' ];

        var pendingRows = this.state.pulling.map(function (job) {
            if (job.error)
                return <p className="status has-error">{job.error}</p>;

            var detail = '';
            if (job.progress) {
                detail = (
                    <span>
                        ({ cockpit.format_bytes(job.progress.current) }
                        &nbsp;/&nbsp;
                        { cockpit.format_bytes(job.progress.total) })
                    </span>
                );
            }

            return <p className="status">{job.name}: {job.status} {detail}</p>;
        });

        var emptyCaption;
        if (this.props.filterText === '')
            emptyCaption = _("No images");
        else
            emptyCaption = _("No images that match the current filter");

        return (
            <div>
                <Listing.Listing title={_("Images")}
                    columnTitles={columnTitles}
                    emptyCaption={emptyCaption}
                    actions={[ getNewImageAction ]}>
                    {imageRows}
                </Listing.Listing>
                {pendingRows}
            </div>
        );
    }
});

module.exports = {
    ContainerHeader: ContainerHeader,
    ContainerList: ContainerList,
    ImageList: ImageList,
    ImageInline: ImageInline,
};
