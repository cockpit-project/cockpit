/* global $ */

import React from 'react';
import PropTypes from 'prop-types';
import ComponentTypeIcons from '../../components/ListView/ComponentTypeIcons';
import ComponentSummaryList from '../../components/ListView/ComponentSummaryList';
import MetadataApi from '../../data/MetadataApi';
import constants from '../../core/constants';

class ListItemComponents extends React.Component {
  constructor() {
    super();
    this.state = { expanded: false, dependencies: [], showAllDeps: false };
  }

  componentWillReceiveProps(newProps) {
    // compare old value to new value, and if this component is getting new data,
    // then get the current expand state of the new value as it is in the old dom
    // and apply that expand state to this component
    const olditem = this.props.listItem;
    const newitem = newProps.listItem;
    const parent = this.props.listItemParent;
    if (olditem !== newitem) {
      if ($(`.${parent} [data-name='${newitem.name}']`).hasClass('list-view-pf-expand-active')) {
        this.setState({ expanded: true });
      } else {
        this.setState({ expanded: false });
      }
    }
  }

  getDependencies(component) {
    const p = new Promise((resolve, reject) => {
      Promise.all([MetadataApi.getData(constants.get_modules_info + component.name)])
        .then(data => {
          const dependencies = data[0].modules[0].dependencies;
          this.setState({ dependencies });
          resolve();
        })
        .catch(e => {
          console.log(`getDependencies: Error getting dependencies: ${e}`);
          reject();
        });
    });
    return p;
  }

  handleExpandComponent(event) {
    // the user clicked a list item in the recipe contents area to expand or collapse
    if (!$(event.target).is('button, a, input, .fa-ellipsis-v')) {
      const expandState = !this.state.expanded;
      this.setState({ expanded: expandState });
      if (expandState === true && this.state.dependencies.length === 0) {
        this.getDependencies(this.props.listItem);
      }
    }
  }

  render() {
    const { listItem } = this.props;
    return (
      <div className={`list-pf-item ${this.state.expanded ? 'active' : ''}`}>

        <div className="list-pf-container" onClick={e => this.handleExpandComponent(e)}>
          <div className="list-pf-chevron">
            <span className={`fa ${this.state.expanded ? 'fa-angle-down' : 'fa-angle-right'}`} />
          </div>
          <div className="list-pf-select">
            <input type="checkbox" />
          </div>
          <div className="list-pf-content list-pf-content-flex ">
            <div className="list-pf-left">
              <ComponentTypeIcons
                componentType={listItem.ui_type}
                componentInRecipe={listItem.inRecipe}
                isDependency={this.props.isDependency}
              />
            </div>
            <div className="list-pf-content-wrapper">
              <div className="list-pf-main-content">
                <div className="list-pf-title text-overflow-pf">
                  <a href="#" onClick={e => this.props.handleComponentDetails(e, listItem, this.props.componentDetailsParent)}>
                    {listItem.name}
                  </a>
                </div>
                <div className="list-pf-description">{listItem.summary}</div>
              </div>
              <div className="list-pf-additional-content">
                <div className="list-view-pf-additional-info-item list-view-pf-additional-info-item-stacked">
                  Version <strong>{listItem.version}</strong>
                </div>
                <div className="list-view-pf-additional-info-item list-view-pf-additional-info-item-stacked">
                  Release <strong>{listItem.release}</strong>
                </div>
              </div>
            </div>
            {this.props.noEditComponent !== true &&
              <div className="list-pf-actions">
                <div className="dropdown pull-right dropdown-kebab-pf">
                  <button
                    className="btn btn-link dropdown-toggle"
                    type="button"
                    id="dropdownKebabRight9"
                    data-toggle="dropdown"
                    aria-haspopup="true"
                    aria-expanded="true"
                  >
                    <span className="fa fa-ellipsis-v" />
                  </button>
                  <ul className="dropdown-menu dropdown-menu-right" aria-labelledby="dropdownKebabRight9">
                    <li>
                      <a
                        href="#"
                        onClick={e => this.props.handleComponentDetails(e, listItem, this.props.componentDetailsParent)}
                      >
                        View
                      </a>
                    </li>
                    <li>
                      <a
                        href="#"
                        onClick={e => this.props.handleComponentDetails(e, listItem, this.props.componentDetailsParent, 'edit')}
                      >
                        Edit
                      </a>
                    </li>
                    <li role="separator" className="divider" />
                    <li>
                      <a href="#" onClick={e => this.props.handleRemoveComponent(e, listItem)}>Remove</a>
                    </li>
                  </ul>
                </div>
              </div>}
          </div>
        </div>

        <div className={`list-pf-expansion collapse ${this.state.expanded ? 'in' : ''}`}>
          <div className="list-pf-container" tabIndex="0">
            <div className="list-pf-content">
              <div className="container-fluid ">
                <div className="row">
                  <div className="col-md-6">
                    <dl className="dl-horizontal clearfix">
                      <dt>Version</dt>
                      <dd>{listItem.version ? listItem.version : <span>&nbsp;</span>}</dd>
                      <dt>Release</dt>
                      <dd>{listItem.release ? listItem.release : <span>&nbsp;</span>}</dd>
                      <dt>Architecture</dt>
                      <dd>---</dd>
                      <dt>Install Size</dt>
                      <dd>2 MB (5 MB with Dependencies)</dd>
                      <dt>URL</dt>
                      {(listItem.homepage != null &&
                        <dd><a target="_blank" href={listItem.homepage}>{listItem.homepage}</a></dd>) ||
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
                  </div>
                  <div className="col-md-6">
                    {this.state.dependencies.length > 0 && <ComponentSummaryList listItems={this.state.dependencies} />}
                  </div>
                  <div className="col-md-12 hidden">
                    <div className="cmpsr-summary-listview">
                      <p>
                        <strong>Errata</strong>
                        <a href="#" className="pull-right hidden">Show All</a>
                      </p>
                      <div className="list-pf cmpsr-list-pf__compacted">
                        <div className="list-pf-item">
                          <div className="list-pf-container">
                            <div className="list-pf-content list-pf-content-flex ">
                              <div className="list-pf-content-wrapper">
                                <div className="list-pf-main-content">
                                  <div className="list-pf-description">
                                    <a href="#">RHBA-2016:1641 RHEL Atomic OSTree Update 7.2.6-1</a>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="list-pf-item">
                          <div className="list-pf-container">
                            <div className="list-pf-content list-pf-content-flex ">
                              <div className="list-pf-content-wrapper">
                                <div className="list-pf-main-content">
                                  <div className="list-pf-description">
                                    <a href="#">RHBA-2016:1641 RHEL Atomic OSTree Update 7.2.6-1</a>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

ListItemComponents.propTypes = {
  listItem: PropTypes.object,
  listItemParent: PropTypes.string,
  componentDetailsParent: PropTypes.object,
  handleComponentDetails: PropTypes.func,
  handleRemoveComponent: PropTypes.func,
  noEditComponent: PropTypes.bool,
  isDependency: PropTypes.bool,
};

export default ListItemComponents;
