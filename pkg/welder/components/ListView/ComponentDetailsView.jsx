/* global $ */

import React from 'react';
import PropTypes from 'prop-types';
import ComponentTypeIcons from '../../components/ListView/ComponentTypeIcons';
import Tabs from '../../components/Tabs/Tabs';
import Tab from '../../components/Tabs/Tab';
import DependencyListView from '../../components/ListView/DependencyListView';
import MetadataApi from '../../data/MetadataApi';

class ComponentDetailsView extends React.Component {
  constructor() {
    super();
    this.state = {
      selectedBuildIndex: 0,
      availableBuilds: [],
      activeTab: 'Details',
      parents: [],
      dependencies: [],
      componentData: {},
      editSelected: false,
    };
    this.handleEdit = this.handleEdit.bind(this);
    this.handleVersionSelect = this.handleVersionSelect.bind(this);
  }

  componentWillMount() {
    this.getMetadata(this.props.component, this.props.status);
  }

  componentDidMount() {
    this.initializeBootstrapElements();
  }

  componentWillReceiveProps(newProps) {
    this.updateBreadcrumb(newProps);
    this.getMetadata(newProps.component, newProps.status);
    this.setState({ activeTab: 'Details' });
    // this needs to be updated when Edit in the li is enabled,
    // in that case, status can be "editSelected"
    if (newProps.status !== 'editSelected') {
      this.setState({ editSelected: false });
    }
  }

  componentDidUpdate() {
    this.initializeBootstrapElements();
  }

  getMetadata(component, status) {
    // when getting metadata, get all builds if component is from list of available inputs
    const build = status === 'available' ? 'all' : '';
    // if the user clicks a component listed in the inputs and it's in the recipe,
    // then use the version and release that's selected for the recipe component
    const selectedComponent = Object.assign({}, component);
    if (selectedComponent.active === true && selectedComponent.inRecipe === true) {
      selectedComponent.version = component.version_selected;
      selectedComponent.release = component.release_selected;
    }
    Promise.all([MetadataApi.getMetadataComponent(selectedComponent, build)])
      .then(data => {
        this.setState({ componentData: data[0][0] });
        this.setState({ dependencies: data[0][0].dependencies });
        if (this.props.status === 'editSelected') {
          this.handleEdit();
        }
        if (status === 'available' || this.props.status === 'editSelected') {
          // when status === "available" a form displays with a menu for selecting a specific version
          // availableBuilds is an array listing each option
          // TODO - include other metadata that's defined in builds
          const availableBuilds = data[0][1].map(i => ({ version: i.source.version, release: i.release }));
          this.setState({ availableBuilds });
          if (this.props.status === 'editSelected') {
            this.setBuildIndex(availableBuilds, data[0][0]);
          }
        } else {
          this.setState({ availableBuilds: [] });
        }
        this.setState({ selectedBuildIndex: 0 });
      })
      .catch(e => console.log(`getMetadata: Error getting component metadata: ${e}`));
  }

  setBuildIndex(availableBuilds, component) {
    // filter available builds by component data to find object in array,
    // then get index of that object
    const selectedBuild = availableBuilds.filter(
      obj => obj.version === component.version && obj.release === component.release
    )[0];
    const index = availableBuilds.indexOf(selectedBuild);
    this.setState({ selectedBuildIndex: index });
  }

  initializeBootstrapElements() {
    // Initialize Boostrap-select
    $('.selectpicker').selectpicker();
    // Initialize Boostrap-tooltip
    $('[data-toggle="tooltip"]').tooltip();
  }

  handleEdit(event) {
    if (event) {
      event.preventDefault();
    }
    // user clicked Edit for the selected component
    const component = this.state.componentData;
    // get available builds and set default value
    Promise.all([MetadataApi.getAvailableBuilds(component)])
      .then(data => {
        const availableBuilds = data[0].map(i => ({ version: i.source.version, release: i.release }));
        this.setState({ availableBuilds });
        this.setBuildIndex(availableBuilds, component);
      })
      .catch(e => console.log(`handleEdit: Error getting component metadata: ${e}`));
    // display the form
    this.setState({ editSelected: true });
  }

  handleVersionSelect(event) {
    this.setState({ selectedBuildIndex: event.target.value });
    const builds = this.state.availableBuilds;
    const componentData = this.state.componentData;
    componentData.version = builds[event.target.value].version;
    componentData.release = builds[event.target.value].release;
    // TODO any data that we display that's defined in builds should be added here
    this.setState({ componentData });
  }

  handleTabChanged(e) {
    if (this.state.activeTab !== e.detail) {
      this.setState({ activeTab: e.detail });
    }
  }

  updateBreadcrumb(newProps) {
    // update the breadcrumb
    const parents = this.state.parents.slice(0);
    let updatedParents = [];
    const breadcrumbIndex = parents.indexOf(newProps.component);
    // check if the selected component is a breadcrumb node
    // if it is in the breadcrumb, then the breadcrumb path should be updated
    if (breadcrumbIndex === 0) {
      // if the user clicks the first node in the breadcrumb, it is removed.
      updatedParents = [];
    } else if (breadcrumbIndex >= 1) {
      // if the user clicks any other node in the breadcrumb, then the array
      // is truncated to show only the parents of the selected component
      updatedParents = parents.slice(0, breadcrumbIndex);
    } else if (newProps.componentParent !== undefined) {
      // otherwise, update the list of parents if a parent is provided
      updatedParents = parents.concat(newProps.componentParent);
    }
    this.setState({ parents: updatedParents });
  }

  render() {
    const { component } = this.props;

    return (
      <div className="cmpsr-panel__body cmpsr-panel__body--main">
        <div className="cmpsr-header">
          {(this.state.parents.length > 0 &&
            <ol className="breadcrumb">
              <li>
                <a href="#" onClick={e => this.props.handleComponentDetails(e, '')}>Back to {this.props.parent}</a>
              </li>
              {this.state.parents.map((parent, i) => (
                <li key={i}>
                  <a href="#" onClick={e => this.props.handleComponentDetails(e, parent, this.state.parents[i - 1])}>
                    {parent.name}
                  </a>
                </li>
              ))}
              <li />
            </ol>) ||
            <ol className="breadcrumb">
              <li>
                <a href="#" onClick={e => this.props.handleComponentDetails(e, '')}>Back to {this.props.parent}</a>
              </li>
            </ol>}
          <div className="cmpsr-header__actions">
            <ul className="list-inline">
              {this.props.status === 'available' &&
                <li>
                  <button
                    className="btn btn-primary add"
                    type="button"
                    onClick={e => this.props.handleAddComponent(e, 'details', this.state.componentData, this.state.dependencies)}
                  >
                    Add
                  </button>
                </li>}
              {this.props.status === 'selected' &&
                this.state.editSelected === false &&
                <li>
                  <button className="btn btn-primary" type="button" onClick={this.handleEdit}>Edit</button>
                </li>}
              {((this.props.status === 'selected' && this.state.editSelected === true) || this.props.status === 'editSelected') &&
                <li>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={e => this.props.handleUpdateComponent(e, this.state.componentData)}
                  >
                    Save Updates
                  </button>
                </li>}
              {(this.props.status === 'selected' || this.props.status === 'editSelected') &&
                <li>
                  <button
                    className="btn btn-default"
                    type="button"
                    data-toggle="tooltip"
                    data-placement="bottom"
                    title=""
                    data-original-title="Remove from Recipe"
                    onClick={e => this.props.handleRemoveComponent(e, component)}
                  >
                    Remove
                  </button>
                </li>}
              <li>
                <button
                  type="button"
                  className="close"
                  data-toggle="tooltip"
                  data-placement="bottom"
                  title=""
                  data-original-title="Hide Details"
                  onClick={e => this.props.handleComponentDetails(e, '')}
                >
                  <span className="pficon pficon-close" />
                </button>
              </li>
            </ul>
          </div>
          <h3 className="cmpsr-title">
            <span>
              <ComponentTypeIcons componentType={component.ui_type} compDetails componentInRecipe={component.inRecipe} />
              {' '}
              {component.name}
            </span>
          </h3>
        </div>
        {(this.props.status === 'available' || this.state.editSelected === true || this.props.status === 'editSelected') &&
          <div className="cmpsr-component-details__form">
            <h4>Component Options</h4>
            <form className="form-horizontal">
              <div className="form-group">
                <label className="col-sm-3 col-md-2 control-label" htmlFor="cmpsr-compon__version-select">
                  Version Release
                </label>
                <div className="col-sm-8 col-md-9">
                  <select
                    id="cmpsr-compon__version-select"
                    className="form-control"
                    value={this.state.selectedBuildIndex}
                    onChange={this.handleVersionSelect}
                  >
                    {this.state.availableBuilds.map((build, i) => (
                      <option key={i} value={i}>{build.version}-{build.release}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group hidden">
                <label className="col-sm-3 col-md-2 control-label" htmlFor="cmpsr-compon__instprof-select">
                  Install Profile
                </label>
                <div className="col-sm-8 col-md-9">
                  <select id="cmpsr-compon__instprof-select" className="form-control">
                    <option>Default</option>
                    <option>Debug</option>
                  </select>
                </div>
              </div>
            </form>
          </div>}
        <div>
          <Tabs key="pf-tabs" ref="pfTabs" classnames="nav nav-tabs nav-tabs-pf" tabChanged={e => this.handleTabChanged(e)}>
            <Tab tabTitle="Details" active={this.state.activeTab === 'Details'}>
              <h4 className="cmpsr-title">{this.state.componentData.summary}</h4>
              <p>{this.state.componentData.description}</p>
              <dl className="dl-horizontal">
                <dt>Type</dt>
                <dd>{component.ui_type}</dd>
                <dt>Version</dt>
                <dd>
                  {this.state.componentData.version}
                  {' '}
                  {this.props.status === 'selected' &&
                    this.state.editSelected === false &&
                    <a href="#" onClick={this.handleEdit}>Update</a>}
                </dd>
                <dt>Release</dt>
                <dd>{this.state.componentData.release}</dd>
                <dt>Architecture</dt>
                <dd>---</dd>
                <dt>Install Size</dt>
                <dd>2 MB (5 MB with Dependencies)</dd>
                <dt>URL</dt>
                {(this.state.componentData.homepage !== null &&
                  <dd>
                    <a target="_blank" href={this.state.componentData.homepage}>
                      {this.state.componentData.homepage}
                    </a>
                  </dd>) ||
                  <dd>&nbsp;</dd>}
                <dt>Packager</dt>
                <dd>Red Hat</dd>
                <dt>Product Family</dt>
                <dd>---</dd>
                <dt>Lifecycle</dt>
                <dd>01/15/2017</dd>
                <dt>Support Level</dt>
                <dd>Standard</dd>
              </dl>
            </Tab>
            {this.state.componentData.components &&
              <Tab tabTitle="Components" active={this.state.activeTab === 'Components'}>
                <p>Components</p>
              </Tab>}
            <Tab
              tabTitle={`Dependencies <span class="badge">${this.state.dependencies.length}</span>`}
              active={this.state.activeTab === 'Dependencies'}
            >
              <DependencyListView
                id="cmpsr-component-dependencies"
                listItems={this.state.dependencies}
                noEditComponent
                handleComponentDetails={this.props.handleComponentDetails}
                componentDetailsParent={component}
              />
            </Tab>
            <Tab tabTitle="Errata" active={this.state.activeTab === 'Errata'}>
              <p>Errata</p>
            </Tab>
          </Tabs>
        </div>
      </div>
    );
  }
}

ComponentDetailsView.propTypes = {
  component: PropTypes.object,
  status: PropTypes.string,
  parent: PropTypes.string,
  handleComponentDetails: PropTypes.func,
  handleRemoveComponent: PropTypes.func,
  handleAddComponent: PropTypes.func,
  handleUpdateComponent: PropTypes.func,
};

export default ComponentDetailsView;
