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

var cockpit = require('cockpit');
var _ = cockpit.gettext;

var $ = require("jquery");
var docker = require('./docker');
var util = require('./util');
var searchImage = require("./search");
var React = require('react');
var Listing = require('cockpit-components-listing.jsx');
var Select = require('cockpit-components-select.jsx');
var moment = require('moment');

var Dropdown = React.createClass({
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
                    <div className="caret"></div>
                </button>
                <ul className="dropdown-menu dropdown-menu-right" role="menu">
                    {
                        this.props.actions.map(function (action, index) {
                            return (
                                <li className={ action.disabled ? 'disabled' : '' }>
                                    <a data-value={index} onClick={this.handleClick}>{action.label}</a>
                                </li>
                            );
                        }.bind(this))
                    }
                </ul>
            </div>
        );
    }
});

var ContainerHeader = React.createClass({
    getInitialState: function () {
        return {
            filter: 'running',
            filterText: ''
        }
    },

    filterChanged: function () {
        if (this.props.onFilterChanged)
            this.props.onFilterChanged(this.state.filter, this.state.filterText);
    },

    handleFilterChange: function (value) {
        this.setState({ filter: value }, this.filterChanged);
    },

    handleFilterTextChange: function (event) {
        this.setState({ filterText: this.refs.filterTextInput.value }, this.filterChanged);
    },

    render: function () {
        return (
            <div>
                <Select.Select id="containers-containers-filter" initial="running" onChange={this.handleFilterChange}>
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

var ContainerDetails = React.createClass({
    render: function () {
        var container = this.props.container;
        return (
            <div className='listing-body'>
                <dl>
                    <dt>{_("Id")}      </dt> <dd>{ container.Id }</dd>
                    <dt>{_("Created")} </dt> <dd>{ container.Created }</dd>
                    <dt>{_("Image")}   </dt> <dd>{ container.Image }</dd>
                    <dt>{_("Command")}</dt> <dd>{ util.render_container_cmdline(container) }</dd>
                    <dt>{_("State")}   </dt> <dd>{ util.render_container_state(container.State) }</dd>
                </dl>
            </div>
        );
    }
});

var ContainerList = React.createClass({
    getDefaultProps: function () {
        return {
            client: {},
            onlyShowRunning: true,
            filterText: ''
        };
    },

    getInitialState: function () {
        return {
            containers: []
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

    componentDidMount: function () {
        $(this.props.client).on('container.containers', this.containersChanged);
        $(this.props.client).on('container.container-details', this.containersChanged);
    },

    componentWillUnmount: function () {
        $(this.props.client).off('container.containers', this.containersChanged);
        $(this.props.client).off('container.container-details', this.containersChanged);
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

            var columns = [
                { name: container.Name.replace(/^\//, ''), header: true },
                docker.truncate_id(container.Image),
                util.render_container_cmdline(container),
                util.format_cpu_usage(container.CpuUsage),
                util.format_memory_and_limit(container.MemoryUsage, container.MemoryLimit),
                util.render_container_status(container.State)
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

            return <Listing.ListingRow key={container.Id}
                                       columns={columns}
                                       tabRenderers={tabs}
                                       navigateToItem={ this.navigateToContainer.bind(this, container) }
                                       listingActions={actions}/>;
        }, this);

        var columnTitles =  [ _("Name"), _("Image"), _("Command"), _("CPU"), _("Memory"), _("State")];

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

var ImageDetails = React.createClass({
    render: function () {
        var image = this.props.image;
        var created = moment.unix(image.Created);
        var entrypoint = '';
        var command = '';
        var ports = [];

        if (image.Config) {
            entrypoint = image.Config.Entrypoint;
            command = image.Config.Cmd;
            ports = image.Config.ExposedPorts || [];
        }

        return (
            <div className='listing-body'>
                <dl>
                    <dt>Id         </dt> <dd title={image.Id}>{ docker.truncate_id(image.Id) }</dd>
                    <dt>Entrypoint </dt> <dd>{ util.quote_cmdline(entrypoint) }</dd>
                    <dt>Command    </dt> <dd>{ util.quote_cmdline(command) }</dd>
                    <dt>Created    </dt> <dd title={ created.toLocaleString() }>{ created.fromNow() }</dd>
                    <dt>Author     </dt> <dd>{ image.Author}</dd>
                    <dt>Ports      </dt> <dd>{ ports.join(', ')  }</dd>
                </dl>
            </div>
        );
    }
});

var ImageList = React.createClass({
    getDefaultProps: function () {
        return {
            client: {},
            filterText: ''
        };
    },

    getInitialState: function () {
        return {
            images: [],
            pulling: []
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

        util.confirm(cockpit.format(_("Delete $0"), image.RepoTags[0]),
                     _("Are you sure you want to delete this image?"), _("Delete")).
            done(function () {
                this.props.client.rmi(image.Id).
                    fail(function(ex) {
                        util.show_unexpected_error(ex);
                    });
            }.bind(this));
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

    componentDidMount: function () {
        $(this.props.client).on('image.containers', this.imagesChanged);
        $(this.props.client).on('pulling.containers', this.pullingChanged);
    },

    componentWillUnmount: function () {
        $(this.props.client).off('image.containers', this.imagesChanged);
        $(this.props.client).off('pulling.containers', this.pullingChanged);
    },

    render: function () {
        var filtered = this.state.images.filter(function (image) {
            return (image.RepoTags &&
                    image.RepoTags[0].toLowerCase().indexOf(this.props.filterText.toLowerCase()) >= 0);
        }.bind(this));

        var imageRows = filtered.map(function (image) {
            var columns = [
                { name: image.RepoTags[0], header: true },
                moment.unix(image.Created).fromNow(),
                cockpit.format_bytes(image.VirtualSize),
                {
                    element: <button className="btn btn-default btn-control-ct fa fa-play"
                                     onClick={ this.showRunImageDialog.bind(this) }
                                     data-image={image.Id} />,
                    tight: true
                }
            ];

            var tabs = [
                {
                    name: _("Details"),
                    renderer: ImageDetails,
                    data: { image: image }
                }
            ];

            var actions = [
                <button className="btn btn-danger btn-delete pficon pficon-delete"
                        onClick={ this.deleteImage.bind(this, image) } />
            ];

            return <Listing.ListingRow key={image.Id}
                                       columns={columns}
                                       tabRenderers={tabs}
                                       navigateToItem={ this.navigateToImage.bind(this, image) }
                                       listingActions={actions}/>;
        }, this);

        var getNewImageAction = <a onClick={this.handleSearchImageClick} className="card-pf-link-with-icon pull-right">
                                    <span className="pficon pficon-add-circle-o"></span>{_("Get new image")}
                                </a>;

        var columnTitles = [ _("Name"), _("Created"), _("Size"), '' ];

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
                                 actions={getNewImageAction}>
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
    ImageList: ImageList
};
