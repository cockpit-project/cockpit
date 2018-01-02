/* global $ */

import React from 'react';
import PropTypes from 'prop-types';

class ListItemChanges extends React.Component {
  constructor() {
    super();
    this.state = { expanded: false };
    this.handleExpandComponent = this.handleExpandComponent.bind(this);
  }

  componentWillReceiveProps(newProps) {
    // compare old value to new value, and if this component is getting new data,
    // then get the current expand state of the new value as it is in the old dom
    // and apply that expand state to this component
    const olditem = this.props.listItem;
    const newitem = newProps.listItem;
    const parent = this.props.listItemParent;
    if (olditem !== newitem) {
      if ($(`#${parent} [data-name='${newitem.name}']`).hasClass('list-view-pf-expand-active')) {
        this.setState({ expanded: true });
      } else {
        this.setState({ expanded: false });
      }
    }
  }

  handleExpandComponent(event) {
    // the user clicked a list item in the recipe contents area to expand or collapse
    if (!$(event.target).is('button, a, input, .fa-ellipsis-v')) {
      const expandState = !this.state.expanded;
      this.setState({ expanded: expandState });
    }
  }

  render() {
    const { listItem } = this.props;

    return (
      <div className={`list-pf-item ${this.state.expanded ? 'active' : ''}`}>

        <div className="list-pf-container" onClick={this.handleExpandComponent}>
          <div className="list-pf-chevron">
            <span className={`fa ${this.state.expanded ? 'fa-angle-down' : 'fa-angle-right'}`} />
          </div>

          <div className="list-pf-content list-pf-content-flex ">
            <div className="list-pf-content-wrapper">
              <div className="list-pf-main-content">
                <div className="list-pf-title text-overflow-pf">
                  Change {this.props.number}
                  <span className="cmpsr-list-item__text--muted text-muted pull-right">
                    {listItem.time}
                  </span>
                </div>
                <div className="list-pf-description">{listItem.message}</div>
              </div>
            </div>
          </div>
        </div>
        <div className={`list-pf-expansion collapse ${this.state.expanded ? 'in' : ''}`}>
          <div className="list-pf-container" tabIndex="0">
            <div className="list-pf-content">
              <div className="container-fluid ">
                <p>Individual changes associated with the commit would be listed
                here, following the UI pattern that is used in the Pending Changes
                dialog for showing changes saved temporarily in the workspace.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

ListItemChanges.propTypes = {
  listItem: PropTypes.object,
  listItemParent: PropTypes.string,
  number: PropTypes.number,
};

export default ListItemChanges;
